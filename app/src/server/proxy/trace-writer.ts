/**
 * Trace Writer — Async trace capture for LLM proxy calls
 *
 * Creates llm_call trace nodes in SurrealDB after stream/response completion.
 * All graph writes are async via deps.inflight.track() to avoid blocking
 * response delivery.
 *
 * Port: (TraceData, Dependencies) -> Promise<void>
 * Side effects: SurrealDB writes (boundary adapter)
 */

import { RecordId } from "surrealdb";
import { logInfo, logError } from "../http/observability";
import { calculateCost, type TokenUsage } from "./cost-calculator";
import { getModelPricing } from "./pricing-table";
import { withRetry } from "./retry";
import type { Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TraceData = {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly stopReason?: string;
  readonly latencyMs: number;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly requestId?: string;
  readonly conversationId?: string;
  readonly policyDecision?: {
    readonly decision: "pass" | "deny";
    readonly policy_refs: string[];
    readonly reason?: string;
    readonly timestamp: string;
  };
  // Intelligence metadata (context injection)
  readonly intelligenceMetadata?: {
    readonly brain_context_injected: boolean;
    readonly brain_context_decisions: number;
    readonly brain_context_learnings: number;
    readonly brain_context_observations: number;
    readonly brain_context_tokens_est: number;
  };
  // Response content (opaque capture per ADR-051)
  readonly responseContent?: {
    readonly content_blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    readonly stop_reason: string;
    readonly usage: {
      readonly input_tokens: number;
      readonly output_tokens: number;
      readonly cache_creation_tokens?: number;
      readonly cache_read_tokens?: number;
    };
  };
};

type TraceDependencies = {
  readonly surreal: Surreal;
};

// ---------------------------------------------------------------------------
// Trace Node Creation
// ---------------------------------------------------------------------------

async function createTraceNode(
  surreal: Surreal,
  traceId: string,
  data: TraceData,
  costUsd: number,
): Promise<RecordId> {
  const traceRecord = new RecordId("trace", traceId);

  const content: Record<string, unknown> = {
    type: "llm_call",
    model: data.model,
    provider: "anthropic",
    input_tokens: data.inputTokens,
    output_tokens: data.outputTokens,
    cache_creation_tokens: data.cacheCreationTokens,
    cache_read_tokens: data.cacheReadTokens,
    cost_usd: costUsd,
    latency_ms: Math.round(data.latencyMs),
    stop_reason: data.stopReason ?? "end_turn",
    created_at: new Date(),
  };

  // Set workspace directly on the trace node when known
  if (data.workspaceId) {
    content.workspace = new RecordId("workspace", data.workspaceId);
  }

  if (data.requestId) {
    content.request_id = data.requestId;
  }

  // Store conversation reference and intelligence metadata in FLEXIBLE input field
  {
    const inputData: Record<string, unknown> = {};

    if (data.conversationId) {
      inputData.conversation = new RecordId("conversation", data.conversationId);
    }

    if (data.intelligenceMetadata) {
      inputData.brain_context_injected = data.intelligenceMetadata.brain_context_injected;
      inputData.brain_context_decisions = data.intelligenceMetadata.brain_context_decisions;
      inputData.brain_context_learnings = data.intelligenceMetadata.brain_context_learnings;
      inputData.brain_context_observations = data.intelligenceMetadata.brain_context_observations;
      inputData.brain_context_tokens_est = data.intelligenceMetadata.brain_context_tokens_est;
    }

    if (Object.keys(inputData).length > 0) {
      content.input = inputData;
    }
  }

  // Store response content in FLEXIBLE output field (opaque capture per ADR-051)
  if (data.responseContent) {
    content.output = data.responseContent;
  }

  if (data.policyDecision) {
    content.policy_decision = data.policyDecision;
  }

  await surreal.query(`CREATE $trace CONTENT $content;`, {
    trace: traceRecord,
    content,
  });

  return traceRecord;
}

// ---------------------------------------------------------------------------
// Edge Creation
// ---------------------------------------------------------------------------

async function createTraceEdges(
  surreal: Surreal,
  traceRecord: RecordId,
  data: TraceData,
): Promise<void> {
  // Always create workspace scope edge when workspace is known
  if (data.workspaceId) {
    const workspaceRecord = new RecordId("workspace", data.workspaceId);
    await surreal.query(
      `RELATE $trace->scoped_to->$workspace SET created_at = time::now();`,
      { trace: traceRecord, workspace: workspaceRecord },
    );
  }

  // Create session invocation edge only when the session record exists.
  // Try direct ID lookup first, then fall back to external_session_id
  // (Claude Code embeds session IDs in metadata.user_id which map to
  // the external_session_id field on agent_session records).
  if (data.sessionId) {
    const sessionRecord = new RecordId("agent_session", data.sessionId);
    const directLookup = await surreal.query<[Array<{ id: RecordId }>]>(
      `SELECT id FROM $sess;`,
      { sess: sessionRecord },
    );

    let resolvedSession: RecordId | undefined;
    if ((directLookup[0]?.length ?? 0) > 0) {
      resolvedSession = sessionRecord;
    } else {
      // Fall back to external_session_id lookup
      const externalLookup = await surreal.query<[Array<{ id: RecordId }>]>(
        `SELECT id FROM agent_session WHERE external_session_id = $extId LIMIT 1;`,
        { extId: data.sessionId },
      );
      if ((externalLookup[0]?.length ?? 0) > 0) {
        resolvedSession = externalLookup[0][0].id;
      }
    }

    if (resolvedSession) {
      await surreal.query(
        `RELATE $sess->invoked->$trace SET created_at = time::now();`,
        { sess: resolvedSession, trace: traceRecord },
      );
    }
  }

  // Create task attribution edge when task is resolved
  if (data.taskId) {
    const taskRecord = new RecordId("task", data.taskId);
    await surreal.query(
      `RELATE $trace->attributed_to->$task SET created_at = time::now();`,
      { trace: traceRecord, task: taskRecord },
    );
  }

  // Create governed_by edges for policy audit trail
  if (data.policyDecision) {
    for (const policyId of data.policyDecision.policy_refs) {
      const policyRecord = new RecordId("policy", policyId);
      await surreal.query(
        `RELATE $trace->governed_by->$policy SET created_at = time::now(), decision = $decision;`,
        {
          trace: traceRecord,
          policy: policyRecord,
          decision: data.policyDecision.decision,
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture an LLM call trace asynchronously.
 *
 * Computes cost from the pricing table, creates a trace node, and
 * establishes relationship edges. All operations are retried 3x with
 * exponential backoff. On persistent failure, logs structured output
 * instead of throwing.
 *
 * This function returns a Promise that should be tracked via
 * deps.inflight.track() — it must NOT block response delivery.
 */
export async function captureTrace(
  data: TraceData,
  deps: TraceDependencies,
): Promise<void> {
  const traceId = crypto.randomUUID();

  // Compute cost from pricing table (pure)
  const usage: TokenUsage = {
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    cacheCreationTokens: data.cacheCreationTokens,
    cacheReadTokens: data.cacheReadTokens,
  };
  const pricing = getModelPricing(data.model);
  const costUsd = calculateCost(usage, pricing);

  try {
    // Create trace node with retry
    const traceRecord = await withRetry(
      () => createTraceNode(deps.surreal, traceId, data, costUsd),
      "trace_node_create",
    );

    // Create edges with retry
    await withRetry(
      () => createTraceEdges(deps.surreal, traceRecord, data),
      "trace_edges_create",
    );

    logInfo("proxy.trace.captured", "LLM call trace captured", {
      trace_id: traceId,
      model: data.model,
      cost_usd: costUsd,
      workspace_id: data.workspaceId,
    });
  } catch (error) {
    // Fallback: structured log output when graph write fails after retries
    logError("proxy.trace.write_failed", "Failed to write trace after retries, logging fallback", error);
    logInfo("proxy.trace.fallback", "Trace data (graph write failed)", {
      trace_id: traceId,
      model: data.model,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      cache_creation_tokens: data.cacheCreationTokens,
      cache_read_tokens: data.cacheReadTokens,
      cost_usd: costUsd,
      latency_ms: Math.round(data.latencyMs),
      stop_reason: data.stopReason,
      workspace_id: data.workspaceId,
      session_id: data.sessionId,
      task_id: data.taskId,
    });
  }
}
