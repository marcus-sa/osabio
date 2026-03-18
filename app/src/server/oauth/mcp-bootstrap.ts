import { RecordId, type Surreal } from "surrealdb";
import type { AsSigningKey } from "./as-key-management";
import type { BrainAction } from "./types";
import { checkIdentityAllowed, type LookupIdentity, type LookupManager } from "./identity-lifecycle";
import {
  createIntent,
  createTrace,
  recordTokenIssuance,
  updateIntentStatus,
} from "../intent/intent-queries";
import { deriveActionSpec } from "./intent-submission";
import { issueAccessToken } from "./token-issuer";
import { log } from "../telemetry/logger";

type IssueMcpBootstrapTokenInput = {
  surreal: Surreal;
  asSigningKey: AsSigningKey;
  workspaceId: string;
  identityId: string;
  dpopJwkThumbprint: string;
  authorizationDetails: BrainAction[];
  goal: string;
  reasoning: string;
};

type IssueMcpBootstrapTokenResult = {
  accessToken: string;
  expiresIn: number;
};

type MpcBootstrapIdentityRow = {
  identityId: string;
  identityType: string;
  identityStatus?: string;
  managedBy?: string;
  revokedAt?: string;
};

type IssueMcpBootstrapTokenDeps = {
  checkIdentityAllowedFn?: typeof checkIdentityAllowed;
  lookupIdentity?: LookupIdentity;
  lookupManager?: LookupManager;
  createTraceFn?: typeof createTrace;
  createIntentFn?: typeof createIntent;
  updateIntentStatusFn?: typeof updateIntentStatus;
  issueAccessTokenFn?: typeof issueAccessToken;
  recordTokenIssuanceFn?: typeof recordTokenIssuance;
  now?: () => Date;
};

function createSurrealIdentityLookup(surreal: Surreal): LookupIdentity {
  return async (identityId: string) => {
    const rows = await surreal.query<[MpcBootstrapIdentityRow[]]>(
      `SELECT meta::id(id) AS identityId, type AS identityType, identity_status AS identityStatus, managed_by AS managedBy, revoked_at AS revokedAt FROM $identity;`,
      { identity: new RecordId("identity", identityId) },
    );

    const row = rows[0]?.[0];
    if (!row) {
      return undefined;
    }

    return {
      identityId: row.identityId,
      identityType: row.identityType as "human" | "agent" | "system",
      identityStatus: (row.identityStatus ?? "active") as "active" | "revoked" | "suspended",
      ...(row.managedBy ? { managedBy: row.managedBy } : {}),
      ...(row.revokedAt ? { revokedAt: new Date(row.revokedAt) } : {}),
    };
  };
}

function createSurrealManagerLookup(surreal: Surreal): LookupManager {
  return async (managerId: string) => {
    const rows = await surreal.query<[Array<{ identityStatus?: string }>]>(
      `SELECT identity_status AS identityStatus FROM identity WHERE meta::id(id) = $managerId LIMIT 1;`,
      { managerId },
    );

    const row = rows[0]?.[0];
    if (!row) {
      return undefined;
    }

    return {
      identityId: managerId,
      identityStatus: (row.identityStatus ?? "active") as "active" | "revoked" | "suspended",
    };
  };
}

/**
 * Internal helper used by orchestrator to bootstrap Brain MCP auth without loopback HTTP calls.
 * This reuses intent+token domain logic directly in-process.
 */
export async function issueMcpBootstrapToken(
  input: IssueMcpBootstrapTokenInput,
  deps?: IssueMcpBootstrapTokenDeps,
): Promise<IssueMcpBootstrapTokenResult> {
  const lookupIdentity = deps?.lookupIdentity ?? createSurrealIdentityLookup(input.surreal);
  const lookupManager = deps?.lookupManager ?? createSurrealManagerLookup(input.surreal);
  const checkIdentity = deps?.checkIdentityAllowedFn ?? checkIdentityAllowed;
  const createTraceFn = deps?.createTraceFn ?? createTrace;
  const createIntentFn = deps?.createIntentFn ?? createIntent;
  const updateIntentStatusFn = deps?.updateIntentStatusFn ?? updateIntentStatus;
  const issueAccessTokenFn = deps?.issueAccessTokenFn ?? issueAccessToken;
  const recordTokenIssuanceFn = deps?.recordTokenIssuanceFn ?? recordTokenIssuance;
  const nowFn = deps?.now ?? (() => new Date());

  const identityCheck = await checkIdentity(input.identityId, lookupIdentity, lookupManager);
  if (!identityCheck.allowed) {
    throw new Error(`Failed to issue MCP auth token: ${identityCheck.reason}`);
  }

  const requester = new RecordId("identity", input.identityId);
  const workspace = new RecordId("workspace", input.workspaceId);
  const actionSpec = deriveActionSpec(input.authorizationDetails);

  const traceRecord = await createTraceFn(input.surreal, {
    type: "intent_submission",
    actor: requester,
    workspace,
    input: {
      authorization_details: input.authorizationDetails,
      goal: input.goal,
      source: "orchestrator_mcp_bootstrap",
    },
  });

  const intentRecord = await createIntentFn(input.surreal, {
    goal: input.goal,
    reasoning: input.reasoning,
    priority: 0,
    action_spec: actionSpec,
    trace_id: traceRecord,
    requester,
    workspace,
    authorization_details: input.authorizationDetails,
    dpop_jwk_thumbprint: input.dpopJwkThumbprint,
  });

  const intentId = intentRecord.id as string;

  const pendingAuth = await updateIntentStatusFn(
    input.surreal,
    intentId,
    "pending_auth",
  );
  if (!pendingAuth.ok) {
    throw new Error(`Failed to issue MCP auth token: ${pendingAuth.error}`);
  }

  const authorized = await updateIntentStatusFn(
    input.surreal,
    intentId,
    "authorized",
  );
  if (!authorized.ok) {
    throw new Error(`Failed to authorize MCP auth intent: ${authorized.error}`);
  }

  const tokenResult = await issueAccessTokenFn(input.asSigningKey, {
    sub: `identity:${input.identityId}`,
    thumbprint: input.dpopJwkThumbprint,
    authorizationDetails: input.authorizationDetails,
    intentId,
    workspace: input.workspaceId,
    actorType: "agent",
  });
  if (!tokenResult.ok) {
    throw new Error(`Failed to issue MCP auth token: ${tokenResult.error}`);
  }

  const now = nowFn();
  await recordTokenIssuanceFn(
    input.surreal,
    intentId,
    now,
    tokenResult.expiresAt,
  ).catch((error) => {
    log.error("oauth.mcp-bootstrap.record_token", "Failed to update intent with token timestamps", error, {
      intentId,
    });
  });

  const expiresIn = Math.max(
    0,
    Math.floor((tokenResult.expiresAt.getTime() - now.getTime()) / 1000),
  );

  return {
    accessToken: tokenResult.token,
    expiresIn,
  };
}
