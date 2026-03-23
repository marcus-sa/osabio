/**
 * OAuth2 authorization flow helpers for credential providers.
 *
 * Pure functions for building authorization URLs and exchanging codes for tokens.
 * State management uses an in-memory map (sufficient for walking skeleton;
 * production should use short-lived DB records).
 *
 * ADR-066, ADR-068.
 */

import type { CredentialProviderRecord, PkceChallenge, AuthorizationParams, TokenExchangeParams, TokenResult } from "./types";

// ---------------------------------------------------------------------------
// State Store -- in-memory map keyed by state parameter
// ---------------------------------------------------------------------------

export type OAuthStateEntry = {
  providerId: string;
  identityId: string;
  workspaceId: string;
  createdAt: number;
};

const pendingStates = new Map<string, OAuthStateEntry>();

/** TTL for state entries: 10 minutes */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Store a state parameter for later verification during callback.
 */
export function storeOAuthState(state: string, entry: OAuthStateEntry): void {
  pendingStates.set(state, entry);
}

/**
 * Retrieve and consume a state entry. Returns undefined if not found or expired.
 */
export function consumeOAuthState(state: string): OAuthStateEntry | undefined {
  const entry = pendingStates.get(state);
  if (!entry) return undefined;

  pendingStates.delete(state);

  const elapsed = Date.now() - entry.createdAt;
  if (elapsed > STATE_TTL_MS) return undefined;

  return entry;
}

// ---------------------------------------------------------------------------
// PKCE S256 Generation
// ---------------------------------------------------------------------------

/**
 * Generate a PKCE code_verifier and code_challenge (S256).
 * Uses Web Crypto API (available in Bun natively).
 *
 * code_verifier: 64 characters from unreserved set [A-Za-z0-9-._~]
 * code_challenge: BASE64URL(SHA256(code_verifier))
 */
export async function generatePkce(): Promise<PkceChallenge> {
  const codeVerifier = generateCodeVerifier(64);
  const codeChallenge = await computeS256Challenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

/** Generate a random code_verifier of specified length using unreserved characters. */
function generateCodeVerifier(length: number): string {
  // RFC 7636 unreserved characters
  const unreservedChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  let verifier = "";
  for (const byte of randomBytes) {
    verifier += unreservedChars[byte % unreservedChars.length];
  }
  return verifier;
}

/** Compute BASE64URL(SHA256(verifier)) with no padding. */
async function computeS256Challenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64UrlEncode(digest);
}

/** Base64url encode an ArrayBuffer (no padding). */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// PKCE-Aware Authorization URL Builder
// ---------------------------------------------------------------------------

/**
 * Build an OAuth 2.1 authorization URL with PKCE S256 and resource parameter (RFC 8707).
 * Pure function -- all inputs explicit, no side effects.
 */
export function buildAuthorizationUrl(params: AuthorizationParams): string;
export function buildAuthorizationUrl(
  provider: CredentialProviderRecord,
  redirectUri: string,
  state: string,
): string;
export function buildAuthorizationUrl(
  paramsOrProvider: AuthorizationParams | CredentialProviderRecord,
  redirectUri?: string,
  state?: string,
): string {
  // Overload: AuthorizationParams (new PKCE-aware version)
  if ("authorizationEndpoint" in paramsOrProvider) {
    const params = paramsOrProvider;
    const url = new URL(params.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", params.state);
    url.searchParams.set("resource", params.resource);
    if (params.scope) {
      url.searchParams.set("scope", params.scope);
    }
    return url.toString();
  }

  // Overload: legacy provider-based version
  const provider = paramsOrProvider;
  if (!provider.authorization_url) {
    throw new Error("Provider missing authorization_url for OAuth2 flow");
  }
  if (!provider.client_id) {
    throw new Error("Provider missing client_id for OAuth2 flow");
  }

  const url = new URL(provider.authorization_url);
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("redirect_uri", redirectUri!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state!);

  if (provider.scopes && provider.scopes.length > 0) {
    url.searchParams.set("scope", provider.scopes.join(" "));
  }

  return url.toString();
}

// ---------------------------------------------------------------------------
// Token Exchange
// ---------------------------------------------------------------------------

export type TokenExchangeResult = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

/**
 * Exchange an authorization code for tokens at the provider's token endpoint.
 * Sends client_id and client_secret via POST body (application/x-www-form-urlencoded).
 */
export async function exchangeCodeForTokens(
  provider: CredentialProviderRecord,
  code: string,
  redirectUri: string,
  clientSecret: string,
): Promise<TokenExchangeResult> {
  if (!provider.token_url) {
    throw new Error("Provider missing token_url for OAuth2 token exchange");
  }
  if (!provider.client_id) {
    throw new Error("Provider missing client_id for OAuth2 token exchange");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: provider.client_id,
    client_secret: clientSecret,
  });

  const response = await fetch(provider.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json() as TokenExchangeResult;
  return data;
}

// ---------------------------------------------------------------------------
// PKCE Token Request Builder (Pure)
// ---------------------------------------------------------------------------

/**
 * Build a token exchange request for authorization_code grant with PKCE.
 * Pure function -- produces { url, body, headers } without performing IO.
 */
export function buildTokenRequest(params: TokenExchangeParams): {
  url: string;
  body: URLSearchParams;
  headers: Record<string, string>;
} {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
  });

  return {
    url: params.tokenEndpoint,
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
  };
}

// ---------------------------------------------------------------------------
// PKCE Token Exchange (Effect)
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;

/**
 * Exchange an authorization code for tokens using PKCE at the token endpoint.
 * Effect function -- fetch is injectable for testability.
 */
export async function exchangeCode(
  params: TokenExchangeParams,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<TokenResult> {
  const request = buildTokenRequest(params);

  const response = await fetchFn(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as TokenResult;
}
