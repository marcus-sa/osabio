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
  type AuthorizedIntentSummary,
} from "./scope-engine";
import { buildToolsList, BRAIN_NATIVE_TOOL_NAMES } from "./tools-list-handler";
import {
  resolveToolsForIdentity,
  createQueryGrantedTools,
  createToolResolutionCache,
  type ToolResolutionCache,
  type QueryGrantedTools,
} from "../proxy/tool-resolver";
import type { BrainAction } from "../oauth/types";

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
  authorization_details?: readonly BrainAction[];
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
// Method handlers
// ---------------------------------------------------------------------------

async function handleToolsList(
  context: AgentSessionContext,
  surreal: Surreal,
  queryTools: QueryGrantedTools,
  toolCache: ToolResolutionCache,
): Promise<unknown> {
  // 1. Query authorized intents for this session
  const intents = await querySessionIntents(surreal, context.sessionId);

  // 2. Compute effective scope from intents
  const effectiveScope = computeEffectiveScope(intents);

  // 3. Query granted tools for the identity
  const grantedTools = await resolveToolsForIdentity(
    context.identityId,
    context.workspaceId,
    queryTools,
    toolCache,
  );

  // 4. Classify tools against effective scope
  const classifiedTools = classifyTools(grantedTools, effectiveScope, BRAIN_NATIVE_TOOL_NAMES);

  // 5. Build MCP ListToolsResult
  return buildToolsList(classifiedTools);
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

        case "tools/call":
          return jsonResponse(
            jsonRpcError(requestId, -32601, "Not implemented: tools/call"),
            501,
          );

        case "create_intent":
          return jsonResponse(
            jsonRpcError(requestId, -32601, "Not implemented: create_intent"),
            501,
          );

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
