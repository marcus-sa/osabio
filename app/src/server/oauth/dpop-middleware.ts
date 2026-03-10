/**
 * DPoP Verification Middleware
 *
 * Brain resource server pipeline replacing authenticateMcpRequest.
 * Extracts Authorization: DPoP + DPoP headers. Rejects Bearer tokens,
 * session cookies, missing auth with 401 dpop_required.
 * Validates token signature via AS JWKS, validates proof,
 * verifies sender binding (cnf.jkt match).
 *
 * Pure pipeline -- domain logic has no IO imports beyond jose for JWT.
 *
 * Step: 03-01
 */
import * as jose from "jose";
import { RecordId } from "surrealdb";
import { jsonResponse } from "../http/response";
import { validateDPoPProof, computeJwkThumbprint } from "./dpop";
import type { AsSigningKey } from "./as-key-management";
import type { NonceCache } from "./nonce-cache";
import type { DPoPAuthResult, BrainAction, DPoPBoundTokenClaims } from "./types";
import {
  checkIdentityAllowed,
  type LookupIdentity,
  type LookupManager,
} from "./identity-lifecycle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Workspace lookup port -- pure function signature (no Surreal import in domain). */
export type LookupWorkspace = (
  workspaceId: string,
) => Promise<{ name: string; identityId: string } | undefined>;

export type DPoPVerificationDeps = {
  asSigningKey: AsSigningKey;
  nonceCache: NonceCache;
  lookupWorkspace: LookupWorkspace;
  lookupIdentity?: LookupIdentity;
  lookupManager?: LookupManager;
};

// ---------------------------------------------------------------------------
// Error response builders
// ---------------------------------------------------------------------------

