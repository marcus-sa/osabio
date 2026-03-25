/**
 * Agent MCP Route — Minimal route handler for /mcp/agent/:sessionId
 *
 * Handles JSON-RPC requests from sandbox coding agents. This module wires
 * the auth boundary (resolveAgentSession) to incoming requests.
 *
 * Step 01-02: Only auth resolution is implemented. Tool dispatch comes in 01-03+.
 */
import type { ServerDependencies } from "../runtime/types";
import { HttpError } from "../http/errors";
import { jsonResponse } from "../http/response";
import { resolveAgentSession } from "./agent-mcp-auth";

// ---------------------------------------------------------------------------
// Route Handler Factory
// ---------------------------------------------------------------------------

export function createAgentMcpHandler(deps: ServerDependencies) {
  return async (sessionId: string, request: Request): Promise<Response> => {
    try {
      // Resolve auth context (throws HttpError on failure)
      const _context = await resolveAgentSession(request, deps.surreal);

      // Verify the URL session ID matches the resolved session
      if (_context.sessionId !== sessionId) {
        throw new HttpError(404, "Session ID mismatch");
      }

      // TODO (step 01-03): Parse JSON-RPC body and dispatch to tools/list, tools/call, etc.
      return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Not implemented" } }, 501);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(
          { jsonrpc: "2.0", id: null, error: { code: -32000, message: error.message } },
          error.status,
        );
      }
      throw error;
    }
  };
}
