// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorktreeInfo = {
  worktreePath: string;
  branchName: string;
};

export type DiffResult = {
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  rawDiff: string;
  stats: { filesChanged: number; insertions: number; deletions: number };
};

export type WorktreeErrorCode = "WORKTREE_EXISTS" | "GIT_ERROR";

export type WorktreeError = {
  code: WorktreeErrorCode;
  message: string;
};

export type WorktreeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorktreeError };

// ---------------------------------------------------------------------------
// Shell executor port (injected dependency)
// ---------------------------------------------------------------------------

export type ShellExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ShellExec = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<ShellExecResult>;

// ---------------------------------------------------------------------------
// Pure helpers: path and branch construction
// ---------------------------------------------------------------------------

const WORKTREE_DIR = ".brain/worktrees";
const BRANCH_PREFIX = "agent/";
const WORKTREE_PREFIX = "agent-";

export function buildWorktreePath(repoRoot: string, taskSlug: string): string {
  return `${repoRoot}/${WORKTREE_DIR}/${WORKTREE_PREFIX}${taskSlug}`;
}

export function buildBranchName(taskSlug: string): string {
  return `${BRANCH_PREFIX}${taskSlug}`;
}

function worktreeRelativePath(taskSlug: string): string {
  return `${WORKTREE_DIR}/${WORKTREE_PREFIX}${taskSlug}`;
}

function taskSlugFromBranch(branchName: string): string {
  return branchName.replace(BRANCH_PREFIX, "");
}

// ---------------------------------------------------------------------------
// Error constructors
// ---------------------------------------------------------------------------

function worktreeExists(stderr: string): WorktreeResult<never> {
  return {
    ok: false,
    error: {
      code: "WORKTREE_EXISTS",
      message: `Worktree already exists: ${stderr}`,
    },
  };
}

function gitError(stderr: string): WorktreeResult<never> {
  return {
    ok: false,
    error: {
      code: "GIT_ERROR",
      message: `Git command failed: ${stderr}`,
    },
  };
}

// ---------------------------------------------------------------------------
// createWorktree — creates worktree with new branch
// ---------------------------------------------------------------------------

export async function createWorktree(
  exec: ShellExec,
  repoRoot: string,
  taskSlug: string,
): Promise<WorktreeResult<WorktreeInfo>> {
  const branchName = buildBranchName(taskSlug);
  const relativePath = worktreeRelativePath(taskSlug);

  const result = await exec(
    "git",
    ["worktree", "add", "-b", branchName, relativePath],
    repoRoot,
  );

  if (result.exitCode !== 0) {
    if (result.stderr.includes("already exists")) {
      return worktreeExists(result.stderr);
    }
    return gitError(result.stderr);
  }

  return {
    ok: true,
    value: {
      worktreePath: buildWorktreePath(repoRoot, taskSlug),
      branchName,
    },
  };
}

// ---------------------------------------------------------------------------
// removeWorktree — idempotent removal of worktree and branch
// ---------------------------------------------------------------------------

export async function removeWorktree(
  exec: ShellExec,
  repoRoot: string,
  branchName: string,
): Promise<WorktreeResult<void>> {
  const taskSlug = taskSlugFromBranch(branchName);
  const relativePath = worktreeRelativePath(taskSlug);

  // Remove worktree (ignore failure — idempotent)
  await exec(
    "git",
    ["worktree", "remove", relativePath, "--force"],
    repoRoot,
  );

  // Delete branch (ignore failure — idempotent)
  await exec("git", ["branch", "-D", branchName], repoRoot);

  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// Pure parsers: git diff output
// ---------------------------------------------------------------------------

type NumstatEntry = { path: string; additions: number; deletions: number };
type NameStatusEntry = { path: string; status: string };

export function parseNumstat(output: string): NumstatEntry[] {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [addStr, delStr, ...pathParts] = line.split("\t");
      return {
        path: pathParts.join("\t"),
        additions: addStr === "-" ? 0 : parseInt(addStr, 10),
        deletions: delStr === "-" ? 0 : parseInt(delStr, 10),
      };
    });
}

export function parseNameStatus(output: string): NameStatusEntry[] {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...pathParts] = line.split("\t");
      return { path: pathParts.join("\t"), status };
    });
}

export function combineDiffFileEntries(
  numstat: NumstatEntry[],
  nameStatus: NameStatusEntry[],
): DiffResult["files"] {
  const statusByPath = new Map(nameStatus.map((e) => [e.path, e.status]));
  return numstat.map((entry) => ({
    path: entry.path,
    status: statusByPath.get(entry.path) ?? "M",
    additions: entry.additions,
    deletions: entry.deletions,
  }));
}

// ---------------------------------------------------------------------------
// getDiff — generates diff between main and agent branch
// ---------------------------------------------------------------------------

export async function getDiff(
  exec: ShellExec,
  repoRoot: string,
  branchName: string,
): Promise<WorktreeResult<DiffResult>> {
  const diffRef = `main...${branchName}`;

  const numstatResult = await exec(
    "git",
    ["diff", "--numstat", diffRef],
    repoRoot,
  );
  if (numstatResult.exitCode !== 0) {
    return gitError(numstatResult.stderr);
  }

  const nameStatusResult = await exec(
    "git",
    ["diff", "--name-status", diffRef],
    repoRoot,
  );
  if (nameStatusResult.exitCode !== 0) {
    return gitError(nameStatusResult.stderr);
  }

  const rawDiffResult = await exec("git", ["diff", diffRef], repoRoot);
  if (rawDiffResult.exitCode !== 0) {
    return gitError(rawDiffResult.stderr);
  }

  const numstatEntries = parseNumstat(numstatResult.stdout);
  const nameStatusEntries = parseNameStatus(nameStatusResult.stdout);
  const files = combineDiffFileEntries(numstatEntries, nameStatusEntries);

  const stats = {
    filesChanged: files.length,
    insertions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };

  return {
    ok: true,
    value: { files, rawDiff: rawDiffResult.stdout, stats },
  };
}

// ---------------------------------------------------------------------------
// mergeBranch — merges agent branch into current branch
// ---------------------------------------------------------------------------

export async function mergeBranch(
  exec: ShellExec,
  repoRoot: string,
  branchName: string,
): Promise<WorktreeResult<void>> {
  const result = await exec(
    "git",
    ["merge", branchName, "--no-ff", "-m", `Merge agent work: ${branchName}`],
    repoRoot,
  );

  if (result.exitCode !== 0) {
    return gitError(result.stderr);
  }

  return { ok: true, value: undefined };
}
