/**
 * Proxy Token Route — POST /api/auth/proxy-token
 *
 * Issues brp_-prefixed proxy tokens for CLI authentication.
 * Pipeline:
 *   1. Parse workspace_id from request body + extract bearer token
 *   2. Validate bearer token via Better Auth session
 *   3. Resolve authenticated person → identity (scoped to workspace membership)
 *   4. Revoke previous tokens + issue new one (atomic transaction)
 *   5. Return raw token + expiry
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
// Resolves the identity for a person that is a member of the target workspace,
// avoiding false 403s when a person has multiple identities.
// ---------------------------------------------------------------------------

async function resolveIdentityForWorkspaceAndPerson(
  surreal: ServerDependencies["surreal"],
  personId: string,
  workspaceId: string,
): Promise<string | undefined> {
  const personRecord = new RecordId("person", personId);
  const wsRecord = new RecordId("workspace", workspaceId);
  const results = await surreal.query<[RecordId[]]>(
    `SELECT VALUE ip.in
     FROM identity_person AS ip
     WHERE ip.out = $person
       AND (SELECT VALUE count() FROM member_of WHERE in = ip.in AND out = $ws) > 0
     LIMIT 1;`,
    { person: personRecord, ws: wsRecord },
  );
  const identityRec = results[0]?.[0];
  return identityRec?.id as string | undefined;
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
// Session Validation (driven port — Better Auth)
// ---------------------------------------------------------------------------

async function validateSession(
  auth: ServerDependencies["auth"],
  headers: Headers,
): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers });
  return session?.user?.id;
}

// ---------------------------------------------------------------------------
// Token Rotation (driven port — mutates SurrealDB)
// Revoke + issue in a single transaction to avoid a crash window where
// no valid token exists.
// ---------------------------------------------------------------------------

async function rotateProxyToken(
  surreal: ServerDependencies["surreal"],
  tokenHash: string,
  identityId: string,
  workspaceId: string,
  expiresAt: Date,
): Promise<void> {
  await surreal.query(
    `BEGIN TRANSACTION;
     UPDATE proxy_token SET revoked = true WHERE identity = $identity AND workspace = $ws AND revoked = false;
     CREATE proxy_token CONTENT {
       token_hash: $hash,
       workspace: $ws,
       identity: $identity,
       expires_at: $expires,
       created_at: time::now(),
       revoked: false,
     };
     COMMIT TRANSACTION;`,
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

    // 2. Validate bearer token via Better Auth session
    const personId = await validateSession(deps.auth, request.headers);
    if (!personId) {
      return jsonResponse({ error: "invalid_session" }, 401);
    }

    // 3. Resolve person → identity (scoped to workspace membership)
    const identityId = await resolveIdentityForWorkspaceAndPerson(deps.surreal, personId, workspaceId);
    if (!identityId) {
      return jsonResponse({ error: "workspace_membership_required" }, 403);
    }

    // 4. Revoke previous tokens + issue new one (atomic)
    const rawToken = generateProxyToken();
    const tokenHash = hashProxyToken(rawToken);
    const expiresAt = computeExpiresAt(ttlDays);

    await rotateProxyToken(deps.surreal, tokenHash, identityId, workspaceId, expiresAt);

    logInfo("proxy.token.issued", "Proxy token issued", {
      workspace_id: workspaceId,
      identity_id: identityId,
      ttl_days: ttlDays,
    });

    // 5. Return raw token (only time it leaves the server)
    return jsonResponse({
      proxy_token: rawToken,
      expires_at: expiresAt.toISOString(),
      workspace_id: workspaceId,
    }, 200);
  };
}
