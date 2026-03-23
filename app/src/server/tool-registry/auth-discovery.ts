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
// Pure core: WWW-Authenticate header parsing
// ---------------------------------------------------------------------------

/**
 * Parse WWW-Authenticate header to extract resource_metadata URL.
 *
 * Format: Bearer resource_metadata="https://..."
 * Per RFC 9728 section 5.1, the resource_metadata parameter in the
 * WWW-Authenticate header points to the Protected Resource Metadata URL.
 */
export function parseWwwAuthenticate(header: string): { resourceMetadataUrl?: string } {
  if (!header.startsWith("Bearer ")) {
    return { resourceMetadataUrl: undefined };
  }

  const params = header.slice("Bearer ".length);
  const match = params.match(/resource_metadata="([^"]+)"/);
  if (match) {
    return { resourceMetadataUrl: match[1] };
  }

  // Try unquoted value: resource_metadata=<url> (terminated by comma, space, or end)
  const unquotedMatch = params.match(/resource_metadata=([^,\s"]+)/);
  if (unquotedMatch) {
    return { resourceMetadataUrl: unquotedMatch[1] };
  }

  return { resourceMetadataUrl: undefined };
}

// ---------------------------------------------------------------------------
// Effect shell: HTTP discovery
// ---------------------------------------------------------------------------

/**
 * Fetch JSON from a URL, returning undefined on failure.
 */
async function fetchJson(
  url: string,
  fetchFn: typeof fetch,
): Promise<unknown | undefined> {
  try {
    const response = await fetchFn(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Fallback: request the MCP server to trigger a 401, then extract
 * the resource_metadata URL from the WWW-Authenticate header.
 * Returns the parsed resource metadata JSON, or undefined.
 */
async function fetchResourceMetadataViaWwwAuthenticate(
  serverUrl: string,
  fetchFn: typeof fetch,
): Promise<unknown | undefined> {
  try {
    const response = await fetchFn(serverUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (response.status !== 401) return undefined;

    const wwwAuth = response.headers.get("WWW-Authenticate");
    if (!wwwAuth) return undefined;

    const { resourceMetadataUrl } = parseWwwAuthenticate(wwwAuth);
    if (!resourceMetadataUrl) return undefined;

    log.info("auth-discovery", "Found resource_metadata URL in WWW-Authenticate header", {
      resourceMetadataUrl,
    });

    return await fetchJson(resourceMetadataUrl, fetchFn);
  } catch (error) {
    log.info("auth-discovery", "WWW-Authenticate fallback failed", {
      serverUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Try well-known discovery endpoints for auth server metadata.
 * Returns the first valid AuthServerMetadata, or undefined.
 */
async function fetchAuthServerMetadata(
  authServerUrl: string,
  fetchFn: typeof fetch,
): Promise<AuthServerMetadata | undefined> {
  const discoveryEndpoints = deriveDiscoveryEndpoints(authServerUrl);

  for (const endpoint of discoveryEndpoints) {
    const authJson = await fetchJson(endpoint, fetchFn);
    if (authJson === undefined) continue;

    const authResult = parseAuthServerMetadata(authJson);
    if (authResult.ok) return authResult.value;
  }

  log.info("auth-discovery", "No valid auth server metadata found at any well-known endpoint", {
    authServerUrl,
    endpointsTried: discoveryEndpoints,
  });
  return undefined;
}

/**
 * Discover OAuth auth configuration from an MCP server URL.
 *
 * 1. Fetches Protected Resource Metadata from /.well-known/oauth-protected-resource
 * 2. If not found, falls back to requesting the MCP server (triggers 401)
 *    and parses resource_metadata URL from WWW-Authenticate header
 * 3. Extracts the first authorization server from resource metadata
 * 4. Tries well-known endpoints to fetch Auth Server Metadata
 * 5. Returns DiscoveredAuthConfig on success, undefined on failure
 *
 * fetchFn is injectable for testing.
 */
export async function discoverAuth(
  serverUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoveredAuthConfig | undefined> {
  // Step 1: Fetch Protected Resource Metadata (well-known path)
  const resourceMetadataUrl = deriveResourceMetadataUrl(serverUrl);
  let resourceJson = await fetchJson(resourceMetadataUrl, fetchFn);

  // Step 1b: Fallback — trigger 401, parse WWW-Authenticate header
  if (resourceJson === undefined) {
    log.info("auth-discovery", "Protected Resource Metadata not available, trying WWW-Authenticate fallback", {
      url: resourceMetadataUrl,
    });
    resourceJson = await fetchResourceMetadataViaWwwAuthenticate(serverUrl, fetchFn);
  }

  if (resourceJson === undefined) {
    log.info("auth-discovery", "No Protected Resource Metadata found via any method", {
      serverUrl,
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

  // Step 4: Fetch auth server metadata
  const authMetadata = await fetchAuthServerMetadata(authServerUrl, fetchFn);
  if (!authMetadata) return undefined;

  return toDiscoveredAuthConfig(authServerUrl, authMetadata, resourceResult.value);
}
