/**
 * Unit tests for OAuth flow pure functions: generatePkce, buildAuthorizationUrl, buildTokenRequest.
 */
import { describe, expect, it } from "bun:test";
import { generatePkce, buildAuthorizationUrl, buildTokenRequest } from "../../../app/src/server/tool-registry/oauth-flow";
import type { AuthorizationParams, TokenExchangeParams } from "../../../app/src/server/tool-registry/types";

describe("generatePkce", () => {
  it("returns codeVerifier between 43 and 128 characters using unreserved chars", async () => {
    const pkce = await generatePkce();

    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128);
    // RFC 7636: unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
    expect(pkce.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("returns codeChallenge as base64url-encoded SHA256 of verifier", async () => {
    const pkce = await generatePkce();

    // Independently compute expected challenge
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(pkce.codeVerifier));
    const expectedChallenge = base64UrlEncode(digest);

    expect(pkce.codeChallenge).toBe(expectedChallenge);
  });

  it("generates unique verifiers on each call", async () => {
    const first = await generatePkce();
    const second = await generatePkce();

    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.codeChallenge).not.toBe(second.codeChallenge);
  });
});

describe("buildAuthorizationUrl", () => {
  const baseParams: AuthorizationParams = {
    authorizationEndpoint: "https://auth.example.com/authorize",
    clientId: "brain-client-123",
    redirectUri: "https://brain.example.com/oauth/callback",
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    state: "random-state-abc",
    resource: "https://mcp.example.com",
    scope: "read write",
  };

  it("includes all required OAuth 2.1 parameters", () => {
    const urlString = buildAuthorizationUrl(baseParams);
    const url = new URL(urlString);

    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("brain-client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://brain.example.com/oauth/callback");
    expect(url.searchParams.get("code_challenge")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("random-state-abc");
    expect(url.searchParams.get("resource")).toBe("https://mcp.example.com");
    expect(url.searchParams.get("scope")).toBe("read write");
  });

  it("omits scope when not provided", () => {
    const params: AuthorizationParams = { ...baseParams, scope: undefined };
    const urlString = buildAuthorizationUrl(params);
    const url = new URL(urlString);

    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("buildTokenRequest", () => {
  const baseParams: TokenExchangeParams = {
    tokenEndpoint: "https://auth.example.com/token",
    code: "auth-code-abc",
    redirectUri: "https://brain.example.com/oauth/callback",
    codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    clientId: "brain-client-123",
  };

  it("returns url matching the token endpoint", () => {
    const request = buildTokenRequest(baseParams);
    expect(request.url).toBe("https://auth.example.com/token");
  });

  it("includes grant_type=authorization_code in body", () => {
    const request = buildTokenRequest(baseParams);
    expect(request.body.get("grant_type")).toBe("authorization_code");
  });

  it("includes code, redirect_uri, code_verifier, and client_id in body", () => {
    const request = buildTokenRequest(baseParams);
    expect(request.body.get("code")).toBe("auth-code-abc");
    expect(request.body.get("redirect_uri")).toBe("https://brain.example.com/oauth/callback");
    expect(request.body.get("code_verifier")).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(request.body.get("client_id")).toBe("brain-client-123");
  });

  it("sets Content-Type to application/x-www-form-urlencoded", () => {
    const request = buildTokenRequest(baseParams);
    expect(request.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("sets Accept to application/json", () => {
    const request = buildTokenRequest(baseParams);
    expect(request.headers["Accept"]).toBe("application/json");
  });
});

// Helper: base64url encode an ArrayBuffer (no padding)
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
