/**
 * Tools Call Handler -- Effect boundary for tools/call dispatch
 *
 * Receives an MCP tool call request, verifies scope against
 * classified tools, forwards authorized calls to upstream MCP,
 * and records trace records for every outcome.
 *
 * Effect boundary: performs IO (upstream MCP calls, SurrealDB trace writes).
 * Pure logic delegated to scope-engine.ts and error-response-builder.ts.
 */
import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import type { McpClientFactory } from "../tool-registry/mcp-client";
import type { ClassifiedTool } from "./scope-engine";
import { buildIntentRequiredError } from "./error-response-builder";
import { handleCreateIntent } from "./create-intent-handler";
import type { InflightTracker } from "../runtime/types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolCallOutcome = "success" | "error" | "intent_required" | "unknown_tool";

export type ToolCallParams = {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
};

export type ToolCallSuccess = {
  readonly kind: "success";
  readonly result: unknown;
};

export type ToolCallError = {
  readonly kind: "error";
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

export type ToolCallResult = ToolCallSuccess | ToolCallError;

export type ToolCallContext = {
  readonly workspaceId: string;
  readonly identityId: string;
  readonly sessionId: string;
};

export type ToolCallDependencies = {
  readonly surreal: Surreal;
  readonly mcpClientFactory: McpClientFactory;
  readonly inflight: InflightTracker;
};

// ---------------------------------------------------------------------------
// Trace recording (effect boundary)
// ---------------------------------------------------------------------------

async function recordToolTrace(
  surreal: Surreal,
  context: ToolCallContext,
  toolName: string,
  outcome: ToolCallOutcome,
  durationMs: number,
  intentId?: string,
  input?: Record<string, unknown>,
  output?: Record<string, unknown>,
): Promise<void> {
  const traceId = crypto.randomUUID();
  const traceRecord = new RecordId("trace", traceId);

  const content: Record<string, unknown> = {
    type: "tool_call",
    tool_name: toolName,
    outcome,
    workspace: new RecordId("workspace", context.workspaceId),
    actor: new RecordId("identity", context.identityId),
    session: new RecordId("agent_session", context.sessionId),
    duration_ms: Math.round(durationMs),
    created_at: new Date(),
  };

  if (intentId) {
    content.intent = new RecordId("intent", intentId);
  }

  if (input) {
    content.input = input;
  }

  if (output) {
    content.output = output;
  }

  try {
    await surreal.query(`CREATE $trace CONTENT $content;`, {
      trace: traceRecord,
      content,
    });

    log.info("agent_mcp.tool_trace.captured", "Tool call trace captured", {
      trace_id: traceId,
      tool_name: toolName,
      outcome,
      duration_ms: Math.round(durationMs),
      workspace_id: context.workspaceId,
    });
  } catch (error) {
    log.error("agent_mcp.tool_trace.write_failed", "Failed to write tool trace", error);
  }
}

// ---------------------------------------------------------------------------
// Upstream forwarding (effect boundary)
// ---------------------------------------------------------------------------

async function forwardToUpstream(
  mcpClientFactory: McpClientFactory,
  serverUrl: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<unknown> {
  // The mcpClientFactory may be a real factory or a test mock (cast as never).
  // Real factory: connect() returns McpConnectionResult with .client, separate callTool/disconnect.
  // Test mock: connect() returns {callTool(name, args), close()} directly.
  // We handle both patterns via duck-typing since the mock is cast as `never`.
  const connection = await mcpClientFactory.connect(serverUrl, "streamable-http");

  try {
    if (typeof mcpClientFactory.callTool === "function") {
      // Real McpClientFactory: use factory methods with the client object
      const result = await mcpClientFactory.callTool(
        (connection as { client: unknown }).client as never,
        toolName,
        toolArgs,
      );
      return result;
    }
    // Mock/simplified path: connection itself has callTool
    return await (connection as unknown as { callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> }).callTool(
      toolName,
      toolArgs,
    );
  } finally {
    if (typeof mcpClientFactory.disconnect === "function") {
      await mcpClientFactory.disconnect(
        (connection as { client: unknown }).client as never,
      ).catch(() => {});
    } else if (typeof (connection as unknown as { close?: () => Promise<void> }).close === "function") {
      await (connection as unknown as { close: () => Promise<void> }).close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Tool lookup (pure)
// ---------------------------------------------------------------------------

function findClassifiedTool(
  classifiedTools: readonly ClassifiedTool[],
  toolName: string,
): ClassifiedTool | undefined {
  return classifiedTools.find((ct) => ct.tool.name === toolName);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle a tools/call JSON-RPC request.
 *
 * Pipeline:
 *   1. Look up tool in classified list
 *   2. Branch on classification: authorized -> forward, gated -> 403, osabio_native -> 501
 *   3. Record trace for ALL outcomes
 *   4. Return result or error
 */
export async function handleToolCall(
  params: ToolCallParams,
  classifiedTools: readonly ClassifiedTool[],
  context: ToolCallContext,
  deps: ToolCallDependencies,
): Promise<ToolCallResult> {
  const startTime = performance.now();
  const toolName = params.name;
  const toolArgs = params.arguments ?? {};

  // 1. Look up the tool
  const classified = findClassifiedTool(classifiedTools, toolName);

  if (!classified) {
    const durationMs = performance.now() - startTime;
    deps.inflight.track(
      recordToolTrace(deps.surreal, context, toolName, "unknown_tool", durationMs),
    );
    return {
      kind: "error",
      code: -32602,
      message: "Unknown tool",
    };
  }

  // 2. Branch on classification
  switch (classified.classification.kind) {
    case "authorized": {
      const intentId = classified.classification.matchingIntent.intentId;
      try {
        // Resolve upstream server URL from source_server_id
        const serverUrl = classified.tool.source_server_id
          ? await resolveServerUrl(deps.surreal, classified.tool.source_server_id)
          : undefined;

        const result = await forwardToUpstream(
          deps.mcpClientFactory,
          serverUrl ?? "unknown",
          toolName,
          toolArgs,
        );

        const durationMs = performance.now() - startTime;
        deps.inflight.track(
          recordToolTrace(
            deps.surreal, context, toolName, "success", durationMs, intentId,
            toolArgs, { outcome: "success" },
          ),
        );

        return { kind: "success", result };
      } catch (error) {
        const durationMs = performance.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        deps.inflight.track(
          recordToolTrace(
            deps.surreal, context, toolName, "error", durationMs, intentId,
            toolArgs, { outcome: "error", error: errorMessage },
          ),
        );

        return {
          kind: "error",
          code: -32000,
          message: `Tool call failed: ${errorMessage}`,
        };
      }
    }

    case "gated": {
      const durationMs = performance.now() - startTime;
      const intentRequiredError = buildIntentRequiredError(
        toolName,
        classified.tool.toolkit,
        classified.tool.input_schema,
      );

      deps.inflight.track(
        recordToolTrace(
          deps.surreal, context, toolName, "intent_required", durationMs,
          undefined, toolArgs, { outcome: "intent_required" },
        ),
      );

      return {
        kind: "error",
        code: intentRequiredError.code,
        message: intentRequiredError.message,
        data: intentRequiredError.data,
      };
    }

    case "osabio_native": {
      if (toolName === "create_intent") {
        const outcome = await handleCreateIntent(toolArgs, context, deps.surreal);
        const durationMs = performance.now() - startTime;

        if (outcome.status === "authorized") {
          deps.inflight.track(
            recordToolTrace(
              deps.surreal, context, toolName, "success", durationMs,
              outcome.intentId, toolArgs, { outcome: "success", intent_id: outcome.intentId },
            ),
          );
          return {
            kind: "success",
            result: { status: outcome.status, intentId: outcome.intentId },
          };
        }

        if (outcome.status === "pending_veto") {
          deps.inflight.track(
            recordToolTrace(
              deps.surreal, context, toolName, "success", durationMs,
              outcome.intentId, toolArgs, { outcome: "pending_veto", intent_id: outcome.intentId },
            ),
          );
          return {
            kind: "success",
            result: { status: outcome.status, intentId: outcome.intentId },
          };
        }

        if (outcome.status === "vetoed") {
          deps.inflight.track(
            recordToolTrace(
              deps.surreal, context, toolName, "error", durationMs,
              undefined, toolArgs, { outcome: "vetoed", reason: outcome.reason },
            ),
          );
          return {
            kind: "error",
            code: -32000,
            message: outcome.reason,
          };
        }

        deps.inflight.track(
          recordToolTrace(
            deps.surreal, context, toolName, "error", durationMs,
            undefined, toolArgs, { outcome: "error", reason: outcome.reason },
          ),
        );
        return {
          kind: "error",
          code: -32000,
          message: outcome.reason,
        };
      }

      // Other osabio-native tools (get_context, etc.) not yet implemented
      const durationMs = performance.now() - startTime;
      deps.inflight.track(
        recordToolTrace(deps.surreal, context, toolName, "error", durationMs),
      );
      return {
        kind: "error",
        code: -32601,
        message: `Not implemented: osabio-native tool '${toolName}'`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Server URL resolution (effect boundary)
// ---------------------------------------------------------------------------

async function resolveServerUrl(
  surreal: Surreal,
  sourceServerId: string,
): Promise<string | undefined> {
  const serverRecord = new RecordId("mcp_server", sourceServerId);
  const [rows] = await surreal.query<[Array<{ url: string }>]>(
    `SELECT url FROM $record;`,
    { record: serverRecord },
  );
  return rows?.[0]?.url;
}
