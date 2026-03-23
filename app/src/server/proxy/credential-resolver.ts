/**
 * Credential Resolver -- resolves and injects auth headers for integration tools.
 *
 * Pure core: buildAuthHeaders (auth_method + decrypted creds -> headers)
 * Effect shell: resolveCredentialsForTool (DB query + decrypt + build headers)
 *
 * Resolution chain: mcp_tool.name -> mcp_tool.provider -> credential_provider
 *   -> connected_account (WHERE identity=$id AND provider=$provider AND status=active)
 *   -> decrypt -> build auth headers by auth_method.
 *
 * Step 07-01 in the MCP tool registry feature.
 */
import { RecordId, type Surreal } from "surrealdb";
import { decryptSecret } from "../tool-registry/encryption";
import { encryptSecret } from "../tool-registry/encryption";
import { decryptHeaders, buildHeaderMap } from "../tool-registry/static-headers";
import { refreshAccessToken } from "../tool-registry/oauth-flow";
import type { AuthMethod, McpServerRecord } from "../tool-registry/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Successful credential resolution: headers to inject into the outgoing request. */
export type CredentialSuccess = {
  readonly ok: true;
  readonly headers: Record<string, string>;
};

/** Failed credential resolution: error message for the LLM. */
export type CredentialError = {
  readonly ok: false;
  readonly error: string;
};

/** Result of credential resolution. */
export type CredentialResult = CredentialSuccess | CredentialError;

/** Dependencies for the credential resolver effect shell. */
export type CredentialResolverDeps = {
  readonly surreal: Surreal;
  readonly toolEncryptionKey: string;
};

// ---------------------------------------------------------------------------
// Pure Core: buildAuthHeaders
// ---------------------------------------------------------------------------

/** Decrypted credential fields from a connected_account. */
export type DecryptedCredentials = {
  readonly authMethod: AuthMethod;
  readonly apiKey?: string;
  readonly apiKeyHeader?: string;
  readonly bearerToken?: string;
  readonly basicUsername?: string;
  readonly basicPassword?: string;
  readonly accessToken?: string;
};

/**
 * Build auth headers from decrypted credentials.
 * Pure function: no IO, no side effects.
 */
export function buildAuthHeaders(
  credentials: DecryptedCredentials,
): CredentialResult {
  switch (credentials.authMethod) {
    case "api_key": {
      if (!credentials.apiKey) {
        return { ok: false, error: "API key not found in connected account" };
      }
      const headerName = credentials.apiKeyHeader || "X-API-Key";
      return { ok: true, headers: { [headerName]: credentials.apiKey } };
    }

    case "basic": {
      if (!credentials.basicUsername || !credentials.basicPassword) {
        return { ok: false, error: "Basic auth credentials incomplete" };
      }
      const encoded = btoa(`${credentials.basicUsername}:${credentials.basicPassword}`);
      return { ok: true, headers: { Authorization: `Basic ${encoded}` } };
    }

    case "bearer": {
      if (!credentials.bearerToken) {
        return { ok: false, error: "Bearer token not found in connected account" };
      }
      return { ok: true, headers: { Authorization: `Bearer ${credentials.bearerToken}` } };
    }

    case "oauth2": {
      if (!credentials.accessToken) {
        return { ok: false, error: "OAuth2 access token not found in connected account" };
      }
      return { ok: true, headers: { Authorization: `Bearer ${credentials.accessToken}` } };
    }
  }
}

// ---------------------------------------------------------------------------
// Resolve Auth for MCP Server
// ---------------------------------------------------------------------------

/** Dependencies for resolveAuthForMcpServer when oauth mode needs DB + network. */
export type McpServerAuthDeps = {
  readonly surreal: Surreal;
  readonly toolEncryptionKey: string;
  readonly fetchFn?: typeof globalThis.fetch;
};

/**
 * Resolve auth headers for an MCP server based on its auth_mode.
 *
 * Async because oauth mode requires DB reads and potentially a token refresh.
 *
 *   auth_mode "none"           -> {}
 *   auth_mode "static_headers" -> decrypt stored headers, return as plain map
 *   auth_mode "oauth"          -> load connected_account, refresh if expired, return Bearer header
 *   auth_mode "provider"       -> TODO (existing credential_provider flow)
 */
