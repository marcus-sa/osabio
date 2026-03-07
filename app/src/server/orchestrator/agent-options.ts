// ---------------------------------------------------------------------------
// Agent spawn configuration and options builder
// ---------------------------------------------------------------------------

export type AgentSpawnConfig = {
  prompt: string;
  workDir: string;
  workspaceId: string;
  brainBaseUrl: string;
};

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
          command: process.env.NODE_ENV === "development" ? `${process.cwd()}/cli/brain.ts` : "brain",
          args: ["mcp"],
          env: {
            BRAIN_SERVER_URL: config.brainBaseUrl,
            BRAIN_WORKSPACE_ID: config.workspaceId,
          },
        },
      },
      ...(abortController !== undefined ? { abortController } : {}),
    },
  };
}
