/**
 * Verifies OpenCode removal from init-content.ts and init.ts
 *
 * Step: 03-01 (CLI init OpenCode removal)
 *
 * After removal:
 * - No OpenCode-specific exports remain in init-content.ts
 * - BRAIN_HOOKS, BRAIN_CLAUDE_MD, BRAIN_COMMANDS exports preserved
 * - setupOpencode is not exported from init.ts
 */
import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// init-content.ts: OpenCode exports removed, Brain exports preserved
// ---------------------------------------------------------------------------

describe("init-content exports after OpenCode removal", () => {
  it("preserves BRAIN_HOOKS export", async () => {
    const mod = await import("../../cli/commands/init-content");
    expect(mod.BRAIN_HOOKS).toBeDefined();
    expect(typeof mod.BRAIN_HOOKS).toBe("object");
  });

  it("preserves BRAIN_CLAUDE_MD export", async () => {
    const mod = await import("../../cli/commands/init-content");
    expect(mod.BRAIN_CLAUDE_MD).toBeDefined();
    expect(typeof mod.BRAIN_CLAUDE_MD).toBe("string");
  });

  it("preserves BRAIN_COMMANDS export", async () => {
    const mod = await import("../../cli/commands/init-content");
    expect(mod.BRAIN_COMMANDS).toBeDefined();
    expect(typeof mod.BRAIN_COMMANDS).toBe("object");
  });

  it("does not export OPENCODE_PLUGIN_CONTENT", async () => {
    const mod = await import("../../cli/commands/init-content");
    expect((mod as Record<string, unknown>).OPENCODE_PLUGIN_CONTENT).toBeUndefined();
  });

  it("does not export buildOpencodeJsonContent", async () => {
    const mod = await import("../../cli/commands/init-content");
    expect((mod as Record<string, unknown>).buildOpencodeJsonContent).toBeUndefined();
  });

  it("does not export OPENCODE_MD_CONTENT", async () => {
    const mod = await import("../../cli/commands/init-content");
    expect((mod as Record<string, unknown>).OPENCODE_MD_CONTENT).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// init.ts: setupOpencode removed
// ---------------------------------------------------------------------------

describe("init exports after OpenCode removal", () => {
  it("does not export setupOpencode", async () => {
    const mod = await import("../../cli/commands/init");
    expect((mod as Record<string, unknown>).setupOpencode).toBeUndefined();
  });

  it("still exports runInit", async () => {
    const mod = await import("../../cli/commands/init");
    expect(mod.runInit).toBeDefined();
    expect(typeof mod.runInit).toBe("function");
  });

  it("still exports setupMcpJson", async () => {
    const mod = await import("../../cli/commands/init");
    expect(mod.setupMcpJson).toBeDefined();
  });

  it("still exports setupClaudeHooks", async () => {
    const mod = await import("../../cli/commands/init");
    expect(mod.setupClaudeHooks).toBeDefined();
  });

  it("still exports setupClaudeMd", async () => {
    const mod = await import("../../cli/commands/init");
    expect(mod.setupClaudeMd).toBeDefined();
  });

  it("still exports setupCommands", async () => {
    const mod = await import("../../cli/commands/init");
    expect(mod.setupCommands).toBeDefined();
  });

  it("still exports installGitHooks", async () => {
    const mod = await import("../../cli/commands/init");
    expect(mod.installGitHooks).toBeDefined();
  });
});
