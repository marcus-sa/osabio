/**
 * DPoP Pure Functions
 *
 * Pure functions for DPoP proof validation, JWK thumbprint computation,
 * and ES256 key pair generation.
 *
 * No side effects -- all functions are pure (crypto operations are
 * deterministic given the same inputs).
 */
import * as jose from "jose";
import type { DPoPProofPayload, DPoPValidationResult } from "./types";

// ---------------------------------------------------------------------------
// Key Pair Generation (ES256 / ECDSA P-256)
// ---------------------------------------------------------------------------

export type KeyPair = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
  thumbprint: string;
};

/**
 * Generates an ES256 key pair with exportable keys and pre-computed thumbprint.
 * Used for testing and agent sandbox key provisioning.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const thumbprint = await computeJwkThumbprint(publicJwk);

  return { privateKey, publicKey, publicJwk, thumbprint };
}

// ---------------------------------------------------------------------------
// JWK Thumbprint (RFC 7638)
// ---------------------------------------------------------------------------

/**
 * Computes a JWK thumbprint per RFC 7638.
 *
 * For EC keys: uses lexicographic order { crv, kty, x, y },
 * SHA-256 hash, base64url encoded.
 */
export async function computeJwkThumbprint(
  publicJwk: JsonWebKey,
): Promise<string> {
  const thumbprintInput = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  });

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(thumbprintInput),
  );

  return base64url(new Uint8Array(hashBuffer));
}

// ---------------------------------------------------------------------------
// DPoP Proof Validation
// ---------------------------------------------------------------------------

type ClockSkew = {
  pastSeconds?: number;
  futureSeconds?: number;
};

const DEFAULT_CLOCK_SKEW: Required<ClockSkew> = {
  pastSeconds: 60,
  futureSeconds: 5,
};

/**
 * Validates a DPoP proof JWT.
 *
 * Checks:
 * 1. Structure: header typ="dpop+jwt", alg="ES256", jwk present with kty, crv, x, y
 * 2. Signature: verified against the embedded JWK
 * 3. Claims: jti present, htm matches expectedMethod, htu matches expectedUri
 * 4. Clock skew: iat within tolerance (default 60s past, 5s future)
 *
 * Returns the JWK thumbprint on success.
 */
export async function validateDPoPProof(
  proofJwt: string,
  expectedMethod: string,
  expectedUri: string,
  clockSkew?: ClockSkew,
): Promise<DPoPValidationResult> {
  const pastSeconds = clockSkew?.pastSeconds ?? DEFAULT_CLOCK_SKEW.pastSeconds;
  const futureSeconds =
    clockSkew?.futureSeconds ?? DEFAULT_CLOCK_SKEW.futureSeconds;

  // Step 1: Decode and validate structure (without verifying signature yet)
  const headerResult = decodeAndValidateHeader(proofJwt);
  if (!headerResult.ok) {
    return headerResult.error;
  }

  const { header, jwk } = headerResult.value;

  // Step 2: Verify signature against embedded JWK
  const verifyResult = await verifySignature(proofJwt, jwk);
  if (!verifyResult.ok) {
    return verifyResult.error;
  }

  const { payload } = verifyResult.value;

  // Step 3: Validate claims
  const claimsResult = validateClaims(
    payload,
    expectedMethod,
    expectedUri,
    pastSeconds,
    futureSeconds,
  );
  if (!claimsResult.ok) {
    return claimsResult.error;
  }

  // Step 4: Compute thumbprint from embedded JWK
  const thumbprint = await computeJwkThumbprint(jwk as JsonWebKey);

  return {
    valid: true,
    thumbprint,
    claims: claimsResult.value,
  };
}

// ---------------------------------------------------------------------------
// Internal validation pipeline steps
// ---------------------------------------------------------------------------

type ValidationOk<T> = { ok: true; value: T };
type ValidationErr = {
  ok: false;
  error: DPoPValidationResult & { valid: false };
};
type ValidationStep<T> = ValidationOk<T> | ValidationErr;

function decodeAndValidateHeader(
  proofJwt: string,
): ValidationStep<{ header: jose.ProtectedHeaderParameters; jwk: jose.JWK }> {
  try {
    const header = jose.decodeProtectedHeader(proofJwt);

    if (header.typ !== "dpop+jwt") {
      return invalidStructure("DPoP proof must have typ 'dpop+jwt'");
    }

    if (header.alg !== "ES256") {
      return invalidStructure("DPoP proof must use ES256 algorithm");
    }

    const jwk = header.jwk as jose.JWK | undefined;
    if (!jwk || !jwk.kty || !jwk.crv || !jwk.x || !jwk.y) {
      return invalidStructure(
        "DPoP proof must include jwk with kty, crv, x, y",
      );
    }

    return { ok: true, value: { header, jwk } };
  } catch {
    return invalidStructure("Failed to decode DPoP proof header");
  }
}

async function verifySignature(
  proofJwt: string,
  jwk: jose.JWK,
): Promise<ValidationStep<{ payload: jose.JWTPayload }>> {
  try {
    const publicKey = await jose.importJWK(jwk, "ES256");
    const { payload } = await jose.jwtVerify(proofJwt, publicKey);
    return { ok: true, value: { payload } };
  } catch {
    return {
      ok: false,
      error: {
        valid: false,
        error: "DPoP proof signature verification failed",
        code: "dpop_invalid_signature",
      },
    };
  }
}

function validateClaims(
  payload: jose.JWTPayload,
  expectedMethod: string,
  expectedUri: string,
  pastSeconds: number,
  futureSeconds: number,
): ValidationStep<DPoPProofPayload> {
  const jti = payload.jti as string | undefined;
  if (!jti) {
    return invalidStructure("DPoP proof must include jti claim");
  }

  const htm = payload.htm as string | undefined;
  if (htm !== expectedMethod) {
    return invalidStructure(
      `DPoP proof htm '${htm}' does not match expected '${expectedMethod}'`,
    );
  }

  const htu = payload.htu as string | undefined;
  if (htu !== expectedUri) {
    return invalidStructure(
      `DPoP proof htu '${htu}' does not match expected '${expectedUri}'`,
    );
  }

  const iat = payload.iat as number | undefined;
  if (iat === undefined) {
    return invalidStructure("DPoP proof must include iat claim");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (iat < nowSeconds - pastSeconds) {
    return {
      ok: false,
      error: {
        valid: false,
        error: `DPoP proof too old: iat ${iat} is more than ${pastSeconds}s in the past`,
        code: "dpop_proof_expired",
      },
    };
  }

  if (iat > nowSeconds + futureSeconds) {
    return {
      ok: false,
      error: {
        valid: false,
        error: `DPoP proof too far in future: iat ${iat} is more than ${futureSeconds}s ahead`,
        code: "dpop_proof_expired",
      },
    };
  }

  return {
    ok: true,
    value: { jti, htm: htm as string, htu: htu as string, iat },
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function invalidStructure(message: string): ValidationErr {
  return {
    ok: false,
    error: {
      valid: false,
      error: message,
      code: "dpop_invalid_structure",
    },
  };
}

function base64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
