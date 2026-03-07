// ---------------------------------------------------------------------------
// Agent spawning — SDK adapter over @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------

import { buildAgentOptions, type AgentSpawnConfig } from "./agent-options";
import type { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";

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

// ---------------------------------------------------------------------------
// createSpawnAgent — factory that injects the query function dependency
// ---------------------------------------------------------------------------

export function createSpawnAgent(queryFn: QueryFn): SpawnAgentFn {
  return (config: AgentSpawnConfig): AgentHandle => {
    const abortController = new AbortController();
    const opts = buildAgentOptions(config, abortController);

    const stream = queryFn(opts);

    return {
      messages: stream,
      abort: () => abortController.abort(),
    };
  };
}
