/**
 * OAuth RAR+DPoP Algebraic Data Types
 *
 * Types that make illegal states unrepresentable for the OAuth 2.1
 * RAR+DPoP sovereign authorization model.
 *
 * Pure domain types -- no IO imports.
 */
import type { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Brain Action (RFC 9396 Rich Authorization Request)
// ---------------------------------------------------------------------------

export type BrainAction = {
  type: "brain_action";
  action: string;
  resource: string;
  constraints?: Record<string, unknown>;
};

export function createBrainAction(
  action: string,
  resource: string,
  constraints?: Record<string, unknown>,
): BrainAction {
  return {
    type: "brain_action",
    action,
    resource,
    ...(constraints ? { constraints } : {}),
  };
}

// ---------------------------------------------------------------------------
// DPoP Proof Payload (claims inside a DPoP JWT)
// ---------------------------------------------------------------------------

export type DPoPProofPayload = {
  jti: string;
  htm: string;
  htu: string;
  iat: number;
};

// ---------------------------------------------------------------------------
// DPoP-Bound Token Claims (access token payload)
// ---------------------------------------------------------------------------

export type DPoPBoundTokenClaims = {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  cnf: { jkt: string };
  authorization_details: BrainAction[];
  "urn:brain:intent_id": string;
  "urn:brain:workspace": string;
  "urn:brain:actor_type"?: string;
};

// ---------------------------------------------------------------------------
// DPoP Validation Result (discriminated union)
// ---------------------------------------------------------------------------

export type DPoPErrorCode =
  | "dpop_required"
  | "dpop_invalid_structure"
  | "dpop_invalid_signature"
  | "dpop_proof_expired"
  | "dpop_proof_reused"
  | "dpop_binding_mismatch"
  | "dpop_key_mismatch";

export type DPoPValidationResult =
  | { valid: true; thumbprint: string; claims: DPoPProofPayload }
  | { valid: false; error: string; code: DPoPErrorCode };

// ---------------------------------------------------------------------------
// Token Issuance Result (discriminated union)
// ---------------------------------------------------------------------------

export type TokenIssuanceResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: string; code: string };

// ---------------------------------------------------------------------------
// RAR Verification Result (discriminated union)
// ---------------------------------------------------------------------------

export type RARErrorCode =
  | "authorization_details_missing"
  | "authorization_details_mismatch"
  | "authorization_params_exceeded";

export type RARVerificationResult =
  | { authorized: true }
  | { authorized: false; error: string; code: RARErrorCode };

// ---------------------------------------------------------------------------
// DPoP Auth Result (extracted from verified request)
// ---------------------------------------------------------------------------

export type DPoPAuthResult = {
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  identityRecord: RecordId<"identity", string>;
  actorType: "human" | "agent";
  authorizationDetails: BrainAction[];
  intentId: string;
  dpopThumbprint: string;
};
