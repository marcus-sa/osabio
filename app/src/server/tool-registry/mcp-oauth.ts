/**
 * MCP OAuth 2.1 Integration
 *
 * Thin wrappers around the MCP SDK's built-in OAuth client functions,
 * adapted for Brain's server-side split flow:
 *   1. Server creation → discovery + DCR + generate auth URL
 *   2. OAuth callback  → exchange code for tokens
 *   3. Sync/proxy      → attach tokens, refresh when expired
 *
 * Uses MCP SDK's:
 *   - discoverOAuthServerInfo()      (RFC 9728 + RFC 8414 discovery)
 *   - registerClient()               (RFC 7591 DCR)
 *   - startAuthorization()           (PKCE + auth URL)
 *   - exchangeAuthorization()        (token exchange with auto client auth)
 *   - refreshAuthorization()         (token refresh with auto client auth)
 */
import {
  discoverOAuthServerInfo,
  extractResourceMetadataUrl,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
  AuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthServerInfo } from "@modelcontextprotocol/sdk/client/auth.js";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export type { OAuthTokens, OAuthClientInformationMixed, AuthorizationServerMetadata, OAuthServerInfo };

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Discover OAuth configuration for an MCP server URL.
 * Combines RFC 9728 (protected resource metadata) and RFC 8414 (auth server metadata).
 *
 * Flow:
 *   1. Try SDK's discoverOAuthServerInfo (fetches .well-known/oauth-protected-resource)
 *   2. If no resourceMetadata, probe the server with a POST to trigger 401
 *   3. Extract resource_metadata URL from WWW-Authenticate header (RFC 9728 §5.1)
 *   4. Retry SDK discovery with the extracted URL
 *
 * Returns undefined if the server doesn't require OAuth.
 */
export async function discoverMcpServerOAuth(serverUrl: string): Promise<OAuthServerInfo | undefined> {
  // Step 1: Try SDK's standard discovery (.well-known/oauth-protected-resource)
  let info: OAuthServerInfo | undefined;
  try {
    info = await discoverOAuthServerInfo(serverUrl);
    if (info.resourceMetadata) return info;
  } catch (error) {
    log.info("mcp-oauth.discovery", "Standard OAuth discovery failed, trying WWW-Authenticate fallback", {
      serverUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Step 2: Fallback — probe the server to trigger 401, extract resource_metadata from WWW-Authenticate
  try {
    const resourceMetadataUrl = await probeWwwAuthenticate(serverUrl);
    if (resourceMetadataUrl) {
      log.info("mcp-oauth.discovery", "Found resource_metadata via WWW-Authenticate fallback", {
        serverUrl,
        resourceMetadataUrl: resourceMetadataUrl.toString(),
      });
      return await discoverOAuthServerInfo(serverUrl, { resourceMetadataUrl });
    }
  } catch (error) {
    log.info("mcp-oauth.discovery", "WWW-Authenticate fallback discovery failed", {
      serverUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return info;
}

/**
 * POST to the MCP server to trigger a 401 response, then extract
 * the resource_metadata URL from the WWW-Authenticate header.
 */
async function probeWwwAuthenticate(serverUrl: string): Promise<URL | undefined> {
  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    if (response.status !== 401) return undefined;

    return extractResourceMetadataUrl(response) ?? undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

export type ClientRegistrationResult = {
  clientId: string;
  clientSecret?: string;
};

/**
 * Register Brain as an OAuth client via dynamic client registration.
 * Returns client_id and optionally client_secret from the auth server.
 */
export async function registerOAuthClient(
  authServerUrl: string,
  redirectUri: string,
  metadata?: AuthorizationServerMetadata,
): Promise<ClientRegistrationResult> {
  const clientMetadata: OAuthClientMetadata = {
    redirect_uris: [redirectUri],
    client_name: "Brain",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  };

  const result = await registerClient(new URL(authServerUrl), {
    metadata,
    clientMetadata,
  });

  return {
    clientId: result.client_id,
    clientSecret: result.client_secret,
  };
}

// ---------------------------------------------------------------------------
// Authorization URL + PKCE
// ---------------------------------------------------------------------------

export type AuthorizationStartResult = {
  authorizationUrl: string;
  codeVerifier: string;
};

/**
 * Generate PKCE challenge and build the OAuth authorization URL.
 * The code_verifier must be stored for the callback.
 */
export async function startOAuthAuthorization(
  authServerUrl: string,
  clientInfo: OAuthClientInformationMixed,
  redirectUrl: string,
  opts?: {
    metadata?: AuthorizationServerMetadata;
    scope?: string;
    state?: string;
    resource?: URL;
  },
): Promise<AuthorizationStartResult> {
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authServerUrl,
    {
      metadata: opts?.metadata,
      clientInformation: clientInfo,
      redirectUrl,
      scope: opts?.scope,
      state: opts?.state,
      resource: opts?.resource,
    },
  );

  return {
    authorizationUrl: authorizationUrl.toString(),
    codeVerifier,
  };
}

// ---------------------------------------------------------------------------
// Token Exchange
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for tokens.
 * The SDK automatically selects the correct client authentication method
 * based on the auth server's metadata.
 */
export async function exchangeOAuthCode(
  authServerUrl: string,
  clientInfo: OAuthClientInformationMixed,
  authorizationCode: string,
  codeVerifier: string,
  redirectUri: string,
  opts?: {
    metadata?: AuthorizationServerMetadata;
    resource?: URL;
  },
): Promise<OAuthTokens> {
  return exchangeAuthorization(authServerUrl, {
    metadata: opts?.metadata,
    clientInformation: clientInfo,
    authorizationCode,
    codeVerifier,
    redirectUri,
    resource: opts?.resource,
  });
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/**
 * Refresh an expired access token using a refresh token.
 * The SDK automatically selects the correct client authentication method.
 */
export async function refreshOAuthTokens(
  authServerUrl: string,
  clientInfo: OAuthClientInformationMixed,
  refreshToken: string,
  opts?: {
    metadata?: AuthorizationServerMetadata;
    resource?: URL;
  },
): Promise<OAuthTokens> {
  return refreshAuthorization(authServerUrl, {
    metadata: opts?.metadata,
    clientInformation: clientInfo,
    refreshToken,
    resource: opts?.resource,
  });
}
