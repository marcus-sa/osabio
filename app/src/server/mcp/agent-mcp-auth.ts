/**
 * Agent MCP Auth — Resolve proxy token to agent session context
 *
 * Effect boundary module: extracts X-Osabio-Auth header, resolves proxy token
 * via existing lookupProxyToken, loads agent_session record, and returns
 * AgentSessionContext.
 *
 * Pipeline:
 *   1. Extract X-Osabio-Auth header (raw token, no "Bearer " prefix)
 *   2. Hash token and look up via createLookupProxyToken
 *   3. Verify session field exists on proxy token
 *   4. Load agent_session record from SurrealDB
 *   5. Check orchestrator_status is 'active' or 'idle'
 *   6. Return AgentSessionContext
 */
import { RecordId, type Surreal } from "surrealdb";
import { HttpError } from "../http/errors";
import {
  extractOsabioAuthToken,
  createLookupProxyToken,
} from "../proxy/proxy-auth";
import { hashProxyToken } from "../proxy/proxy-token-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentSessionContext = {
  readonly workspaceId: string;
  readonly identityId: string;
  readonly sessionId: string;
  readonly sessionRecord: RecordId<"agent_session">;
  readonly workspaceRecord: RecordId<"workspace">;
  readonly identityRecord: RecordId<"identity">;
};

type AgentSessionRow = {
  id: RecordId<"agent_session">;
  workspace: RecordId<"workspace">;
  orchestrator_status: string;
};

const ALLOWED_SESSION_STATUSES = new Set(["active", "idle"]);

// ---------------------------------------------------------------------------
// resolveAgentSession
// ---------------------------------------------------------------------------

/**
 * Resolve a proxy token from X-Osabio-Auth header to an AgentSessionContext.
 *
 * @throws HttpError(401) - invalid, expired, or revoked proxy token
 * @throws HttpError(404) - proxy token has no session, or session not found
 * @throws HttpError(403) - session not in active/idle status
 */
export async function resolveAgentSession(
  request: Request,
  surreal: Surreal,
): Promise<AgentSessionContext> {
  // Step 1: Extract token from header
  const rawToken = extractOsabioAuthToken(request.headers);
  if (!rawToken) {
    throw new HttpError(401, "Missing X-Osabio-Auth header");
  }

  // Step 2: Look up proxy token
  const lookupToken = createLookupProxyToken(surreal);
  const tokenHash = hashProxyToken(rawToken);
  const tokenRecord = await lookupToken(tokenHash);

  if (!tokenRecord) {
    throw new HttpError(401, "Invalid proxy token");
  }

  if (tokenRecord.revoked) {
    throw new HttpError(401, "Proxy token has been revoked");
  }

  if (tokenRecord.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, "Proxy token has expired");
  }

  // Step 3: Check session field on proxy token
  if (!tokenRecord.sessionId) {
    throw new HttpError(404, "Proxy token has no linked session");
  }

  // Step 4: Load agent_session record
  const sessionRecord = new RecordId("agent_session", tokenRecord.sessionId);
  const [rows] = await surreal.query<[AgentSessionRow[]]>(
    `SELECT id, workspace, orchestrator_status FROM $sess;`,
    { sess: sessionRecord },
  );

  const sessionRow = rows?.[0];
  if (!sessionRow) {
    throw new HttpError(404, "Agent session not found");
  }

  // Step 5: Check orchestrator_status
  if (!ALLOWED_SESSION_STATUSES.has(sessionRow.orchestrator_status)) {
    throw new HttpError(
      403,
      `Session status '${sessionRow.orchestrator_status}' is not allowed; must be active or idle`,
    );
  }

  // Step 6: Return context
  const workspaceRecord = new RecordId("workspace", tokenRecord.workspaceId);
  const identityRecord = new RecordId("identity", tokenRecord.identityId);

  return {
    workspaceId: tokenRecord.workspaceId,
    identityId: tokenRecord.identityId,
    sessionId: tokenRecord.sessionId,
    sessionRecord,
    workspaceRecord,
    identityRecord,
  };
}
