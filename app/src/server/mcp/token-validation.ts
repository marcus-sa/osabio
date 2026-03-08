import { verifyAccessToken } from "better-auth/oauth2";

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
 */
export function createJwtValidator(issuerUrl: string) {
  // issuerUrl is the server baseURL (e.g. "http://localhost:3000").
  // Better Auth mounts at /api/auth (basePath), so JWKS and issuer include that path.
  const authBase = issuerUrl.endsWith("/api/auth") ? issuerUrl : `${issuerUrl}/api/auth`;
  const jwksUrl = `${authBase}/jwks`;
  const issuer = authBase;

  return async (token: string): Promise<BrainTokenClaims> => {
    const payload = await verifyAccessToken(token, {
      jwksUrl,
      verifyOptions: {
        issuer,
        audience: issuerUrl,
      },
    });
    return payload as BrainTokenClaims;
  };
}
