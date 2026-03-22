/**
 * OAuth2 authorization flow helpers for credential providers.
 *
 * Pure functions for building authorization URLs and exchanging codes for tokens.
 * State management uses an in-memory map (sufficient for walking skeleton;
 * production should use short-lived DB records).
 *
 * ADR-066, ADR-068.
 */

import type { CredentialProviderRecord } from "./types";

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
// Authorization URL Builder
// ---------------------------------------------------------------------------

/**
 * Build the OAuth2 authorization URL for a provider.
 * Returns the full URL with client_id, redirect_uri, scopes, state, and response_type=code.
 */
export function buildAuthorizationUrl(
  provider: CredentialProviderRecord,
  redirectUri: string,
  state: string,
): string {
  if (!provider.authorization_url) {
    throw new Error("Provider missing authorization_url for OAuth2 flow");
  }
  if (!provider.client_id) {
    throw new Error("Provider missing client_id for OAuth2 flow");
  }

  const url = new URL(provider.authorization_url);
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

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
