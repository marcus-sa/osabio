/**
 * Agent MCP Route -- Effect boundary for /mcp/agent/:sessionId
 *
 * Handles JSON-RPC requests from sandbox coding agents. Parses the
 * JSON-RPC envelope, resolves auth context, and dispatches to
 * method-specific handlers.
 *
 * Effect boundary: this module performs IO (DB queries, request parsing).
 * Pure logic lives in scope-engine.ts, tools-list-handler.ts, and
 * error-response-builder.ts.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { ServerDependencies } from "../runtime/types";
import { HttpError } from "../http/errors";
import { jsonResponse } from "../http/response";
import { resolveAgentSession, type AgentSessionContext } from "./agent-mcp-auth";
import {
  computeEffectiveScope,
  classifyTools,
  computeAuthorizedBrainWriteTools,
  findBrainWriteIntent,
  type AuthorizedIntentSummary,
  type ClassifiedTool,
  type EffectiveScope,
} from "./scope-engine";
import { buildToolsList, BRAIN_NATIVE_TOOL_NAMES } from "./tools-list-handler";
import { handleToolCall, type ToolCallParams } from "./tools-call-handler";
import { handleCreateIntent } from "./create-intent-handler";
import { handleOsabioToolCall } from "./osabio-tools-handler";
import {
  OSABIO_READ_TOOL_NAMES,
  OSABIO_WRITE_TOOL_NAMES,
} from "./osabio-tool-definitions";
import { buildIntentRequiredError } from "./error-response-builder";
import {
  resolveToolsForIdentity,
  createQueryGrantedTools,
  createToolResolutionCache,
  type ToolResolutionCache,
  type QueryGrantedTools,
} from "../proxy/tool-resolver";
import type { OsabioAction } from "../oauth/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JsonRpcRequest = {
  readonly jsonrpc: string;
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

type IntentRow = {
  id: RecordId<"intent">;
  authorization_details?: readonly OsabioAction[];
};

// ---------------------------------------------------------------------------
// JSON-RPC helpers (pure)
// ---------------------------------------------------------------------------

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// ---------------------------------------------------------------------------
// Query ports (effect boundary)
// ---------------------------------------------------------------------------

/**
 * Query authorized intents gating a specific agent session.
 * Returns intent summaries with authorization_details for scope computation.
 */
