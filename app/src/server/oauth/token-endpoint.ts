/**
 * Custom AS Token Endpoint
 *
 * POST /api/auth/token accepting grant_type=urn:brain:intent-authorization.
 * Validates DPoP proof, verifies intent status=authorized, matches proof key
 * thumbprint to intent binding, checks authorization_details match.
 * Delegates to token issuer.
 *
 * Pure validation functions + HTTP handler factory.
 *
 * Step: 02-04
 */
import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import type { BrainAction } from "./types";
import { findExceededConstraint } from "./rar-verifier";
import type { IntentRecord } from "../intent/types";
import type { ServerDependencies } from "../runtime/types";
import { validateDPoPProof } from "./dpop";
import { issueAccessToken } from "./token-issuer";
import { getIntentById, recordTokenIssuance } from "../intent/intent-queries";
import { jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { logAuditEvent, createAuditEvent } from "./audit";
import { oauthErrorResponse } from "./oauth-errors";
import {
  checkIdentityAllowed,
  type LookupIdentity,
  type LookupManager,
} from "./identity-lifecycle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenRequest = {
  grantType: string;
  intentId: string;
  authorizationDetails: BrainAction[];
};

type TokenRequestValidation =
  | { valid: true; data: TokenRequest }
  | { valid: false; error: string; errorDescription: string };

type IntentVerification =
  | { ok: true }
  | { ok: false; error: string; errorDescription: string };

type AuthorizationDetailsMatch =
  | { ok: true }
  | { ok: false; error: string; errorDescription: string };

// ---------------------------------------------------------------------------
// Pure Validation: Request Body
// ---------------------------------------------------------------------------

const GRANT_TYPE = "urn:brain:intent-authorization";

export function validateTokenRequest(body: unknown): TokenRequestValidation {
  if (!body || typeof body !== "object") {
    return {
      valid: false,
      error: "invalid_request",
      errorDescription: "Request body must be a non-null object",
    };
  }

  const input = body as Record<string, unknown>;

  // grant_type
  if (typeof input.grant_type !== "string") {
    return {
      valid: false,
      error: "invalid_request",
      errorDescription: "grant_type is required",
    };
  }

  if (input.grant_type !== GRANT_TYPE) {
    return {
      valid: false,
      error: "unsupported_grant_type",
      errorDescription: `Unsupported grant_type: ${input.grant_type}`,
    };
  }

  // intent_id
  if (typeof input.intent_id !== "string" || input.intent_id.trim().length === 0) {
    return {
      valid: false,
      error: "invalid_request",
      errorDescription: "intent_id is required and must be a non-empty string",
    };
  }

  // authorization_details
  if (!Array.isArray(input.authorization_details)) {
    return {
      valid: false,
      error: "invalid_request",
      errorDescription: "authorization_details is required and must be an array",
    };
  }

  if (input.authorization_details.length === 0) {
    return {
      valid: false,
      error: "invalid_request",
      errorDescription: "authorization_details must contain at least one entry",
    };
  }

  return {
    valid: true,
    data: {
      grantType: input.grant_type,
      intentId: (input.intent_id as string).trim(),
      authorizationDetails: input.authorization_details as BrainAction[],
    },
  };
}

// ---------------------------------------------------------------------------
// Pure Validation: Intent State + Thumbprint
// ---------------------------------------------------------------------------

