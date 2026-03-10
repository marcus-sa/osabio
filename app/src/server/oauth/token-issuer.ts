/**
 * DPoP-Bound Token Issuer
 *
 * Signs DPoP-bound access tokens with injected AS ES256 key.
 * Token includes sub, cnf.jkt, authorization_details, urn:brain:intent_id,
 * urn:brain:workspace, exp. Default TTL 300s.
 *
 * Pure function -- no IO imports, no side effects.
 *
 * Step: 02-02
 */
import * as jose from "jose";
import type { BrainAction, TokenIssuanceResult } from "./types";
import type { AsSigningKey } from "./as-key-management";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenIssuanceInput = {
  sub: string;
  thumbprint: string;
  authorizationDetails: BrainAction[];
  intentId: string;
  workspace: string;
  actorType?: "human" | "agent";
};

export type TokenIssuanceOptions = {
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TTL_SECONDS = 300;
const DEFAULT_ISSUER = "https://brain.local";
const DEFAULT_AUDIENCE = "https://brain.local";

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Clamp TTL to the maximum allowed value (300s). */
function resolveEffectiveTtl(requested?: number): number {
  if (requested === undefined) return MAX_TTL_SECONDS;
  return Math.min(requested, MAX_TTL_SECONDS);
}

/**
 * Issue a DPoP-bound access token signed with the AS ES256 key.
 *
 * The token payload conforms to RFC 9449 (DPoP) and RFC 9396 (RAR):
 * - cnf.jkt binds the token to the actor's DPoP key
 * - authorization_details carries the RAR actions
 * - Custom urn:brain:* claims carry Brain-specific context
 */
export async function issueAccessToken(
  signingKey: AsSigningKey,
  input: TokenIssuanceInput,
  options?: TokenIssuanceOptions,
): Promise<TokenIssuanceResult> {
  const ttl = resolveEffectiveTtl(options?.ttlSeconds);
  const issuer = options?.issuer ?? DEFAULT_ISSUER;
  const audience = options?.audience ?? DEFAULT_AUDIENCE;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;

  const jwt = await new jose.SignJWT({
    cnf: { jkt: input.thumbprint },
    authorization_details: input.authorizationDetails,
    "urn:brain:intent_id": input.intentId,
    "urn:brain:workspace": input.workspace,
    ...(input.actorType ? { "urn:brain:actor_type": input.actorType } : {}),
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "at+jwt",
      kid: signingKey.kid,
    })
    .setSubject(input.sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(signingKey.privateKey);

  return {
    ok: true,
    token: jwt,
    expiresAt: new Date(exp * 1000),
  };
}
