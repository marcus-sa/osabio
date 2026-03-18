// ---------------------------------------------------------------------------
// Agent spawn configuration and options builder
// ---------------------------------------------------------------------------

export type AgentSpawnConfig = {
  prompt: string;
  workDir: string;
  workspaceId: string;
  brainBaseUrl: string;
  brainIdentityId?: string;
  brainEnv?: Record<string, string>;
  anthropicBaseUrl?: string;
  anthropicCustomHeaders?: string;
};

export function resolveBrainCliCommand(): string {
  return "brain";
}

// ---------------------------------------------------------------------------
// buildAgentOptions — pure function mapping config to SDK query params
// ---------------------------------------------------------------------------

const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Glob",
  "Grep",
] as const;

const MAX_TURNS = 200;

export function buildAgentOptions(
  config: AgentSpawnConfig,
  abortController?: AbortController,
): { prompt: string; options: Record<string, unknown> } {
  const brainCommand = resolveBrainCliCommand();
  const brainMcpPathOverride = process.env.BRAIN_MCP_PATH_OVERRIDE;
  const settingsEnv: Record<string, string> = {
    ...(config.anthropicBaseUrl !== undefined ? { ANTHROPIC_BASE_URL: config.anthropicBaseUrl } : {}),
    ...(config.anthropicCustomHeaders !== undefined ? { ANTHROPIC_CUSTOM_HEADERS: config.anthropicCustomHeaders } : {}),
  };

  return {
    prompt: config.prompt,
    options: {
      cwd: config.workDir,
      maxTurns: MAX_TURNS,
      allowedTools: [...ALLOWED_TOOLS],
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
      settingSources: ["project"] as const,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      mcpServers: {
        brain: {
          type: "stdio",
          command: brainCommand,
          args: ["mcp"],
          env: {
            BRAIN_SERVER_URL: config.brainBaseUrl,
            BRAIN_WORKSPACE_ID: config.workspaceId,
            ...(config.brainIdentityId !== undefined ? { BRAIN_IDENTITY_ID: config.brainIdentityId } : {}),
            ...(config.brainEnv ?? {}),
            ...(brainMcpPathOverride !== undefined ? { PATH: brainMcpPathOverride } : {}),
          },
        },
      },
      ...(Object.keys(settingsEnv).length > 0 ? { settings: { env: settingsEnv } } : {}),
      ...(abortController !== undefined ? { abortController } : {}),
    },
  };
}