async function querySessionIntents(
  surreal: Surreal,
  sessionId: string,
): Promise<readonly AuthorizedIntentSummary[]> {
  const sessionRecord = new RecordId("agent_session", sessionId);

  const [rows] = await surreal.query<[IntentRow[]]>(
    `SELECT id, authorization_details
     FROM intent
     WHERE id IN (SELECT VALUE in FROM gates WHERE out = $sess)
       AND status = 'authorized';`,
    { sess: sessionRecord },
  );

  return (rows ?? []).map((row) => ({
    intentId: row.id.id as string,
    authorizationDetails: row.authorization_details ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Shared scope computation
// ---------------------------------------------------------------------------

type ResolvedToolsAndScope = {
  readonly classifiedTools: readonly ClassifiedTool[];
  readonly effectiveScope: EffectiveScope;
};

/**
 * Resolve intents, compute scope, and classify tools for a session.
 * Shared between tools/list and tools/call handlers.
 */
async function resolveClassifiedTools(
  context: AgentSessionContext,
  surreal: Surreal,
  queryTools: QueryGrantedTools,
  toolCache: ToolResolutionCache,
): Promise<ResolvedToolsAndScope> {
  const intents = await querySessionIntents(surreal, context.sessionId);
  const effectiveScope = computeEffectiveScope(intents);
  const grantedTools = await resolveToolsForIdentity(
    context.identityId,
    context.workspaceId,
    queryTools,
    toolCache,
  );
  const classifiedTools = classifyTools(grantedTools, effectiveScope, BRAIN_NATIVE_TOOL_NAMES);
  return { classifiedTools, effectiveScope };
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

async function handleToolsList(
  context: AgentSessionContext,
  surreal: Surreal,
  queryTools: QueryGrantedTools,
  toolCache: ToolResolutionCache,
): Promise<unknown> {
  const { classifiedTools, effectiveScope } = await resolveClassifiedTools(context, surreal, queryTools, toolCache);
  const authorizedBrainWriteTools = computeAuthorizedBrainWriteTools(effectiveScope, OSABIO_WRITE_TOOL_NAMES);
  return buildToolsList(classifiedTools, authorizedBrainWriteTools);
}

// ---------------------------------------------------------------------------
// Route Handler Factory
// ---------------------------------------------------------------------------

export function createAgentMcpHandler(deps: ServerDependencies) {
  const queryTools = createQueryGrantedTools(deps.surreal);
  const toolCache = createToolResolutionCache(0); // No cache for agent MCP (fresh every request)

  return async (sessionId: string, request: Request): Promise<Response> => {
    let requestId: string | number | null = null;

    try {
      // Parse JSON-RPC envelope
      const body = (await request.json()) as JsonRpcRequest;
      requestId = body.id ?? null;

      if (body.jsonrpc !== "2.0" || !body.method) {
        return jsonResponse(
          jsonRpcError(requestId, -32600, "Invalid Request"),
          400,
        );
      }

      // Resolve auth context (throws HttpError on failure)
      const context = await resolveAgentSession(request, deps.surreal);

      // Verify the URL session ID matches the resolved session
      if (context.sessionId !== sessionId) {
        throw new HttpError(404, "Session ID mismatch");
      }

      // Dispatch by method
      switch (body.method) {
        case "tools/list": {
          const result = await handleToolsList(context, deps.surreal, queryTools, toolCache);
          return jsonResponse(jsonRpcSuccess(requestId, result), 200);
        }

        case "tools/call": {
          const toolName = (body.params?.name as string) ?? "";
          const toolArgs = body.params?.arguments as Record<string, unknown> ?? {};
          const osabioToolContext = {
            workspaceId: context.workspaceId,
            identityId: context.identityId,
            sessionId: context.sessionId,
          };

          // Infrastructure: create_intent
          if (toolName === "create_intent") {
            const outcome = await handleCreateIntent(
              toolArgs,
              osabioToolContext,
              deps.surreal,
            );

            if (outcome.status === "authorized") {
              return jsonResponse(
                jsonRpcSuccess(requestId, { status: outcome.status, intentId: outcome.intentId }),
                200,
              );
            }
            if (outcome.status === "pending_veto") {
              return jsonResponse(
                jsonRpcSuccess(requestId, { status: outcome.status, intentId: outcome.intentId }),
                200,
              );
            }
            if (outcome.status === "vetoed") {
              return jsonResponse(
                jsonRpcSuccess(requestId, { status: outcome.status, intentId: outcome.intentId, reason: outcome.reason }),
                200,
              );
            }
            return jsonResponse(
              jsonRpcError(requestId, -32000, outcome.reason),
              500,
            );
          }

          // Brain read tools: always available, execute directly
          if (OSABIO_READ_TOOL_NAMES.has(toolName)) {
            const callResult = await handleOsabioToolCall(
              toolName, toolArgs, true, osabioToolContext, { surreal: deps.surreal },
            );
            if (callResult.kind === "success") {
              return jsonResponse(jsonRpcSuccess(requestId, callResult.result), 200);
            }
            return jsonResponse(
              jsonRpcError(requestId, callResult.code, callResult.message),
              500,
            );
          }

          // Brain write tools: require intent authorization
          if (OSABIO_WRITE_TOOL_NAMES.has(toolName)) {
            const { effectiveScope } = await resolveClassifiedTools(
              context, deps.surreal, queryTools, toolCache,
            );
            const matchingIntent = findBrainWriteIntent(toolName, effectiveScope);

            if (!matchingIntent) {
              const intentRequiredError = buildIntentRequiredError(toolName, "osabio");
              return jsonResponse(
                jsonRpcError(requestId, intentRequiredError.code, intentRequiredError.message, intentRequiredError.data),
                403,
              );
            }

            const callResult = await handleOsabioToolCall(
              toolName, toolArgs, false, osabioToolContext, { surreal: deps.surreal },
            );
            if (callResult.kind === "success") {
              return jsonResponse(jsonRpcSuccess(requestId, callResult.result), 200);
            }
            return jsonResponse(
              jsonRpcError(requestId, callResult.code, callResult.message),
              500,
            );
          }

          // External MCP tools: classify and dispatch
          const { classifiedTools } = await resolveClassifiedTools(
            context, deps.surreal, queryTools, toolCache,
          );
          const callParams: ToolCallParams = {
            name: toolName,
            arguments: body.params?.arguments as Record<string, unknown> | undefined,
          };
          const callResult = await handleToolCall(
            callParams,
            classifiedTools,
            osabioToolContext,
            {
              surreal: deps.surreal,
              mcpClientFactory: deps.mcpClientFactory,
              inflight: deps.inflight,
            },
          );

          if (callResult.kind === "success") {
            return jsonResponse(jsonRpcSuccess(requestId, callResult.result), 200);
          }
          // Error response: use appropriate HTTP status
          const httpStatus = callResult.code === -32403 ? 403
            : callResult.code === -32602 ? 400
            : callResult.code === -32601 ? 501
            : 500;
          return jsonResponse(
            jsonRpcError(requestId, callResult.code, callResult.message, callResult.data),
            httpStatus,
          );
        }

        case "create_intent": {
          // Also handle create_intent as a top-level JSON-RPC method
          const intentArgs = body.params ?? {};
          const outcome = await handleCreateIntent(
            intentArgs,
            {
              workspaceId: context.workspaceId,
              identityId: context.identityId,
              sessionId: context.sessionId,
            },
            deps.surreal,
          );

          if (outcome.status === "authorized") {
            return jsonResponse(
              jsonRpcSuccess(requestId, { status: outcome.status, intentId: outcome.intentId }),
              200,
            );
          }
          if (outcome.status === "pending_veto") {
            return jsonResponse(
              jsonRpcSuccess(requestId, { status: outcome.status, intentId: outcome.intentId }),
              200,
            );
          }
          if (outcome.status === "vetoed") {
            return jsonResponse(
              jsonRpcSuccess(requestId, { status: outcome.status, intentId: outcome.intentId, reason: outcome.reason }),
              200,
            );
          }
          return jsonResponse(
            jsonRpcError(requestId, -32000, outcome.reason),
            500,
          );
        }

        default:
          return jsonResponse(
            jsonRpcError(requestId, -32601, "Method not found"),
            404,
          );
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(
          jsonRpcError(requestId, -32000, error.message),
          error.status,
        );
      }
      throw error;
    }
  };
}
