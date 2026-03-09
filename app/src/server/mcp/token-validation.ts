import { createRemoteJWKSet, jwtVerify } from "jose";

export type BrainTokenClaims = {
  sub: string;
  scope?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  "urn:brain:workspace"?: string;
  "urn:brain:workspace_name"?: string;
  "urn:brain:agent_type"?: string;
  [key: string]: unknown;
};

/**
 * Create a JWT validator that verifies access tokens using the auth server's JWKS.
 * Tokens must be JWTs (issued when `resource` param is passed during authorization).
 *
 * Uses jose's createRemoteJWKSet directly instead of better-auth's verifyAccessToken
 * because the latter uses a module-level JWKS singleton cache that breaks when
 * multiple test servers (each with their own JWKS keys) run concurrently.
 */
export function createJwtValidator(issuerUrl: string) {
  // issuerUrl is the server baseURL (e.g. "http://localhost:3000").
  // Better Auth mounts at /api/auth (basePath), so JWKS and issuer include that path.
  const authBase = issuerUrl.endsWith("/api/auth") ? issuerUrl : `${issuerUrl}/api/auth`;
  const jwksUrl = new URL(`${authBase}/jwks`);
  const issuer = authBase;

  // createRemoteJWKSet maintains its own per-URL cache with proper key rotation
  const getKey = createRemoteJWKSet(jwksUrl);

  return async (token: string): Promise<BrainTokenClaims> => {
    const { payload } = await jwtVerify(token, getKey, {
      issuer,
      audience: issuerUrl,
    });
    return payload as BrainTokenClaims;
  };
}