function dpopError(
  error: string,
  status: number,
  errorDescription?: string,
): Response {
  const body: Record<string, string> = { error };
  if (errorDescription) {
    body.error_description = errorDescription;
  }
  return jsonResponse(body, status);
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

type ExtractedAuth =
  | { type: "dpop"; token: string }
  | { type: "error"; response: Response };

/** Step 1: Extract and classify the Authorization header. */
function extractAuthorization(request: Request): ExtractedAuth {
  const authHeader = request.headers.get("authorization");

  // Check for session cookies without DPoP auth
  if (!authHeader) {
    const cookie = request.headers.get("cookie");
    if (cookie && isSessionCookie(cookie)) {
      return {
        type: "error",
        response: dpopError("dpop_required", 401, "Session cookies not accepted. Use DPoP."),
      };
    }
    return {
      type: "error",
      response: dpopError("dpop_required", 401),
    };
  }

  // Reject Bearer tokens
  if (authHeader.startsWith("Bearer ")) {
    return {
      type: "error",
      response: dpopError(
        "dpop_required",
        401,
        "Bearer tokens not accepted. Use DPoP.",
      ),
    };
  }

  // Must be DPoP scheme
  if (!authHeader.startsWith("DPoP ")) {
    return {
      type: "error",
      response: dpopError("dpop_required", 401),
    };
  }

  const token = authHeader.slice(5);
  if (!token) {
    return {
      type: "error",
      response: dpopError("dpop_required", 401),
    };
  }

  return { type: "dpop", token };
}

/** Step 2: Extract DPoP proof from request header. */
function extractDPoPProof(request: Request): string | Response {
  const proof = request.headers.get("dpop");
  if (!proof) {
    return dpopError(
      "invalid_request",
      401,
      "DPoP proof header required",
    );
  }
  return proof;
}

/** Step 3: Verify access token JWT signature against AS public key. */
async function verifyAccessToken(
  token: string,
  asSigningKey: AsSigningKey,
): Promise<DPoPBoundTokenClaims | Response> {
  try {
    const publicKey = await jose.importJWK(
      asSigningKey.publicJwk as jose.JWK,
      "ES256",
    );
    const { payload } = await jose.jwtVerify(token, publicKey);

    // Extract required claims
    const sub = payload.sub;
    if (!sub) {
      return dpopError("invalid_token", 401, "Token missing sub claim");
    }

    const cnf = payload.cnf as { jkt?: string } | undefined;
    if (!cnf?.jkt) {
      return dpopError("invalid_token", 401, "Token missing cnf.jkt claim");
    }

    return {
      sub,
      iss: payload.iss ?? "",
      aud: (Array.isArray(payload.aud) ? payload.aud[0] : payload.aud) ?? "",
      exp: payload.exp ?? 0,
      iat: payload.iat ?? 0,
      cnf: { jkt: cnf.jkt },
      authorization_details: (payload.authorization_details ?? []) as BrainAction[],
      "urn:brain:intent_id": (payload["urn:brain:intent_id"] ?? "") as string,
      "urn:brain:workspace": (payload["urn:brain:workspace"] ?? "") as string,
      "urn:brain:actor_type": payload["urn:brain:actor_type"] as string | undefined,
    };
  } catch {
    return dpopError("invalid_token", 401, "Access token signature verification failed");
  }
}

/** Step 4: Validate DPoP proof structure, signature, and claims. */
async function validateProof(
  proofJwt: string,
  method: string,
  uri: string,
): Promise<{ thumbprint: string; jti: string } | Response> {
  const result = await validateDPoPProof(proofJwt, method, uri);

  if (!result.valid) {
    return dpopError(result.code, 401, result.error);
  }

  return { thumbprint: result.thumbprint, jti: result.claims.jti };
}

/** Step 5: Verify sender binding -- proof JWK thumbprint must match token cnf.jkt. */
function verifySenderBinding(
  proofThumbprint: string,
  tokenThumbprint: string,
): Response | undefined {
  if (proofThumbprint !== tokenThumbprint) {
    return dpopError(
      "dpop_binding_mismatch",
      401,
      "DPoP proof key does not match token binding",
    );
  }
  return undefined;
}

/** Detect session-related cookies (better-auth patterns). */
function isSessionCookie(cookie: string): boolean {
  return (
    cookie.includes("better-auth.session_token") ||
    cookie.includes("better-auth.session") ||
    cookie.includes("__session")
  );
}

/** Derive the full request URI from the Request object. */
function deriveRequestUri(request: Request): string {
  return request.url;
}

// ---------------------------------------------------------------------------
// Main middleware
// ---------------------------------------------------------------------------

/**
 * Authenticate a DPoP-protected request.
 *
 * Returns DPoPAuthResult on success, or an error Response on failure.
 * Pure pipeline: extract auth -> extract proof -> verify token -> validate proof
 * -> verify binding -> check nonce -> lookup workspace -> build result.
 */
export async function authenticateDPoPRequest(
  request: Request,
  deps: DPoPVerificationDeps,
): Promise<DPoPAuthResult | Response> {
  // Step 1: Extract authorization
  const authResult = extractAuthorization(request);
  if (authResult.type === "error") {
    return authResult.response;
  }
  const accessToken = authResult.token;

  // Step 2: Extract DPoP proof
  const proofOrError = extractDPoPProof(request);
  if (proofOrError instanceof Response) {
    return proofOrError;
  }
  const proofJwt = proofOrError;

  // Step 3: Verify access token signature
  const claimsOrError = await verifyAccessToken(accessToken, deps.asSigningKey);
  if (claimsOrError instanceof Response) {
    return claimsOrError;
  }
  const claims = claimsOrError;

  // Step 4: Validate DPoP proof
  const method = request.method;
  const uri = deriveRequestUri(request);
  const proofResultOrError = await validateProof(proofJwt, method, uri);
  if (proofResultOrError instanceof Response) {
    return proofResultOrError;
  }
  const { thumbprint: proofThumbprint, jti } = proofResultOrError;

  // Step 5: Verify sender binding
  const bindingError = verifySenderBinding(proofThumbprint, claims.cnf.jkt);
  if (bindingError) {
    return bindingError;
  }

  // Step 6: Check nonce for replay protection
  const nonceAllowed = deps.nonceCache.check(jti);
  if (!nonceAllowed) {
    return dpopError("dpop_proof_reused", 401, "DPoP proof jti has been used");
  }

  // Step 7: Lookup workspace
  const workspaceId = claims["urn:brain:workspace"];
  if (!workspaceId) {
    return dpopError("invalid_token", 401, "Token missing workspace claim");
  }

  const workspace = await deps.lookupWorkspace(workspaceId);
  if (!workspace) {
    return dpopError("invalid_token", 401, "Workspace not found");
  }

  // Step 8: Check identity lifecycle (revocation)
  if (deps.lookupIdentity && deps.lookupManager) {
    const identityCheck = await checkIdentityAllowed(
      workspace.identityId,
      deps.lookupIdentity,
      deps.lookupManager,
    );

    if (!identityCheck.allowed) {
      return dpopError(
        "identity_blocked",
        401,
        identityCheck.reason,
      );
    }
  }

  // Step 9: Build result
  const actorType = (claims["urn:brain:actor_type"] === "human" ? "human" : "agent") as
    "human" | "agent";

  return {
    workspaceRecord: new RecordId("workspace", workspaceId),
    workspaceName: workspace.name,
    identityRecord: new RecordId("identity", workspace.identityId),
    actorType,
    authorizationDetails: claims.authorization_details,
    intentId: claims["urn:brain:intent_id"],
    dpopThumbprint: proofThumbprint,
  };
}
