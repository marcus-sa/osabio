/**
 * OAuth 2.1 Auth Discovery (RFC 9728 + RFC 8414)
 *
 * Pure core: parsing + URL derivation functions (no IO).
 * Effect shell: discoverAuth() performs HTTP fetches via injectable fetchFn.
 *
 * Flow:
 *   1. Fetch /.well-known/oauth-protected-resource from MCP server origin
 *   2. Parse Protected Resource Metadata, extract authorization_servers[0]
 *   3. Derive well-known endpoints for the auth server
 *   4. Try each endpoint until one succeeds
 *   5. Return DiscoveredAuthConfig or undefined
 */
import type {
  ProtectedResourceMetadata,
  AuthServerMetadata,
  DiscoveredAuthConfig,
} from "./types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Result type (pure, no exceptions)
// ---------------------------------------------------------------------------

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Pure core: parsing functions
// ---------------------------------------------------------------------------

/**
 * Parse and validate Protected Resource Metadata (RFC 9728).
 */
export function parseProtectedResourceMetadata(
  json: unknown,
): Result<ProtectedResourceMetadata> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, error: "Protected Resource Metadata must be a JSON object" };
  }

  const obj = json as Record<string, unknown>;

  if (typeof obj.resource !== "string" || obj.resource.length === 0) {
    return { ok: false, error: "Missing or invalid 'resource' field" };
  }

  if (
    !Array.isArray(obj.authorization_servers) ||
    obj.authorization_servers.length === 0 ||
    !obj.authorization_servers.every((s: unknown) => typeof s === "string")
  ) {
    return {
      ok: false,
      error: "Missing or empty 'authorization_servers' array",
    };
  }

  const metadata: ProtectedResourceMetadata = {
    resource: obj.resource,
    authorization_servers: obj.authorization_servers as string[],
  };

  if (Array.isArray(obj.scopes_supported)) {
    metadata.scopes_supported = obj.scopes_supported as string[];
  }

  if (Array.isArray(obj.bearer_methods_supported)) {
    metadata.bearer_methods_supported = obj.bearer_methods_supported as string[];
  }

  return { ok: true, value: metadata };
}

/**
 * Parse and validate Authorization Server Metadata (RFC 8414).
 */
export function parseAuthServerMetadata(
  json: unknown,
): Result<AuthServerMetadata> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, error: "Auth Server Metadata must be a JSON object" };
  }

  const obj = json as Record<string, unknown>;

  if (typeof obj.issuer !== "string" || obj.issuer.length === 0) {
    return { ok: false, error: "Missing or invalid 'issuer' field" };
  }

  if (typeof obj.authorization_endpoint !== "string" || obj.authorization_endpoint.length === 0) {
    return { ok: false, error: "Missing or invalid 'authorization_endpoint' field" };
  }

  if (typeof obj.token_endpoint !== "string" || obj.token_endpoint.length === 0) {
    return { ok: false, error: "Missing or invalid 'token_endpoint' field" };
  }

  const metadata: AuthServerMetadata = {
    issuer: obj.issuer,
    authorization_endpoint: obj.authorization_endpoint,
    token_endpoint: obj.token_endpoint,
    response_types_supported: Array.isArray(obj.response_types_supported)
      ? (obj.response_types_supported as string[])
      : ["code"],
  };

  if (typeof obj.registration_endpoint === "string") {
    metadata.registration_endpoint = obj.registration_endpoint;
  }

  if (Array.isArray(obj.scopes_supported)) {
    metadata.scopes_supported = obj.scopes_supported as string[];
  }

  if (Array.isArray(obj.code_challenge_methods_supported)) {
    metadata.code_challenge_methods_supported = obj.code_challenge_methods_supported as string[];
  }

  if (Array.isArray(obj.grant_types_supported)) {
    metadata.grant_types_supported = obj.grant_types_supported as string[];
  }

  return { ok: true, value: metadata };
}

// ---------------------------------------------------------------------------
// Pure core: URL derivation
// ---------------------------------------------------------------------------

/**
 * Derive well-known discovery endpoint URLs for an authorization server (RFC 8414).
 *
 * For URLs without path: returns 2 endpoints.
 * For URLs with path: returns 3 endpoints (path-aware variants).
 */
