/**
 * OpenCode Plugin Init: brain init --opencode generates plugin files
 *
 * Traces: Step 04-03 (Brain OpenCode plugin and init command extension)
 *
 * Validates that the init --opencode command produces:
 * - .opencode/plugins/brain.ts with tool registrations and lifecycle hooks
 * - opencode.json referencing the Brain plugin
 * - OPENCODE.md with agent instructions
 *
 * Driving port: setupOpencode (init command extension)
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { setupOpencode } from "../../../cli/commands/init";
import { OPENCODE_MD_CONTENT } from "../../../cli/commands/init-content";

let gitRoot: string;

beforeEach(() => {
  gitRoot = mkdtempSync(join(tmpdir(), "brain-opencode-init-"));
  execSync("git init", { cwd: gitRoot, stdio: "ignore" });
});

afterEach(() => {
  rmSync(gitRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Acceptance: setupOpencode produces all required files
// ---------------------------------------------------------------------------

describe("setupOpencode", () => {
  it("generates plugin file, opencode.json, and OPENCODE.md", async () => {
    await setupOpencode(gitRoot, {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    });

    // Plugin file exists at .opencode/plugins/brain.ts
    expect(existsSync(join(gitRoot, ".opencode", "plugins", "brain.ts"))).toBe(true);

    // opencode.json exists and references the plugin
    expect(existsSync(join(gitRoot, "opencode.json"))).toBe(true);

    // OPENCODE.md exists with agent instructions
    expect(existsSync(join(gitRoot, "OPENCODE.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: Plugin file content
// ---------------------------------------------------------------------------

describe("OpenCode plugin file content", () => {
  it("registers tool definitions for task-context, project-context, status-update, and observations", async () => {
    await setupOpencode(gitRoot, {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    });

    const pluginContent = readFileSync(
      join(gitRoot, ".opencode", "plugins", "brain.ts"),
      "utf-8",
    );

    expect(pluginContent).toContain("task-context");
    expect(pluginContent).toContain("project-context");
    expect(pluginContent).toContain("status-update");
    expect(pluginContent).toContain("observations");
  });

  it("registers lifecycle hooks for session.created and session.idle", async () => {
    await setupOpencode(gitRoot, {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    });

    const pluginContent = readFileSync(
      join(gitRoot, ".opencode", "plugins", "brain.ts"),
      "utf-8",
    );

    expect(pluginContent).toContain("session.created");
    expect(pluginContent).toContain("session.idle");
  });

  it("embeds the correct Brain API base URL and workspace ID", async () => {
    await setupOpencode(gitRoot, {
      brainBaseUrl: "https://brain.example.com",
      workspaceId: "workspace-456",
      authToken: "jwt-token-xyz",
    });

    const pluginContent = readFileSync(
      join(gitRoot, ".opencode", "plugins", "brain.ts"),
      "utf-8",
    );

    expect(pluginContent).toContain("https://brain.example.com");
    expect(pluginContent).toContain("workspace-456");
  });
});

// ---------------------------------------------------------------------------
// Unit: opencode.json content
// ---------------------------------------------------------------------------

describe("Generated opencode.json", () => {
  it("references the Brain plugin path", async () => {
    await setupOpencode(gitRoot, {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    });

    const config = JSON.parse(
      readFileSync(join(gitRoot, "opencode.json"), "utf-8"),
    );

    expect(config.plugins).toBeDefined();
    expect(config.plugins).toContain(".opencode/plugins/brain.ts");
  });

  it("preserves existing opencode.json entries", async () => {
    const existingConfig = {
      model: { provider: "openrouter", model: "gpt-4o" },
      plugins: ["other-plugin.ts"],
    };
    Bun.write(
      join(gitRoot, "opencode.json"),
      JSON.stringify(existingConfig, null, 2),
    );

    await setupOpencode(gitRoot, {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    });

    const config = JSON.parse(
      readFileSync(join(gitRoot, "opencode.json"), "utf-8"),
    );

    // Existing plugin preserved
    expect(config.plugins).toContain("other-plugin.ts");
    // Brain plugin added
    expect(config.plugins).toContain(".opencode/plugins/brain.ts");
    // Existing model preserved
    expect(config.model.provider).toBe("openrouter");
  });

  it("does not duplicate brain plugin on second run", async () => {
    const params = {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    };

    await setupOpencode(gitRoot, params);
    await setupOpencode(gitRoot, params);

    const config = JSON.parse(
      readFileSync(join(gitRoot, "opencode.json"), "utf-8"),
    );

    const brainPluginCount = config.plugins.filter(
      (p: string) => p === ".opencode/plugins/brain.ts",
    ).length;
    expect(brainPluginCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Unit: OPENCODE.md content
// ---------------------------------------------------------------------------

describe("Generated OPENCODE.md", () => {
  it("contains agent instructions for Brain integration", async () => {
    await setupOpencode(gitRoot, {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    });

    const content = readFileSync(join(gitRoot, "OPENCODE.md"), "utf-8");

    expect(content).toContain("Brain");
    expect(content).toContain("knowledge graph");
  });

  it("is idempotent on second run", async () => {
    const params = {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    };

    await setupOpencode(gitRoot, params);
    const firstContent = readFileSync(join(gitRoot, "OPENCODE.md"), "utf-8");

    await setupOpencode(gitRoot, params);
    const secondContent = readFileSync(join(gitRoot, "OPENCODE.md"), "utf-8");

    expect(secondContent).toBe(firstContent);
  });
});

// ---------------------------------------------------------------------------
// Unit: Directory creation
// ---------------------------------------------------------------------------

describe("OpenCode directory structure", () => {
  it("creates .opencode/plugins directory if missing", async () => {
    expect(existsSync(join(gitRoot, ".opencode"))).toBe(false);

    await setupOpencode(gitRoot, {
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-test-123",
      authToken: "jwt-token-abc",
    });

    expect(existsSync(join(gitRoot, ".opencode", "plugins"))).toBe(true);
  });
});
