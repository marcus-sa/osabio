// ---------------------------------------------------------------------------
// Agent spawning — SDK adapter over @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------

import {
  buildAgentOptions,
  resolveBrainCliCommand,
  type AgentSpawnConfig,
} from "./agent-options";
import type { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { constants, accessSync } from "node:fs";
import { delimiter, join } from "node:path";

// ---------------------------------------------------------------------------
// QueryFn — port type matching the SDK's query() signature
// ---------------------------------------------------------------------------

export type QueryFn = typeof sdkQuery;

// ---------------------------------------------------------------------------
// AgentHandle — returned by spawnAgent
// ---------------------------------------------------------------------------

export type AgentHandle = {
  messages: AsyncIterable<unknown>;
  abort: () => void;
};

// ---------------------------------------------------------------------------
// SpawnAgentFn — port signature for agent spawning
// ---------------------------------------------------------------------------

export type SpawnAgentFn = (config: AgentSpawnConfig) => AgentHandle;

type SpawnAgentDeps = {
  ensureBrainCliAvailable?: () => void;
};

function ensureBrainCliAvailable(): void {
  const command = resolveBrainCliCommand();
  const isPathCommand = command.includes("/") || command.includes("\\");

  if (isPathCommand) {
    try {
      accessSync(command, constants.X_OK);
    } catch {
      throw new Error(`Brain CLI is not executable at "${command}".`);
    }
    return;
  }

  const pathOverride = process.env.BRAIN_MCP_PATH_OVERRIDE;
  if (pathOverride !== undefined) {
    const entries = pathOverride
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    for (const entry of entries) {
      try {
        accessSync(join(entry, command), constants.X_OK);
        return;
      } catch {
        continue;
      }
    }

    throw new Error(`Brain CLI "${command}" was not found on BRAIN_MCP_PATH_OVERRIDE.`);
  }

  if (!Bun.which(command)) {
    throw new Error(`Brain CLI "${command}" was not found on PATH.`);
  }
}

// ---------------------------------------------------------------------------
// createSpawnAgent — factory that injects the query function dependency
// ---------------------------------------------------------------------------

export function createSpawnAgent(
  queryFn: QueryFn,
  deps?: SpawnAgentDeps,
): SpawnAgentFn {
  const ensureCli = deps?.ensureBrainCliAvailable ?? ensureBrainCliAvailable;

  return (config: AgentSpawnConfig): AgentHandle => {
    // Fail fast before Claude starts if Brain CLI is unavailable.
    ensureCli();

    const abortController = new AbortController();
    const opts = buildAgentOptions(config, abortController);

    const stream = queryFn(opts);

    return {
      messages: stream,
      abort: () => abortController.abort(),
    };
  };
}