export function deriveDiscoveryEndpoints(issuerUrl: string): string[] {
  const normalized = issuerUrl.replace(/\/+$/, "");
  const parsed = new URL(normalized);
  const origin = parsed.origin;
  const path = parsed.pathname === "/" ? "" : parsed.pathname;

  if (path === "") {
    return [
      `${origin}/.well-known/oauth-authorization-server`,
      `${origin}/.well-known/openid-configuration`,
    ];
  }

  return [
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    `${origin}${path}/.well-known/openid-configuration`,
  ];
}

/**
 * Derive the Protected Resource Metadata URL from an MCP server URL.
 * Always uses the origin (strips path).
 */
export function deriveResourceMetadataUrl(serverUrl: string): string {
  const parsed = new URL(serverUrl);
  return `${parsed.origin}/.well-known/oauth-protected-resource`;
}

/**
 * Select the first authorization server from the list.
 */
export function selectAuthorizationServer(servers: string[]): string | undefined {
  return servers[0];
}

// ---------------------------------------------------------------------------
// Pure core: transform AuthServerMetadata -> DiscoveredAuthConfig
// ---------------------------------------------------------------------------

function toDiscoveredAuthConfig(
  authServerUrl: string,
  authMetadata: AuthServerMetadata,
  resourceMetadata: ProtectedResourceMetadata,
): DiscoveredAuthConfig {
  const config: DiscoveredAuthConfig = {
    authServerUrl,
    authorizationEndpoint: authMetadata.authorization_endpoint,
    tokenEndpoint: authMetadata.token_endpoint,
    supportsS256: authMetadata.code_challenge_methods_supported?.includes("S256") ?? false,
    resourceUri: resourceMetadata.resource,
  };

  if (authMetadata.registration_endpoint) {
    config.registrationEndpoint = authMetadata.registration_endpoint;
  }

  // Merge scopes: prefer resource metadata scopes, fall back to auth server scopes
  const scopes = resourceMetadata.scopes_supported ?? authMetadata.scopes_supported;
  if (scopes && scopes.length > 0) {
    config.scopesSupported = scopes;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Effect shell: HTTP discovery
// ---------------------------------------------------------------------------

/**
 * Discover OAuth auth configuration from an MCP server URL.
 *
 * 1. Fetches Protected Resource Metadata from the MCP server origin.
 * 2. Extracts the first authorization server.
 * 3. Tries well-known endpoints to fetch Auth Server Metadata.
 * 4. Returns DiscoveredAuthConfig on success, undefined on failure.
 *
 * fetchFn is injectable for testing.
 */
export async function discoverAuth(
  serverUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoveredAuthConfig | undefined> {
  // Step 1: Fetch Protected Resource Metadata
  const resourceMetadataUrl = deriveResourceMetadataUrl(serverUrl);

  let resourceJson: unknown;
  try {
    const response = await fetchFn(resourceMetadataUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      log.info("auth-discovery", "Protected Resource Metadata not available", {
        url: resourceMetadataUrl,
        status: response.status,
      });
      return undefined;
    }
    resourceJson = await response.json();
  } catch (error) {
    log.info("auth-discovery", "Failed to fetch Protected Resource Metadata", {
      url: resourceMetadataUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  // Step 2: Parse resource metadata
  const resourceResult = parseProtectedResourceMetadata(resourceJson);
  if (!resourceResult.ok) {
    log.info("auth-discovery", "Invalid Protected Resource Metadata", {
      error: resourceResult.error,
    });
    return undefined;
  }

  // Step 3: Select authorization server
  const authServerUrl = selectAuthorizationServer(resourceResult.value.authorization_servers);
  if (!authServerUrl) {
    log.info("auth-discovery", "No authorization servers found in metadata");
    return undefined;
  }

  // Step 4: Try well-known endpoints for auth server metadata
  const discoveryEndpoints = deriveDiscoveryEndpoints(authServerUrl);

  for (const endpoint of discoveryEndpoints) {
    try {
      const response = await fetchFn(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;

      const authJson = await response.json();
      const authResult = parseAuthServerMetadata(authJson);

      if (authResult.ok) {
        return toDiscoveredAuthConfig(authServerUrl, authResult.value, resourceResult.value);
      }
    } catch {
      // Try next endpoint
      continue;
    }
  }

  log.info("auth-discovery", "No valid auth server metadata found at any well-known endpoint", {
    authServerUrl,
    endpointsTried: discoveryEndpoints,
  });
  return undefined;
}
