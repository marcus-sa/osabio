/**
 * Tool Executor -- Effect Boundary
 *
 * Executes Brain-native tool calls via graph queries. This is the adapter/effect
 * boundary -- it performs IO (SurrealDB queries) to fulfill tool calls that the
 * pure tool-router classified as "brain-native".
 *
 * Each Brain-native tool handler is a function: (input, deps) -> ToolExecutionResult.
 * Unknown tool names produce an error result (not an exception).
 *
 * Step 8.5 in the proxy pipeline.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { ClassifiedToolCall } from "./tool-router";
import { log } from "../telemetry/logger";
import { captureToolTrace } from "./tool-trace-writer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of executing a single Brain-native tool call. */
export type ToolExecutionResult = {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
};

/** Dependencies injected into tool executors. */
export type ToolExecutorDeps = {
  readonly surreal: Surreal;
  readonly workspaceId: string;
  readonly identityId?: string;
};

/** Anthropic tool_result content block for follow-up requests. */
export type ToolResultMessage = {
  role: "user";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }>;
};

/** Handler for a single Brain-native tool. */
type BrainToolHandler = (
  input: Record<string, unknown>,
  deps: ToolExecutorDeps,
) => Promise<ToolExecutionResult>;

// ---------------------------------------------------------------------------
// Brain-Native Tool Handlers
// ---------------------------------------------------------------------------

const searchEntitiesHandler: BrainToolHandler = async (input, deps) => {
  const query = typeof input.query === "string" ? input.query : "";

  if (!query.trim()) {
    return {
      toolUseId: "", // filled by caller
      content: JSON.stringify({ results: [], message: "Empty search query" }),
      isError: false,
    };
  }

  const workspaceRecord = new RecordId("workspace", deps.workspaceId);

  // Simple keyword search across tasks, decisions, and features
  // Uses basic string matching (CONTAINS) for the walking skeleton.
  // Future: BM25 fulltext search.
  type EntityRow = {
    id: RecordId;
    table: string;
    title?: string;
    summary?: string;
    text?: string;
    status?: string;
  };

  const results = await deps.surreal.query<[EntityRow[], EntityRow[], EntityRow[]]>(
    `SELECT id, 'task' AS table, title, status FROM task WHERE workspace = $ws AND (title CONTAINS $q) LIMIT 10;
     SELECT id, 'decision' AS table, summary, status FROM decision WHERE workspace = $ws AND (summary CONTAINS $q) LIMIT 10;
     SELECT id, 'feature' AS table, title, status FROM feature WHERE workspace = $ws AND (title CONTAINS $q) LIMIT 10;`,
    { ws: workspaceRecord, q: query },
  );

  const entities = [
    ...(results[0] ?? []).map((row) => ({
      id: (row.id as RecordId).id as string,
      type: "task",
      title: row.title ?? "",
      status: row.status ?? "",
    })),
    ...(results[1] ?? []).map((row) => ({
      id: (row.id as RecordId).id as string,
      type: "decision",
      title: row.summary ?? "",
      status: row.status ?? "",
    })),
    ...(results[2] ?? []).map((row) => ({
      id: (row.id as RecordId).id as string,
      type: "feature",
      title: row.title ?? "",
      status: row.status ?? "",
    })),
  ];

  return {
    toolUseId: "", // filled by caller
    content: JSON.stringify({ results: entities, count: entities.length }),
    isError: false,
  };
};

/** Registry of Brain-native tool handlers, keyed by tool name. */
const brainToolHandlers: ReadonlyMap<string, BrainToolHandler> = new Map([
  ["search_entities", searchEntitiesHandler],
]);

// ---------------------------------------------------------------------------
// Effect Boundary: executeBrainNativeTools
// ---------------------------------------------------------------------------

/**
 * Execute all brain-native tool calls and return tool_result messages.
 *
 * - Each classified brain-native call is dispatched to its handler.
 * - Unknown handlers produce an error result (graceful, not HTTP 500).
 * - All errors are caught and returned as is_error tool_results.
 */
export async function executeBrainNativeTools(
  classifiedCalls: ClassifiedToolCall[],
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult[]> {
  const brainNativeCalls = classifiedCalls.filter(
    (c): c is Extract<ClassifiedToolCall, { classification: "brain-native" }> =>
      c.classification === "brain-native",
  );

  const results: ToolExecutionResult[] = [];

  for (const call of brainNativeCalls) {
    const handler = brainToolHandlers.get(call.toolUse.name);

    if (!handler) {
      results.push({
        toolUseId: call.toolUse.id,
        content: JSON.stringify({
          error: `No handler registered for brain-native tool: ${call.toolUse.name}`,
        }),
        isError: true,
      });
      continue;
    }

    const startMs = performance.now();
    try {
      const result = await handler(call.toolUse.input, deps);
      const durationMs = performance.now() - startMs;
      results.push({
        ...result,
        toolUseId: call.toolUse.id,
      });

      // Fire-and-forget trace capture (do not block tool result delivery)
      captureToolTrace(
        {
          toolName: call.toolUse.name,
          workspaceId: deps.workspaceId,
          identityId: deps.identityId,
          outcome: "success",
          durationMs,
          input: call.toolUse.input as Record<string, unknown>,
          output: { content: result.content },
        },
        { surreal: deps.surreal },
      ).catch((traceError) => {
        log.warn("proxy.tool_executor.trace_failed", "Tool trace capture failed", {
          tool_name: call.toolUse.name,
          error: String(traceError),
        });
      });
    } catch (error) {
      const durationMs = performance.now() - startMs;
      log.warn("proxy.tool_executor.handler_error", "Brain-native tool execution failed", {
        tool_name: call.toolUse.name,
        tool_use_id: call.toolUse.id,
        error: String(error),
      });
      results.push({
        toolUseId: call.toolUse.id,
        content: JSON.stringify({
          error: `Tool execution failed: ${String(error)}`,
        }),
        isError: true,
      });

      // Trace error outcome too
      captureToolTrace(
        {
          toolName: call.toolUse.name,
          workspaceId: deps.workspaceId,
          identityId: deps.identityId,
          outcome: "error",
          durationMs,
        },
        { surreal: deps.surreal },
      ).catch((traceError) => {
        log.warn("proxy.tool_executor.trace_failed", "Tool trace capture failed", {
          tool_name: call.toolUse.name,
          error: String(traceError),
        });
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helper: buildToolResultMessages
// ---------------------------------------------------------------------------

/**
 * Build an Anthropic tool_result message from execution results.
 * Used to construct the follow-up request in the tool use loop.
 */
export function buildToolResultMessage(
  results: ToolExecutionResult[],
): ToolResultMessage {
  return {
    role: "user",
    content: results.map((result) => ({
      type: "tool_result" as const,
      tool_use_id: result.toolUseId,
      content: result.content,
      ...(result.isError ? { is_error: true } : {}),
    })),
  };
}
