import { execSync } from "node:child_process";
import { requireConfig } from "../config";
import { BrainHttpClient } from "../http-client";

/**
 * brain check-commit
 * Called by pre-commit git hook.
 * Reads staged diff and checks for task completion, unlogged decisions, constraint violations.
 */
export async function runCheckCommit(): Promise<void> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);
  const cwd = process.cwd();

  let diff: string;
  let commitMessage: string;
  try {
    diff = execSync("git diff --cached", { encoding: "utf-8", cwd }).trim();
    try {
      commitMessage = execSync("cat .git/COMMIT_EDITMSG", { encoding: "utf-8", cwd }).trim();
    } catch {
      commitMessage = "";
    }
  } catch {
    return; // Not in a git repo or no staged changes
  }

  if (!diff) return;

  try {
    // Truncate for token budget
    const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) : diff;

    const result = await client.checkCommit({
      diff: truncatedDiff,
      commit_message: commitMessage,
    });

    // Display findings to stderr (stdout is reserved for git hook protocol)
    for (const tc of result.task_completions) {
      if (tc.confidence >= 0.6) {
        process.stderr.write(`Brain: This commit may complete: ${tc.task_title}\n`);
      }
    }
    for (const d of result.unlogged_decisions) {
      process.stderr.write(`Brain: Unlogged decision: ${d.description}\n`);
    }
    for (const v of result.constraint_violations) {
      process.stderr.write(`Brain: Constraint violation (${v.severity}): ${v.violation}\n`);
    }
  } catch {
    // Never block commits on analysis failures
  }
}

/**
 * brain log-commit
 * Deprecated. Commit ingestion is handled by GitHub webhook processing only.
 * Kept as a no-op for backward compatibility with existing post-commit hooks.
 */
export async function runLogCommit(): Promise<void> {
  process.stderr.write(
    "Brain: `log-commit` is disabled. GitHub webhook is the source of truth for commit ingestion.\n",
  );
}
