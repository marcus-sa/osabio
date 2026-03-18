import { describe, expect, test } from "bun:test";
import {
  buildAgentOptions,
  type AgentSpawnConfig,
} from "../../../app/src/server/orchestrator/agent-options";

// ---------------------------------------------------------------------------
// Acceptance: buildAgentOptions produces valid SDK options from AgentSpawnConfig
// ---------------------------------------------------------------------------

describe("buildAgentOptions", () => {
  const defaultConfig: AgentSpawnConfig = {
    prompt: "Implement the login feature",
    workDir: "/tmp/worktree/task-123",
    workspaceId: "ws-abc-123",
    brainBaseUrl: "http://localhost:3000",
  };

  test("produces options with prompt, cwd, and maxTurns", () => {
    const options = buildAgentOptions(defaultConfig);

    expect(options.prompt).toBe("Implement the login feature");
    expect(options.options.cwd).toBe("/tmp/worktree/task-123");
    expect(options.options.maxTurns).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Unit: Brain MCP server configured as stdio transport
  // -------------------------------------------------------------------------

  test("configures brain MCP server as stdio transport", () => {
    const options = buildAgentOptions(defaultConfig);

    const brain = options.options.mcpServers?.brain;
    expect(brain).toBeDefined();
    expect(brain!.type).toBe("stdio");
    expect(brain!.command).toBe("brain");
    expect(brain!.args).toEqual(["mcp"]);
  });

  test("passes workspace ID and base URL as MCP env vars", () => {
    const options = buildAgentOptions({
      ...defaultConfig,
      brainBaseUrl: "https://brain.example.com",
      workspaceId: "workspace-456",
      brainIdentityId: "identity-789",
    });

    const env = options.options.mcpServers?.brain?.env;
    expect(env).toBeDefined();
    expect(env!.BRAIN_SERVER_URL).toBe("https://brain.example.com");
    expect(env!.BRAIN_WORKSPACE_ID).toBe("workspace-456");
    expect(env!.BRAIN_IDENTITY_ID).toBe("identity-789");
  });

  test("passes PATH override to MCP server env when configured", () => {
    const previous = process.env.BRAIN_MCP_PATH_OVERRIDE;
    process.env.BRAIN_MCP_PATH_OVERRIDE = "/custom/bin:/usr/bin";
    try {
      const options = buildAgentOptions(defaultConfig);
      const env = options.options.mcpServers?.brain?.env;
      expect(env).toBeDefined();
      expect(env!.PATH).toBe("/custom/bin:/usr/bin");
    } finally {
      if (previous === undefined) {
        delete process.env.BRAIN_MCP_PATH_OVERRIDE;
      } else {
        process.env.BRAIN_MCP_PATH_OVERRIDE = previous;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Unit: Allowed tools for autonomous agent
  // -------------------------------------------------------------------------

  test("includes standard file and search tools in allowedTools", () => {
    const options = buildAgentOptions(defaultConfig);

    expect(options.options.allowedTools).toEqual([
      "Read",
      "Edit",
      "Write",
      "Bash",
      "Glob",
      "Grep",
    ]);
  });

  // -------------------------------------------------------------------------
  // Unit: CLAUDE.md preset loading via systemPrompt and settingSources
  // -------------------------------------------------------------------------

  test("sets systemPrompt to claude_code preset for CLAUDE.md loading", () => {
    const options = buildAgentOptions(defaultConfig);

    expect(options.options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
    });
  });

  test("includes settingSources with project for CLAUDE.md discovery", () => {
    const options = buildAgentOptions(defaultConfig);

    expect(options.options.settingSources).toEqual(["project"]);
  });

  test("injects proxy settings env when provided in spawn config", () => {
    const options = buildAgentOptions({
      ...defaultConfig,
      anthropicBaseUrl: "http://127.0.0.1:3000/proxy/llm/anthropic",
      anthropicCustomHeaders: "X-Brain-Auth: brp_testtoken",
    });

    const settings = options.options.settings as
      | { env?: Record<string, string> }
      | undefined;
    expect(settings).toBeDefined();
    expect(settings?.env?.ANTHROPIC_BASE_URL).toBe(
      "http://127.0.0.1:3000/proxy/llm/anthropic",
    );
    expect(settings?.env?.ANTHROPIC_CUSTOM_HEADERS).toBe(
      "X-Brain-Auth: brp_testtoken",
    );
  });

  test("passes orchestrator-provided Brain auth env vars to MCP server", () => {
    const options = buildAgentOptions({
      ...defaultConfig,
      brainEnv: {
        BRAIN_DPOP_ACCESS_TOKEN: "token-123",
        BRAIN_DPOP_TOKEN_EXPIRES_AT: "1735689600",
      },
    });

    const env = options.options.mcpServers?.brain?.env;
    expect(env).toBeDefined();
    expect(env?.BRAIN_DPOP_ACCESS_TOKEN).toBe("token-123");
    expect(env?.BRAIN_DPOP_TOKEN_EXPIRES_AT).toBe("1735689600");
  });
});
