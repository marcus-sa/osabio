/**
 * External signal gathering for the observer verification pipeline.
 *
 * Driven port: functions that fetch external CI/GitHub status for commits.
 * Pure types + effect-boundary functions kept separate from domain logic.
 */
import type { Surreal } from "surrealdb";
import { RecordId } from "surrealdb";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CiStatus = "success" | "failure" | "pending" | "unknown";

export type ExternalSignal = {
  sha: string;
  repository: string;
  ciStatus: CiStatus;
  source: string;
};

export type GatherSignalsResult = {
  signals: ExternalSignal[];
  hasCommits: boolean;
};

type CommitRecord = {
  id: RecordId<"git_commit", string>;
  sha: string;
  repository?: string;
};

// ---------------------------------------------------------------------------
// Gather linked commits for a task
// ---------------------------------------------------------------------------

export async function gatherLinkedCommits(
  surreal: Surreal,
  taskId: string,
): Promise<CommitRecord[]> {
  const taskRecord = new RecordId("task", taskId);

  // Check source_commit field on the task
  const [taskRows] = await surreal.query<
    [Array<{ source_commit?: RecordId<"git_commit", string> }>]
  >(
    `SELECT source_commit FROM $task;`,
    { task: taskRecord },
  );

  const sourceCommit = taskRows?.[0]?.source_commit;
  if (!sourceCommit) return [];

  // Fetch the commit record
  const [commitRows] = await surreal.query<[CommitRecord[]]>(
    `SELECT id, sha, repository FROM $commit;`,
    { commit: sourceCommit },
  );

  return commitRows ?? [];
}

// ---------------------------------------------------------------------------
// Check CI status for a commit (GitHub API)
// ---------------------------------------------------------------------------

export async function checkCiStatus(
  commit: CommitRecord,
): Promise<ExternalSignal> {
  const sha = commit.sha;
  const repository = commit.repository ?? "";

  if (!repository) {
    return { sha, repository, ciStatus: "unknown", source: "none" };
  }

  // Attempt GitHub commit status API (configurable base URL for testing)
  const githubBaseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const githubApiUrl = `${githubBaseUrl}/repos/${repository}/commits/${sha}/status`;

  try {
    const response = await fetch(githubApiUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.info("observer.ci_check.http_error", "GitHub API returned non-OK", {
        status: response.status,
        sha,
        repository,
      });
      return { sha, repository, ciStatus: "unknown", source: "github" };
    }

    const data = (await response.json()) as { state?: string };
    const ciStatus = mapGitHubState(data.state);

    return { sha, repository, ciStatus, source: "github" };
  } catch (error) {
    log.error("observer.ci_check.failed", "Failed to check CI status", error);
    return { sha, repository, ciStatus: "unknown", source: "github" };
  }
}

function mapGitHubState(state?: string): CiStatus {
  switch (state) {
    case "success":
      return "success";
    case "failure":
    case "error":
      return "failure";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Gather all external signals for a task
// ---------------------------------------------------------------------------

export async function gatherTaskSignals(
  surreal: Surreal,
  taskId: string,
): Promise<GatherSignalsResult> {
  const commits = await gatherLinkedCommits(surreal, taskId);

  if (commits.length === 0) {
    return { signals: [], hasCommits: false };
  }

  const signals = await Promise.all(commits.map(checkCiStatus));
  return { signals, hasCommits: true };
}
