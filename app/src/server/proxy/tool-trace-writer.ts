/**
 * Tool Trace Writer -- Effect Boundary
 *
 * Writes tool_call trace records to SurrealDB for forensic auditability.
 * Each Brain-native tool execution produces a trace with type, tool_name,
 * actor identity, workspace, outcome, and duration_ms.
 *
 * Port: (ToolTraceData, TraceDeps) -> Promise<void>
 * Side effects: SurrealDB writes (boundary adapter)
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import { withRetry } from "./retry";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolTraceOutcome = "success" | "error";

export type ToolTraceData = {
  readonly toolName: string;
  readonly workspaceId: string;
  readonly identityId?: string;
  readonly outcome: ToolTraceOutcome;
  readonly durationMs: number;
  readonly input?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
};

export type ToolTraceDeps = {
  readonly surreal: Surreal;
};

// ---------------------------------------------------------------------------
// Trace Node Creation
// ---------------------------------------------------------------------------

async function createToolTraceNode(
  surreal: Surreal,
  traceId: string,
  data: ToolTraceData,
): Promise<void> {
  const traceRecord = new RecordId("trace", traceId);

  const content: Record<string, unknown> = {
    type: "tool_call",
    tool_name: data.toolName,
    workspace: new RecordId("workspace", data.workspaceId),
    duration_ms: Math.round(data.durationMs),
    created_at: new Date(),
    output: { outcome: data.outcome },
  };

  if (data.identityId) {
    content.actor = new RecordId("identity", data.identityId);
  }

  if (data.input) {
    content.input = data.input;
  }

  await surreal.query(`CREATE $trace CONTENT $content;`, {
    trace: traceRecord,
    content,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a tool call trace asynchronously.
 *
 * Creates a trace node with type=tool_call. Retries 3x with exponential
 * backoff. On persistent failure, logs structured output instead of throwing.
 *
 * This function returns a Promise that should be tracked via
 * deps.inflight.track() -- it must NOT block response delivery.
 */
export async function captureToolTrace(
  data: ToolTraceData,
  deps: ToolTraceDeps,
): Promise<void> {
  const traceId = crypto.randomUUID();

  try {
    await withRetry(
      () => createToolTraceNode(deps.surreal, traceId, data),
      "tool_trace_create",
    );

    log.info("proxy.tool_trace.captured", "Tool call trace captured", {
      trace_id: traceId,
      tool_name: data.toolName,
      outcome: data.outcome,
      duration_ms: Math.round(data.durationMs),
      workspace_id: data.workspaceId,
    });
  } catch (error) {
    log.error("proxy.tool_trace.write_failed", "Failed to write tool trace after retries", error);
    log.info("proxy.tool_trace.fallback", "Tool trace data (graph write failed)", {
      trace_id: traceId,
      tool_name: data.toolName,
      outcome: data.outcome,
      duration_ms: Math.round(data.durationMs),
      workspace_id: data.workspaceId,
      identity_id: data.identityId,
    });
  }
}
