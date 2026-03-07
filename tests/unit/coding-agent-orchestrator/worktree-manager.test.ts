import { describe, expect, test } from "bun:test";
import {
  createWorktree,
  removeWorktree,
  getDiff,
  mergeBranch,
  buildWorktreePath,
  buildBranchName,
  parseNumstat,
  parseNameStatus,
  combineDiffFileEntries,
  type WorktreeInfo,
  type WorktreeError,
  type WorktreeResult,
  type ShellExec,
  type DiffResult,
} from "../../../app/src/server/orchestrator/worktree-manager";

// ---------------------------------------------------------------------------
// Shell executor stub factory
// ---------------------------------------------------------------------------

type ShellCall = { command: string; args: string[]; cwd: string };

function createShellStub(options?: {
  failOnPattern?: string;
  stderr?: string;
}): { exec: ShellExec; calls: ShellCall[] } {
  const calls: ShellCall[] = [];
  const exec: ShellExec = async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (
      options?.failOnPattern &&
      args.some((a) => a.includes(options.failOnPattern!))
    ) {
      return {
        exitCode: 128,
        stdout: "",
        stderr: options.stderr ?? "fatal: already exists",
      };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// Pure helpers: path and branch construction
// ---------------------------------------------------------------------------

describe("Worktree Manager: path construction", () => {
  test("builds worktree path from repo root and task slug", () => {
    const path = buildWorktreePath("/repo", "fix-login-bug");
    expect(path).toBe("/repo/.brain/worktrees/agent-fix-login-bug");
  });

  test("builds branch name from task slug", () => {
    const branch = buildBranchName("fix-login-bug");
    expect(branch).toBe("agent/fix-login-bug");
  });
});

// ---------------------------------------------------------------------------
// createWorktree: acceptance — returns WorktreeInfo on success
// ---------------------------------------------------------------------------

describe("Worktree Manager: createWorktree", () => {
  test("returns worktree path and branch name on success", async () => {
    const { exec } = createShellStub();

    const result = await createWorktree(exec, "/repo", "fix-login-bug");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.worktreePath).toBe(
        "/repo/.brain/worktrees/agent-fix-login-bug",
      );
      expect(result.value.branchName).toBe("agent/fix-login-bug");
    }
  });

  test("invokes git worktree add with correct arguments", async () => {
    const { exec, calls } = createShellStub();

    await createWorktree(exec, "/repo", "fix-login-bug");

    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call.command).toBe("git");
    expect(call.args).toEqual([
      "worktree",
      "add",
      "-b",
      "agent/fix-login-bug",
      ".brain/worktrees/agent-fix-login-bug",
    ]);
    expect(call.cwd).toBe("/repo");
  });

  test("returns error when worktree already exists", async () => {
    const { exec } = createShellStub({
      failOnPattern: "worktree",
      stderr: "fatal: 'agent-fix-login-bug' already exists",
    });

    const result = await createWorktree(exec, "/repo", "fix-login-bug");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WORKTREE_EXISTS");
      expect(result.error.message).toContain("already exists");
    }
  });

  test("returns error on unexpected git failure", async () => {
    const { exec } = createShellStub({
      failOnPattern: "worktree",
      stderr: "fatal: not a git repository",
    });

    const result = await createWorktree(exec, "/repo", "fix-login-bug");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GIT_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// removeWorktree: idempotent removal
// ---------------------------------------------------------------------------

describe("Worktree Manager: removeWorktree", () => {
  test("removes worktree and deletes branch", async () => {
    const { exec, calls } = createShellStub();

    const result = await removeWorktree(exec, "/repo", "agent/fix-login-bug");

    expect(result.ok).toBe(true);
    // Should issue two git commands: worktree remove + branch delete
    expect(calls.length).toBe(2);
    expect(calls[0].args).toEqual([
      "worktree",
      "remove",
      ".brain/worktrees/agent-fix-login-bug",
      "--force",
    ]);
    expect(calls[1].args).toEqual(["branch", "-D", "agent/fix-login-bug"]);
  });

  test("succeeds even when worktree is already removed", async () => {
    const { exec } = createShellStub({
      failOnPattern: "worktree",
      stderr: "fatal: not a valid directory",
    });

    const result = await removeWorktree(exec, "/repo", "agent/fix-login-bug");

    // Idempotent: no error
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure parsing: parseNumstat
// ---------------------------------------------------------------------------

describe("Worktree Manager: parseNumstat", () => {
  test("parses numstat output into additions/deletions per file", () => {
    const input = "10\t5\tsrc/app.ts\n3\t0\tsrc/utils.ts\n";
    const result = parseNumstat(input);

    expect(result).toEqual([
      { path: "src/app.ts", additions: 10, deletions: 5 },
      { path: "src/utils.ts", additions: 3, deletions: 0 },
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(parseNumstat("")).toEqual([]);
    expect(parseNumstat("\n")).toEqual([]);
  });

  test("handles binary files with dash stats", () => {
    const input = "-\t-\timage.png\n5\t2\treadme.md\n";
    const result = parseNumstat(input);

    expect(result).toEqual([
      { path: "image.png", additions: 0, deletions: 0 },
      { path: "readme.md", additions: 5, deletions: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pure parsing: parseNameStatus
// ---------------------------------------------------------------------------

describe("Worktree Manager: parseNameStatus", () => {
  test("parses name-status output into path/status pairs", () => {
    const input = "M\tsrc/app.ts\nA\tsrc/new-file.ts\nD\told-file.ts\n";
    const result = parseNameStatus(input);

    expect(result).toEqual([
      { path: "src/app.ts", status: "M" },
      { path: "src/new-file.ts", status: "A" },
      { path: "old-file.ts", status: "D" },
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(parseNameStatus("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure parsing: combineDiffFileEntries
// ---------------------------------------------------------------------------

describe("Worktree Manager: combineDiffFileEntries", () => {
  test("combines numstat and name-status entries by path", () => {
    const numstat = [
      { path: "src/app.ts", additions: 10, deletions: 5 },
      { path: "src/new.ts", additions: 20, deletions: 0 },
    ];
    const nameStatus = [
      { path: "src/app.ts", status: "M" },
      { path: "src/new.ts", status: "A" },
    ];

    const result = combineDiffFileEntries(numstat, nameStatus);

    expect(result).toEqual([
      { path: "src/app.ts", status: "M", additions: 10, deletions: 5 },
      { path: "src/new.ts", status: "A", additions: 20, deletions: 0 },
    ]);
  });

  test("defaults status to M when file missing from name-status", () => {
    const numstat = [{ path: "src/app.ts", additions: 3, deletions: 1 }];
    const nameStatus: Array<{ path: string; status: string }> = [];

    const result = combineDiffFileEntries(numstat, nameStatus);

    expect(result).toEqual([
      { path: "src/app.ts", status: "M", additions: 3, deletions: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Shell stub with per-command response mapping
// ---------------------------------------------------------------------------

type CommandResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function createRoutingShellStub(
  routes: Record<string, CommandResponse>,
): { exec: ShellExec; calls: ShellCall[] } {
  const calls: ShellCall[] = [];
  const exec: ShellExec = async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    // Match on first two args (e.g. "diff --numstat", "diff --name-status")
    const key = args.slice(0, 2).join(" ");
    if (routes[key]) return routes[key];
    // Fallback: match on first arg
    if (routes[args[0]]) return routes[args[0]];
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// getDiff: acceptance — returns parsed DiffResult
// ---------------------------------------------------------------------------

describe("Worktree Manager: getDiff", () => {
  test("returns files with path, status, additions, deletions and stats", async () => {
    const { exec } = createRoutingShellStub({
      "diff --numstat": {
        exitCode: 0,
        stdout: "10\t5\tsrc/app.ts\n3\t0\tsrc/utils.ts\n",
        stderr: "",
      },
      "diff --name-status": {
        exitCode: 0,
        stdout: "M\tsrc/app.ts\nA\tsrc/utils.ts\n",
        stderr: "",
      },
      "diff main...agent/fix-login-bug": {
        exitCode: 0,
        stdout: "diff --git a/src/app.ts b/src/app.ts\n...",
        stderr: "",
      },
    });

    const result = await getDiff(exec, "/repo", "agent/fix-login-bug");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toEqual([
        { path: "src/app.ts", status: "M", additions: 10, deletions: 5 },
        { path: "src/utils.ts", status: "A", additions: 3, deletions: 0 },
      ]);
      expect(result.value.stats).toEqual({
        filesChanged: 2,
        insertions: 13,
        deletions: 5,
      });
      expect(result.value.rawDiff).toContain("diff --git");
    }
  });

  test("invokes correct git diff commands", async () => {
    const { exec, calls } = createRoutingShellStub({});

    await getDiff(exec, "/repo", "agent/fix-login-bug");

    // Should call: numstat, name-status, raw diff
    expect(calls.length).toBe(3);
    expect(calls[0].args).toContain("--numstat");
    expect(calls[0].args).toContain("main...agent/fix-login-bug");
    expect(calls[1].args).toContain("--name-status");
    expect(calls[1].args).toContain("main...agent/fix-login-bug");
    expect(calls[2].args).toContain("main...agent/fix-login-bug");
  });

  test("returns empty diff result when no changes exist", async () => {
    const { exec } = createRoutingShellStub({});

    const result = await getDiff(exec, "/repo", "agent/fix-login-bug");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toEqual([]);
      expect(result.value.stats).toEqual({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      });
      expect(result.value.rawDiff).toBe("");
    }
  });

  test("returns error when git diff fails", async () => {
    const { exec } = createRoutingShellStub({
      "diff --numstat": {
        exitCode: 128,
        stdout: "",
        stderr: "fatal: bad revision",
      },
    });

    const result = await getDiff(exec, "/repo", "agent/fix-login-bug");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GIT_ERROR");
      expect(result.error.message).toContain("bad revision");
    }
  });
});

// ---------------------------------------------------------------------------
// mergeBranch: merges agent branch into current branch
// ---------------------------------------------------------------------------

describe("Worktree Manager: mergeBranch", () => {
  test("merges branch with no-ff and returns success", async () => {
    const { exec, calls } = createRoutingShellStub({});

    const result = await mergeBranch(exec, "/repo", "agent/fix-login-bug");

    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe("git");
    expect(calls[0].args).toContain("merge");
    expect(calls[0].args).toContain("agent/fix-login-bug");
    expect(calls[0].args).toContain("--no-ff");
    expect(calls[0].cwd).toBe("/repo");
  });

  test("includes descriptive merge commit message", async () => {
    const { exec, calls } = createRoutingShellStub({});

    await mergeBranch(exec, "/repo", "agent/fix-login-bug");

    const mIndex = calls[0].args.indexOf("-m");
    expect(mIndex).toBeGreaterThan(-1);
    const message = calls[0].args[mIndex + 1];
    expect(message).toContain("agent/fix-login-bug");
  });

  test("returns error when merge fails", async () => {
    const { exec } = createRoutingShellStub({
      merge: {
        exitCode: 1,
        stdout: "",
        stderr: "CONFLICT (content): Merge conflict in src/app.ts",
      },
    });

    const result = await mergeBranch(exec, "/repo", "agent/fix-login-bug");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GIT_ERROR");
      expect(result.error.message).toContain("Merge conflict");
    }
  });
});