export async function resolveAuthForMcpServer(
  server: McpServerRecord,
  encryptionKey: string,
  deps?: McpServerAuthDeps,
): Promise<Record<string, string>> {
  switch (server.auth_mode) {
    case "static_headers": {
      if (!server.static_headers || server.static_headers.length === 0) {
        return {};
      }
      const decrypted = decryptHeaders(server.static_headers, encryptionKey);
      return buildHeaderMap(decrypted);
    }
    case "oauth": {
      if (!server.oauth_account || !deps) {
        return {};
      }
      return resolveOAuthHeaders(server, deps);
    }
    case "none":
    case "provider":
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// OAuth Header Resolution (internal)
// ---------------------------------------------------------------------------

/** Row shape when loading connected_account for oauth resolution. */
type OAuthAccountRow = {
  id: RecordId<"connected_account", string>;
  status: string;
  access_token_encrypted?: string;
  refresh_token_encrypted?: string;
  token_expires_at?: string | Date;
  provider: RecordId<"credential_provider", string>;
};

/** Row shape for loading provider token_endpoint and client_id. */
type OAuthProviderRow = {
  token_url?: string;
  client_id?: string;
  client_secret_encrypted?: string;
};

/** Buffer in milliseconds: refresh tokens that expire within 60s. */
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

async function resolveOAuthHeaders(
  server: McpServerRecord,
  deps: McpServerAuthDeps,
): Promise<Record<string, string>> {
  const { surreal, toolEncryptionKey, fetchFn } = deps;

  // Load connected_account
  const [accountRows] = await surreal.query<[OAuthAccountRow[]]>(
    `SELECT id, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, provider FROM $acct;`,
    { acct: server.oauth_account },
  );
  const account = (accountRows ?? [])[0];
  if (!account || account.status !== "active" || !account.access_token_encrypted) {
    return {};
  }

  // Check if token is expired or about to expire
  const tokenNeedsRefresh = isTokenExpiredWithBuffer(account.token_expires_at);

  if (tokenNeedsRefresh && account.refresh_token_encrypted) {
    // Load provider for token_endpoint
    const [providerRows] = await surreal.query<[OAuthProviderRow[]]>(
      `SELECT token_url, client_id, client_secret_encrypted FROM $provider;`,
      { provider: account.provider },
    );
    const provider = (providerRows ?? [])[0];

    if (provider?.token_url) {
      const refreshToken = decryptSecret(account.refresh_token_encrypted, toolEncryptionKey);
      const clientSecret = provider.client_secret_encrypted
        ? decryptSecret(provider.client_secret_encrypted, toolEncryptionKey)
        : undefined;

      try {
        const tokenResult = await refreshAccessToken(
          {
            tokenEndpoint: provider.token_url,
            refreshToken,
            clientId: provider.client_id,
            clientSecret,
          },
          fetchFn,
        );

        // Store new encrypted tokens
        const newAccessTokenEncrypted = encryptSecret(tokenResult.access_token, toolEncryptionKey);
        const expiresAt = tokenResult.expires_in
          ? new Date(Date.now() + tokenResult.expires_in * 1000)
          : undefined;

        const updateParts = [
          `access_token_encrypted = $newToken`,
          `updated_at = time::now()`,
        ];
        const bindings: Record<string, unknown> = {
          acct: account.id,
          newToken: newAccessTokenEncrypted,
        };

        if (expiresAt) {
          updateParts.push(`token_expires_at = $expiresAt`);
          bindings.expiresAt = expiresAt;
        }

        if (tokenResult.refresh_token) {
          const newRefreshEncrypted = encryptSecret(tokenResult.refresh_token, toolEncryptionKey);
          updateParts.push(`refresh_token_encrypted = $newRefresh`);
          bindings.newRefresh = newRefreshEncrypted;
        }

        await surreal.query(`UPDATE $acct SET ${updateParts.join(", ")};`, bindings);

        return { Authorization: `Bearer ${tokenResult.access_token}` };
      } catch {
        // Refresh failed -- mark account as expired
        await surreal.query(`UPDATE $acct SET status = 'expired', updated_at = time::now();`, {
          acct: account.id,
        });
        return {};
      }
    }
  }

  // Token is still valid -- decrypt and return
  const accessToken = decryptSecret(account.access_token_encrypted, toolEncryptionKey);
  return { Authorization: `Bearer ${accessToken}` };
}

function isTokenExpiredWithBuffer(tokenExpiresAt?: string | Date): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAt = tokenExpiresAt instanceof Date
    ? tokenExpiresAt.getTime()
    : new Date(tokenExpiresAt).getTime();
  return expiresAt < (Date.now() + TOKEN_EXPIRY_BUFFER_MS);
}

// ---------------------------------------------------------------------------
// DB Row Types (internal)
// ---------------------------------------------------------------------------

type ToolProviderRow = {
  provider: RecordId<"credential_provider", string>;
};

type ProviderRow = {
  id: RecordId<"credential_provider", string>;
  auth_method: AuthMethod;
  api_key_header?: string;
  token_url?: string;
  client_id?: string;
  client_secret_encrypted?: string;
};

type AccountRow = {
  id: RecordId<"connected_account", string>;
  status: string;
  api_key_encrypted?: string;
  bearer_token_encrypted?: string;
  basic_username?: string;
  basic_password_encrypted?: string;
  access_token_encrypted?: string;
  refresh_token_encrypted?: string;
  token_expires_at?: string | Date;
};

// ---------------------------------------------------------------------------
// Effect Shell: resolveCredentialsForTool
// ---------------------------------------------------------------------------

/**
 * Resolve credentials for an integration tool call.
 *
 * Resolution chain:
 *   1. Look up mcp_tool by name -> get provider reference
 *   2. Load credential_provider record -> get auth_method + config
 *   3. Find connected_account for identity + provider (status=active)
 *   4. Decrypt credential fields
 *   5. Build auth headers based on auth_method
 *
 * Handles: missing account, revoked account, expired OAuth2 tokens.
 */
export async function resolveCredentialsForTool(
  toolName: string,
  identityId: string,
  deps: CredentialResolverDeps,
): Promise<CredentialResult> {
  const { surreal, toolEncryptionKey } = deps;
  const identityRecord = new RecordId("identity", identityId);

  // Step 1: Find the tool's provider reference
  const toolResults = await surreal.query<[ToolProviderRow[]]>(
    `SELECT provider FROM mcp_tool WHERE name = $name AND provider != NONE LIMIT 1;`,
    { name: toolName },
  );

  const toolRow = (toolResults[0] ?? [])[0];
  if (!toolRow?.provider) {
    return { ok: false, error: "Tool has no credential provider configured" };
  }

  const providerRecord = toolRow.provider;

  // Step 2: Load the credential provider
  const providerResults = await surreal.query<[ProviderRow[]]>(
    `SELECT id, auth_method, api_key_header, token_url, client_id, client_secret_encrypted FROM $provider;`,
    { provider: providerRecord },
  );

  const provider = (providerResults[0] ?? [])[0];
  if (!provider) {
    return { ok: false, error: "Credential provider not found" };
  }

  // Step 3: Find the connected account for this identity + provider
  const accountResults = await surreal.query<[AccountRow[]]>(
    `SELECT * FROM connected_account WHERE identity = $identity AND provider = $provider LIMIT 1;`,
    { identity: identityRecord, provider: providerRecord },
  );

  const account = (accountResults[0] ?? [])[0];
  if (!account) {
    return { ok: false, error: "Provider account not connected" };
  }

  if (account.status === "revoked") {
    return { ok: false, error: "Provider account disconnected" };
  }

  if (account.status === "expired") {
    return { ok: false, error: "Provider credentials expired, please reconnect" };
  }

  // Step 4: Handle OAuth2 token refresh if expired
  if (provider.auth_method === "oauth2" && isTokenExpired(account.token_expires_at)) {
    const refreshResult = await refreshOAuth2Token(account, provider, deps);
    if (!refreshResult.ok) {
      return refreshResult;
    }
    // Use the refreshed token
    return { ok: true, headers: { Authorization: `Bearer ${refreshResult.accessToken}` } };
  }

  // Step 5: Decrypt and build auth headers
  const decrypted = decryptAccountCredentials(account, provider, toolEncryptionKey);
  return buildAuthHeaders(decrypted);
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function isTokenExpired(tokenExpiresAt?: string | Date): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAt = tokenExpiresAt instanceof Date
    ? tokenExpiresAt.getTime()
    : new Date(tokenExpiresAt).getTime();
  return expiresAt < Date.now();
}

function decryptAccountCredentials(
  account: AccountRow,
  provider: ProviderRow,
  encryptionKey: string,
): DecryptedCredentials {
  return {
    authMethod: provider.auth_method,
    apiKey: account.api_key_encrypted
      ? decryptSecret(account.api_key_encrypted, encryptionKey)
      : undefined,
    apiKeyHeader: provider.api_key_header,
    bearerToken: account.bearer_token_encrypted
      ? decryptSecret(account.bearer_token_encrypted, encryptionKey)
      : undefined,
    basicUsername: account.basic_username,
    basicPassword: account.basic_password_encrypted
      ? decryptSecret(account.basic_password_encrypted, encryptionKey)
      : undefined,
    accessToken: account.access_token_encrypted
      ? decryptSecret(account.access_token_encrypted, encryptionKey)
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// OAuth2 Token Refresh
// ---------------------------------------------------------------------------

type RefreshSuccess = { ok: true; accessToken: string };
type RefreshError = { ok: false; error: string };

async function refreshOAuth2Token(
  account: AccountRow,
  provider: ProviderRow,
  deps: CredentialResolverDeps,
): Promise<RefreshSuccess | RefreshError> {
  const { surreal, toolEncryptionKey } = deps;

  if (!account.refresh_token_encrypted || !provider.token_url) {
    // Mark account as expired
    await surreal.query(`UPDATE $acct SET status = 'expired', updated_at = time::now();`, {
      acct: account.id,
    });
    return { ok: false, error: "Provider credentials expired, please reconnect" };
  }

  const refreshToken = decryptSecret(account.refresh_token_encrypted, toolEncryptionKey);

  try {
    const tokenResponse = await fetch(provider.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: provider.client_id ?? "",
        ...(provider.client_secret_encrypted
          ? { client_secret: decryptSecret(provider.client_secret_encrypted, toolEncryptionKey) }
          : {}),
      }),
    });

    if (!tokenResponse.ok) {
      // Refresh failed -- mark account as expired
      await surreal.query(`UPDATE $acct SET status = 'expired', updated_at = time::now();`, {
        acct: account.id,
      });
      return { ok: false, error: "Provider credentials expired, please reconnect" };
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
    };

    // Encrypt new tokens and update the account
    const newAccessTokenEncrypted = encryptSecretForUpdate(tokenData.access_token, toolEncryptionKey);
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : undefined;

    const updateParts = [
      `access_token_encrypted = $newToken`,
      `updated_at = time::now()`,
    ];
    const bindings: Record<string, unknown> = {
      acct: account.id,
      newToken: newAccessTokenEncrypted,
    };

    if (expiresAt) {
      updateParts.push(`token_expires_at = $expiresAt`);
      bindings.expiresAt = expiresAt;
    }

    if (tokenData.refresh_token) {
      const newRefreshEncrypted = encryptSecretForUpdate(tokenData.refresh_token, toolEncryptionKey);
      updateParts.push(`refresh_token_encrypted = $newRefresh`);
      bindings.newRefresh = newRefreshEncrypted;
    }

    await surreal.query(`UPDATE $acct SET ${updateParts.join(", ")};`, bindings);

    return { ok: true, accessToken: tokenData.access_token };
  } catch {
    // Network error during refresh -- mark as expired
    await surreal.query(`UPDATE $acct SET status = 'expired', updated_at = time::now();`, {
      acct: account.id,
    });
    return { ok: false, error: "Provider credentials expired, please reconnect" };
  }
}

/** Alias for the existing refreshOAuth2Token path that uses the top-level import. */
const encryptSecretForUpdate = encryptSecret;
