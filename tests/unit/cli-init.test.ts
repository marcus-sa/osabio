import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  setupMcpJson,
  setupClaudeHooks,
  setupClaudeMd,
  setupCommands,
  installGitHooks,
  MARKER_START,
  MARKER_END,
} from "../../cli/commands/init";
import { BRAIN_HOOKS, BRAIN_CLAUDE_MD, BRAIN_COMMANDS } from "../../cli/commands/init-content";

let gitRoot: string;

beforeEach(() => {
  gitRoot = mkdtempSync(join(tmpdir(), "brain-init-test-"));
  execSync("git init", { cwd: gitRoot, stdio: "ignore" });
});

afterEach(() => {
  rmSync(gitRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// setupMcpJson
// ---------------------------------------------------------------------------

describe("setupMcpJson", () => {
  it("creates .mcp.json with brain server entry", async () => {
    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.brain).toEqual({ command: "brain", args: ["mcp"] });
  });

  it("preserves existing MCP servers", async () => {
    writeFileSync(
      join(gitRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other-tool" } } }),
    );

    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.other).toEqual({ command: "other-tool" });
    expect(mcp.mcpServers.brain).toEqual({ command: "brain", args: ["mcp"] });
  });

  it("is idempotent on second run", async () => {
    await setupMcpJson(gitRoot);
    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["brain"]);
  });

  it("recovers from corrupted file", async () => {
    writeFileSync(join(gitRoot, ".mcp.json"), "not-json{{{");

    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.brain).toEqual({ command: "brain", args: ["mcp"] });
  });
});

// ---------------------------------------------------------------------------
// setupClaudeHooks
// ---------------------------------------------------------------------------

describe("setupClaudeHooks", () => {
  const expectedEvents = ["PreToolUse", "SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];

  it("creates settings.json with all hook events", async () => {
    await setupClaudeHooks(gitRoot);

    const settings = JSON.parse(readFileSync(join(gitRoot, ".claude", "settings.json"), "utf-8"));
    for (const event of expectedEvents) {
      expect(settings.hooks[event]).toBeDefined();
      expect(settings.hooks[event].length).toBeGreaterThan(0);
    }
  });

  it("preserves existing non-brain hooks", async () => {
    mkdirSync(join(gitRoot, ".claude"), { recursive: true });
    writeFileSync(
      join(gitRoot, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "eslint" }] }] },
        otherSetting: true,
      }),
    );

    await setupClaudeHooks(gitRoot);

    const settings = JSON.parse(readFileSync(join(gitRoot, ".claude", "settings.json"), "utf-8"));
    expect(settings.otherSetting).toBe(true);
    // eslint hook preserved + brain hook added
    expect(settings.hooks.PreToolUse.length).toBe(2);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("eslint");
  });

  it("does not duplicate brain hooks on second run", async () => {
    await setupClaudeHooks(gitRoot);
    await setupClaudeHooks(gitRoot);

    const settings = JSON.parse(readFileSync(join(gitRoot, ".claude", "settings.json"), "utf-8"));
    for (const event of expectedEvents) {
      expect(settings.hooks[event].length).toBe(1);
    }
  });

  it("creates .claude directory if missing", async () => {
    expect(existsSync(join(gitRoot, ".claude"))).toBe(false);

    await setupClaudeHooks(gitRoot);

    expect(existsSync(join(gitRoot, ".claude", "settings.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setupClaudeMd
// ---------------------------------------------------------------------------

describe("setupClaudeMd", () => {
  it("creates CLAUDE.md with marker-wrapped brain block", async () => {
    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    expect(content).toContain(MARKER_START);
    expect(content).toContain(MARKER_END);
    expect(content).toContain(BRAIN_CLAUDE_MD);
  });

  it("appends to existing CLAUDE.md", async () => {
    writeFileSync(join(gitRoot, "CLAUDE.md"), "# My Project\n\nExisting content.");

    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    expect(content).toStartWith("# My Project\n\nExisting content.");
    expect(content).toContain(MARKER_START);
    expect(content).toContain(BRAIN_CLAUDE_MD);
  });

  it("updates in-place between markers on second run", async () => {
    await setupClaudeMd(gitRoot);
    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    // Only one pair of markers
    const startCount = content.split(MARKER_START).length - 1;
    const endCount = content.split(MARKER_END).length - 1;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it("preserves content before and after brain block when updating", async () => {
    const before = "# My Project\n\nBefore content.\n\n";
    const after = "\n\n## After Section\n\nAfter content.";
    writeFileSync(
      join(gitRoot, "CLAUDE.md"),
      `${before}${MARKER_START}\nold stuff\n${MARKER_END}${after}`,
    );

    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    expect(content).toStartWith(before);
    expect(content).toEndWith(after);
    expect(content).toContain(BRAIN_CLAUDE_MD);
  });
});

// ---------------------------------------------------------------------------
// setupCommands
// ---------------------------------------------------------------------------

describe("setupCommands", () => {
  it("creates all command files", async () => {
    await setupCommands(gitRoot);

    for (const filename of Object.keys(BRAIN_COMMANDS)) {
      expect(existsSync(join(gitRoot, ".claude", "commands", filename))).toBe(true);
    }
  });

  it("writes correct content with trailing newline", async () => {
    await setupCommands(gitRoot);

    for (const [filename, expectedContent] of Object.entries(BRAIN_COMMANDS)) {
      const actual = readFileSync(join(gitRoot, ".claude", "commands", filename), "utf-8");
      expect(actual).toBe(expectedContent + "\n");
    }
  });

  it("creates directory structure if missing", async () => {
    expect(existsSync(join(gitRoot, ".claude", "commands"))).toBe(false);

    await setupCommands(gitRoot);

    expect(existsSync(join(gitRoot, ".claude", "commands"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// installGitHooks
// ---------------------------------------------------------------------------

describe("installGitHooks", () => {
  it("creates pre-commit hook with correct content and permissions", () => {
    installGitHooks(gitRoot);

    const hookPath = join(gitRoot, ".git", "hooks", "pre-commit");
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("brain check-commit");

    const mode = statSync(hookPath).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("does not overwrite existing pre-commit hook", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "pre-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nmy-custom-hook\n");

    installGitHooks(gitRoot);

    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("my-custom-hook");
    expect(content).not.toContain("brain check-commit");
  });

  it("removes legacy Brain post-commit hook", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\n# Brain post-commit hook\nbrain log-commit\n");

    installGitHooks(gitRoot);

    expect(existsSync(hookPath)).toBe(false);
  });

  it("preserves non-Brain post-commit hooks", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nmy-custom-post-commit\n");

    installGitHooks(gitRoot);

    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("my-custom-post-commit");
  });
});