export function verifyIntentForTokenIssuance(
  intent: IntentRecord,
  proofThumbprint: string,
): IntentVerification {
  if (intent.status !== "authorized") {
    return {
      ok: false,
      error: "invalid_grant",
      errorDescription: "Intent not in authorized status",
    };
  }

  if (intent.dpop_jwk_thumbprint !== proofThumbprint) {
    return {
      ok: false,
      error: "invalid_grant",
      errorDescription: "DPoP key does not match intent binding",
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pure Validation: Authorization Details Match
// ---------------------------------------------------------------------------

export function matchAuthorizationDetails(
  requested: BrainAction[],
  intentActions: BrainAction[] | undefined,
): AuthorizationDetailsMatch {
  if (!intentActions) {
    return {
      ok: false,
      error: "invalid_grant",
      errorDescription: "Authorization details do not match",
    };
  }

  if (requested.length !== intentActions.length) {
    return {
      ok: false,
      error: "invalid_grant",
      errorDescription: "Authorization details do not match",
    };
  }

  for (let i = 0; i < requested.length; i++) {
    const req = requested[i];
    const intent = intentActions[i];

    if (
      req.type !== intent.type ||
      req.action !== intent.action ||
      req.resource !== intent.resource
    ) {
      return {
        ok: false,
        error: "invalid_grant",
        errorDescription: "Authorization details do not match",
      };
    }

    if (req.constraints && intent.constraints) {
      const exceeded = findExceededConstraint(req.constraints, intent.constraints);
      if (exceeded) {
        return {
          ok: false,
          error: "invalid_grant",
          errorDescription: `Constraint ${exceeded} exceeds authorized bound`,
        };
      }
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// HTTP Handler Factory
// ---------------------------------------------------------------------------

export function createTokenEndpointHandler(
  deps: ServerDependencies,
): (request: Request) => Promise<Response> {
  const { surreal, asSigningKey } = deps;

  return async (request: Request): Promise<Response> => {
    // 1. Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return oauthErrorResponse("invalid_request", "Invalid JSON body", 400);
    }

    const validation = validateTokenRequest(body);
    if (!validation.valid) {
      return oauthErrorResponse(validation.error, validation.errorDescription, 400);
    }

    const { data } = validation;

    // 2. Extract and validate DPoP proof from header
    const dpopHeader = request.headers.get("DPoP");
    if (!dpopHeader) {
      return oauthErrorResponse(
        "invalid_request",
        "DPoP proof required",
        400,
      );
    }

    const requestUrl = new URL(request.url);
    const dpopResult = await validateDPoPProof(
      dpopHeader,
      "POST",
      `${requestUrl.origin}/api/auth/token`,
    );

    if (!dpopResult.valid) {
      return oauthErrorResponse("invalid_dpop_proof", dpopResult.error, 400);
    }

    // 3. Load intent from SurrealDB
    const intent = await getIntentById(surreal, data.intentId);
    if (!intent) {
      return oauthErrorResponse(
        "invalid_grant",
        "Intent not found",
        400,
      );
    }

    // 3b. Check identity lifecycle (revocation + manager status)
    const requesterId = typeof intent.requester === "object" && intent.requester !== undefined
      ? (intent.requester.id as string)
      : String(intent.requester);

    const lookupIdentity = createSurrealIdentityLookupForToken(surreal);
    const lookupManager = createSurrealManagerLookupForToken(surreal);
    const identityCheck = await checkIdentityAllowed(
      requesterId,
      lookupIdentity,
      lookupManager,
    );

    if (!identityCheck.allowed) {
      logInfo("token.endpoint.identity_blocked", "Token request blocked by identity check", {
        intentId: data.intentId,
        reason: identityCheck.reason,
      });
      return oauthErrorResponse("invalid_grant", identityCheck.reason, 403);
    }

    // 4. Verify intent status and thumbprint match
    const intentVerification = verifyIntentForTokenIssuance(
      intent,
      dpopResult.thumbprint,
    );
    if (!intentVerification.ok) {
      logInfo("token.endpoint.rejected", "Token request rejected", {
        intentId: data.intentId,
        reason: intentVerification.errorDescription,
      });

      await logAuditEvent(surreal, createAuditEvent("token_rejected", {
        actor: intent.requester,
        workspace: intent.workspace,
        intent_id: intent.id,
        dpop_thumbprint: dpopResult.thumbprint,
        payload: { reason: intentVerification.errorDescription },
      })).catch(() => {});

      return oauthErrorResponse(
        intentVerification.error,
        intentVerification.errorDescription,
        400,
      );
    }

    // 5. Verify authorization_details match
    const detailsMatch = matchAuthorizationDetails(
      data.authorizationDetails,
      intent.authorization_details,
    );
    if (!detailsMatch.ok) {
      logInfo("token.endpoint.rejected", "Authorization details mismatch", {
        intentId: data.intentId,
      });

      return oauthErrorResponse(
        detailsMatch.error,
        detailsMatch.errorDescription,
        400,
      );
    }

    // 6. Issue token
    try {
      const tokenResult = await issueAccessToken(asSigningKey, {
        sub: `identity:${intent.requester.id as string}`,
        thumbprint: dpopResult.thumbprint,
        authorizationDetails: data.authorizationDetails,
        intentId: data.intentId,
        workspace: intent.workspace.id as string,
      });

      if (!tokenResult.ok) {
        return oauthErrorResponse("server_error", tokenResult.error, 500);
      }

      // 7. Update intent with token issuance timestamps
      const now = new Date();
      await recordTokenIssuance(surreal, data.intentId, now, tokenResult.expiresAt)
        .catch((err) => {
          logError("token.endpoint.update_intent", "Failed to update intent with token timestamps", err);
        });

      logInfo("token.endpoint.issued", "DPoP-bound access token issued", {
        intentId: data.intentId,
        expiresAt: tokenResult.expiresAt.toISOString(),
      });

      await logAuditEvent(surreal, createAuditEvent("token_issued", {
        actor: intent.requester,
        workspace: intent.workspace,
        intent_id: intent.id,
        dpop_thumbprint: dpopResult.thumbprint,
        payload: {
          expires_at: tokenResult.expiresAt.toISOString(),
          authorization_details: data.authorizationDetails,
        },
      })).catch(() => {});

      // 8. Return token response
      const expiresIn = Math.floor(
        (tokenResult.expiresAt.getTime() - now.getTime()) / 1000,
      );

      return jsonResponse(
        {
          access_token: tokenResult.token,
          token_type: "DPoP",
          expires_in: expiresIn,
        },
        200,
      );
    } catch (error) {
      logError("token.endpoint.error", "Token issuance failed", error);
      return oauthErrorResponse("server_error", "Internal server error", 500);
    }
  };
}

// ---------------------------------------------------------------------------
// SurrealDB Identity Lookups for Token Endpoint
// ---------------------------------------------------------------------------

import type { ResolvedIdentity, ResolvedManager } from "./identity-lifecycle";

type SurrealIdentityRow = {
  identityId: string;
  identityType: string;
  identityStatus?: string;
  managedBy?: string;
  revokedAt?: string;
};

function createSurrealIdentityLookupForToken(surreal: Surreal): LookupIdentity {
  return async (identityId: string) => {
    const rows = await surreal.query<[SurrealIdentityRow[]]>(
      `SELECT meta::id(id) AS identityId, type AS identityType, identity_status AS identityStatus, managed_by AS managedBy, revoked_at AS revokedAt FROM $identity;`,
      { identity: new RecordId("identity", identityId) },
    );

    const row = rows[0]?.[0];
    if (!row) return undefined;

    return {
      identityId: row.identityId,
      identityType: row.identityType as ResolvedIdentity["identityType"],
      identityStatus: (row.identityStatus ?? "active") as ResolvedIdentity["identityStatus"],
      managedBy: row.managedBy,
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
    };
  };
}

function createSurrealManagerLookupForToken(surreal: Surreal): LookupManager {
  return async (managerId: string) => {
    const rows = await surreal.query<[Array<{ identityStatus?: string }>]>(
      `SELECT identity_status AS identityStatus FROM identity WHERE meta::id(id) = $managerId LIMIT 1;`,
      { managerId },
    );

    const row = rows[0]?.[0];
    if (!row) return undefined;

    return {
      identityId: managerId,
      identityStatus: (row.identityStatus ?? "active") as ResolvedManager["identityStatus"],
    };
  };
}
