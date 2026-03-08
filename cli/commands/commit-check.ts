import { execSync } from "node:child_process";
import { requireConfig } from "../config";
import { BrainHttpClient } from "../http-client";

// ---------------------------------------------------------------------------
// Ports (injectable for testing)
// ---------------------------------------------------------------------------

/** Reads the latest git commit message. */
export type GetLatestCommitMessage = () => string;

/** POSTs a commit message to the server for task-ref extraction. */
export type PostCommitCheck = (message: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Pure orchestration logic
// ---------------------------------------------------------------------------

export async function executeCommitCheck(deps: {
  getLatestCommitMessage: GetLatestCommitMessage;
  postCommitCheck: PostCommitCheck;
}): Promise<void> {
  let commitMessage: string;
  try {
    commitMessage = deps.getLatestCommitMessage();
  } catch {
    return; // Not in a git repo
  }

  if (!commitMessage) return;

  try {
    await deps.postCommitCheck(commitMessage);
  } catch {
    // Fire-and-forget: never block git workflow
  }
}

// ---------------------------------------------------------------------------
// Production adapters
// ---------------------------------------------------------------------------

function getLatestCommitMessage(): string {
  return execSync("git log -1 --format=%B", {
    encoding: "utf-8",
    cwd: process.cwd(),
  }).trim();
}

async function createPostCommitCheck(): Promise<PostCommitCheck> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);
  return async (message: string) => {
    await client.postCheckCommit({ commit_message: message });
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

/**
 * brain commit-check
 * Post-commit hook: reads latest commit message and sends it to the server
 * for task-ref extraction (task:xxx -> mark task as done).
 * Always exits 0 — never blocks git workflow.
 */
export async function runCommitCheck(): Promise<void> {
  try {
    const postCommitCheck = await createPostCommitCheck();
    await executeCommitCheck({ getLatestCommitMessage, postCommitCheck });
  } catch {
    // Config missing or other setup failure — silently exit
  }
}
