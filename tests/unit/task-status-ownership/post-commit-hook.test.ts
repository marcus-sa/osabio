import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { installGitHooks } from "../../../cli/commands/init";

let gitRoot: string;

beforeEach(() => {
  gitRoot = mkdtempSync(join(tmpdir(), "brain-post-commit-test-"));
  execSync("git init", { cwd: gitRoot, stdio: "ignore" });
});

afterEach(() => {
  rmSync(gitRoot, { recursive: true, force: true });
});

describe("installGitHooks post-commit", () => {
  it("creates post-commit hook with brain commit-check", () => {
    installGitHooks(gitRoot);

    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("brain commit-check");
  });

  it("post-commit hook is executable (mode 755)", () => {
    installGitHooks(gitRoot);

    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    const mode = statSync(hookPath).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("post-commit hook always exits 0 regardless of commit-check outcome", () => {
    installGitHooks(gitRoot);

    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    const content = readFileSync(hookPath, "utf-8");
    // Fire-and-forget: either backgrounds the command or uses || true / exit 0
    expect(content).toContain("exit 0");
  });

  it("does not overwrite existing non-brain post-commit hook", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nmy-custom-post-commit\n");

    installGitHooks(gitRoot);

    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("my-custom-post-commit");
    expect(content).not.toContain("brain commit-check");
  });

  it("replaces legacy brain log-commit hook with new commit-check hook", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\n# Brain post-commit hook\nbrain log-commit\n");

    installGitHooks(gitRoot);

    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("brain commit-check");
    expect(content).not.toContain("brain log-commit");
  });

  it("is idempotent on second run", () => {
    installGitHooks(gitRoot);
    installGitHooks(gitRoot);

    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    const content = readFileSync(hookPath, "utf-8");
    // Should still have exactly one brain commit-check reference
    const matches = content.match(/brain commit-check/g);
    expect(matches?.length).toBe(1);
  });
});
