/**
 * Legacy OAuth2 helpers for the credential provider connect flow (routes.ts).
 *
 * The MCP server OAuth flow uses mcp-oauth.ts (MCP SDK wrappers) instead.
 * This file only contains the in-memory state store and legacy authorization
 * URL builder still used by the provider account connection endpoints.
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
// Legacy Authorization URL Builder (provider-based)
// ---------------------------------------------------------------------------

/**
 * Build an OAuth 2.0 authorization URL from a credential provider record.
 * Used by the legacy provider account connection flow in routes.ts.
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
