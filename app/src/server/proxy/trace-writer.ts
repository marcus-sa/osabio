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
import { logInfo, logError, logWarn } from "../http/observability";
import { calculateCost, type TokenUsage } from "./cost-calculator";
import { getModelPricing } from "./pricing-table";
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
};

type TraceDependencies = {
  readonly surreal: Surreal;
};

// ---------------------------------------------------------------------------
// Retry with Exponential Backoff
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        logWarn("proxy.trace.retry", `Retry ${attempt + 1}/${MAX_RETRIES} for ${label}`, {
          attempt: attempt + 1,
          delay_ms: delayMs,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

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

  // Create session invocation edge when session is resolved
  if (data.sessionId) {
    const sessionRecord = new RecordId("agent_session", data.sessionId);
    await surreal.query(
      `RELATE $session->invoked->$trace SET created_at = time::now();`,
      { session: sessionRecord, trace: traceRecord },
    );
  }

  // Create task attribution edge when task is resolved
  if (data.taskId) {
    const taskRecord = new RecordId("task", data.taskId);
    await surreal.query(
      `RELATE $trace->attributed_to->$task SET created_at = time::now();`,
      { trace: traceRecord, task: taskRecord },
    );
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
