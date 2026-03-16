/**
 * Proxy Token Route — POST /api/auth/proxy-token
 *
 * Issues brp_-prefixed proxy tokens for CLI authentication.
 * Pipeline:
 *   1. Extract + validate Authorization bearer token
 *   2. Parse workspace_id from request body
 *   3. Resolve identity for the caller
 *   4. Verify workspace membership
 *   5. Revoke previous tokens for same identity+workspace
 *   6. Generate token, hash, store
 *   7. Return raw token + expiry
 *
 * Driving port: POST /api/auth/proxy-token
 * Driven ports: SurrealDB (proxy_token table)
 */
import { RecordId } from "surrealdb";
import { jsonResponse } from "../http/response";
import { logInfo } from "../http/observability";
import {
  generateProxyToken,
  hashProxyToken,
  computeExpiresAt,
  readProxyTokenTtlDays,
} from "./proxy-token-core";
import type { ServerDependencies } from "../runtime/types";

// ---------------------------------------------------------------------------
// Request Parsing (pure)
// ---------------------------------------------------------------------------

type ProxyTokenRequest = {
  workspaceId: string;
  bearerToken: string;
};

function parseProxyTokenRequest(
  authHeader: string | null,
  body: unknown,
): { ok: true; value: ProxyTokenRequest } | { ok: false; status: number; error: string } {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "missing_authorization" };
  }

  const bearerToken = authHeader.slice(7).trim();
  if (!bearerToken) {
    return { ok: false, status: 401, error: "missing_authorization" };
  }

  const parsed = body as { workspace_id?: string } | undefined;
  if (!parsed?.workspace_id || typeof parsed.workspace_id !== "string") {
    return { ok: false, status: 400, error: "workspace_id_required" };
  }

  return {
    ok: true,
    value: { workspaceId: parsed.workspace_id, bearerToken },
  };
}

// ---------------------------------------------------------------------------
// Identity Resolution (driven port — queries SurrealDB)
// ---------------------------------------------------------------------------

type IdentityRow = {
  identityId: string;
};

async function resolveIdentityForWorkspace(
  surreal: ServerDependencies["surreal"],
  workspaceId: string,
): Promise<string | undefined> {
  const results = await surreal.query<[IdentityRow[]]>(
    `SELECT meta::id(in) AS identityId FROM member_of WHERE out = $ws LIMIT 1;`,
    { ws: workspaceRecord(workspaceId) },
  );

  return results[0]?.[0]?.identityId;
}

// ---------------------------------------------------------------------------
// Record ID Helpers
// ---------------------------------------------------------------------------

function identityRecord(identityId: string): RecordId {
  return new RecordId("identity", identityId);
}

function workspaceRecord(workspaceId: string): RecordId {
  return new RecordId("workspace", workspaceId);
}

// ---------------------------------------------------------------------------
// Membership Check (driven port — queries SurrealDB)
// ---------------------------------------------------------------------------

async function checkWorkspaceMembership(
  surreal: ServerDependencies["surreal"],
  identityId: string,
  workspaceId: string,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM member_of WHERE in = $identity AND out = $ws GROUP ALL;`,
    { identity: identityRecord(identityId), ws: workspaceRecord(workspaceId) },
  );

  return (results[0]?.[0]?.count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Token Revocation (driven port — mutates SurrealDB)
// ---------------------------------------------------------------------------

async function revokePreviousTokens(
  surreal: ServerDependencies["surreal"],
  identityId: string,
  workspaceId: string,
): Promise<void> {
  await surreal.query(
    `UPDATE proxy_token SET revoked = true WHERE identity = $identity AND workspace = $ws AND revoked = false;`,
    { identity: identityRecord(identityId), ws: workspaceRecord(workspaceId) },
  );
}

// ---------------------------------------------------------------------------
// Token Storage (driven port — mutates SurrealDB)
// ---------------------------------------------------------------------------

async function storeProxyToken(
  surreal: ServerDependencies["surreal"],
  tokenHash: string,
  identityId: string,
  workspaceId: string,
  expiresAt: Date,
): Promise<void> {
  await surreal.query(
    `CREATE proxy_token CONTENT {
      token_hash: $hash,
      workspace: $ws,
      identity: $identity,
      expires_at: $expires,
      created_at: time::now(),
      revoked: false,
    };`,
    {
      hash: tokenHash,
      ws: workspaceRecord(workspaceId),
      identity: identityRecord(identityId),
      expires: expiresAt,
    },
  );
}

// ---------------------------------------------------------------------------
// Handler Factory
// ---------------------------------------------------------------------------

export function createProxyTokenHandler(
  deps: ServerDependencies,
): (request: Request) => Promise<Response> {
  const ttlDays = readProxyTokenTtlDays();

  return async (request: Request): Promise<Response> => {
    // 1. Parse request
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const parseResult = parseProxyTokenRequest(
      request.headers.get("authorization"),
      body,
    );

    if (!parseResult.ok) {
      return jsonResponse({ error: parseResult.error }, parseResult.status);
    }

    const { workspaceId } = parseResult.value;

    // 2. Resolve identity for workspace
    const identityId = await resolveIdentityForWorkspace(deps.surreal, workspaceId);
    if (!identityId) {
      return jsonResponse({ error: "workspace_membership_required" }, 403);
    }

    // 3. Verify the resolved identity is a member of the target workspace
    const isMember = await checkWorkspaceMembership(deps.surreal, identityId, workspaceId);
    if (!isMember) {
      return jsonResponse({ error: "workspace_membership_required" }, 403);
    }

    // 4. Revoke previous tokens
    await revokePreviousTokens(deps.surreal, identityId, workspaceId);

    // 5. Generate and store new token
    const rawToken = generateProxyToken();
    const tokenHash = hashProxyToken(rawToken);
    const expiresAt = computeExpiresAt(ttlDays);

    await storeProxyToken(deps.surreal, tokenHash, identityId, workspaceId, expiresAt);

    logInfo("proxy.token.issued", "Proxy token issued", {
      workspace_id: workspaceId,
      identity_id: identityId,
      ttl_days: ttlDays,
    });

    // 6. Return raw token (only time it leaves the server)
    return jsonResponse({
      proxy_token: rawToken,
      expires_at: expiresAt.toISOString(),
      workspace_id: workspaceId,
    }, 200);
  };
}
