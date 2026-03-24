/**
 * HTTP routes for MCP server management.
 *
 * POST   /api/workspaces/:wsId/mcp-servers              (register server)
 * GET    /api/workspaces/:wsId/mcp-servers               (list servers)
 * GET    /api/workspaces/:wsId/mcp-servers/:serverId     (server detail)
 * DELETE /api/workspaces/:wsId/mcp-servers/:serverId     (remove server)
 * POST   /api/workspaces/:wsId/mcp-servers/:serverId/discover  (dry-run discovery)
 * POST   /api/workspaces/:wsId/mcp-servers/:serverId/sync      (apply sync)
 */
import { RecordId } from "surrealdb";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  validateMcpServerUrl,
  validateMcpServerTransport,
} from "./server-validation";
import {
  serverNameExists,
  createMcpServer,
  listMcpServers,
  getMcpServerById,
  disableMcpServer,
  findDisabledServerByUrl,
  reEnableMcpServer,
  updateMcpServerHeaders,
  clearMcpServerHeaders,
  updateMcpServerProvider,
  storePendingOAuthState,
  findServerByPendingState,
  clearPendingOAuthState,
  updateMcpServerOAuthAccount,
  findWorkspaceOwnerIdentity,
  getMcpServerAuthStatus,
  updateMcpServerStatus,
  type McpServerRow,
} from "./server-queries";
import {
  getProviderById,
  createProvider,
  findProviderByDiscoverySource,
  createConnectedAccount,
  updateProviderClientRegistration,
} from "./queries";
import { encryptSecret, decryptSecret } from "./encryption";
import { discoverTools } from "./discovery";
import {
  discoverMcpServerOAuth,
  registerOAuthClient,
  startOAuthAuthorization,
  exchangeOAuthCode,
} from "./mcp-oauth";
import type { McpServerRecord, EncryptedHeaderEntry, DiscoverAuthResponse } from "./types";
import { encryptHeaders, validateHeaders } from "./static-headers";
import { log } from "../telemetry/logger";

const VALID_AUTH_MODES: ReadonlySet<string> = new Set(["none", "static_headers", "oauth", "provider"]);

// ---------------------------------------------------------------------------
// Response mapping -- DB record to API shape
// ---------------------------------------------------------------------------

type McpServerResponse = {
  id: string;
  name: string;
  url: string;
  transport: string;
  status: string;
  auth_mode: string;
  has_static_headers: boolean;
  tool_count: number;
  last_status?: string;
  last_error?: string;
  last_discovery?: string;
  provider_id?: string;
  provider_name?: string;
  created_at: string;
};

function toMcpServerResponse(
  row: McpServerRow,
  providerName?: string,
): McpServerResponse {
  const response: McpServerResponse = {
    id: row.id.id as string,
    name: row.name,
    url: row.url,
    transport: row.transport,
    status: row.status ?? "active",
    auth_mode: row.auth_mode ?? "none",
    has_static_headers: Array.isArray(row.static_headers) && row.static_headers.length > 0,
    tool_count: row.tool_count,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };

  if (row.last_status) {
    response.last_status = row.last_status;
  }
  if (row.last_error) {
    response.last_error = row.last_error;
  }
  if (row.last_discovery) {
    response.last_discovery = row.last_discovery instanceof Date
      ? row.last_discovery.toISOString()
      : String(row.last_discovery);
  }
  if (row.provider) {
    response.provider_id = row.provider.id as string;
    if (providerName) {
      response.provider_name = providerName;
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

type CreateMcpServerInput = {
  name?: string;
  url?: string;
  transport?: string;
  provider_id?: string;
  auth_mode?: string;
  static_headers?: Array<{ name?: string; value?: string }>;
};

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export function createServerRouteHandlers(deps: ServerDependencies) {
  async function handleCreateServer(
    workspaceId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("mcp-server.create", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    let body: CreateMcpServerInput;
    try {
      body = await request.json() as CreateMcpServerInput;
    } catch {
      return jsonError("invalid JSON body", 400);
    }

    // Validate and trim name
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return jsonError("name is required", 400);
    }

    // Validate and normalize URL
    const urlValidation = validateMcpServerUrl(body.url ?? "");
    if (!urlValidation.ok) {
      return jsonError(urlValidation.error, 400);
    }
    const urlString = urlValidation.normalizedUrl;

    // Validate transport (default to streamable-http)
    const transport = body.transport ?? "streamable-http";
    const transportValidation = validateMcpServerTransport(transport);
    if (!transportValidation.ok) {
      return jsonError(transportValidation.error, 400);
    }

    // Validate provider link if specified
    let providerRecord: RecordId<"credential_provider", string> | undefined;
    let providerName: string | undefined;
    if (body.provider_id) {
      const provider = await getProviderById(deps.surreal, body.provider_id);
      if (!provider) {
        return jsonError("Credential provider not found", 404);
      }
      providerRecord = new RecordId("credential_provider", body.provider_id);
      providerName = (provider as unknown as { display_name?: string }).display_name;
    }

    // Validate auth_mode
    const authMode = body.auth_mode ?? "none";
    if (!VALID_AUTH_MODES.has(authMode)) {
      return jsonError(`Invalid auth_mode: must be one of none, static_headers, oauth, provider`, 400);
    }

    // Encrypt static headers if provided
    let encryptedHeaders: EncryptedHeaderEntry[] | undefined;
    if (authMode === "static_headers") {
      const encryptionKey = deps.config.toolEncryptionKey;
      if (!encryptionKey) {
        log.error("mcp-server.create", "TOOL_ENCRYPTION_KEY not configured", undefined, { workspaceId });
        return jsonError("Server encryption not configured", 500);
      }
      if (!Array.isArray(body.static_headers) || body.static_headers.length === 0) {
        return jsonError("static_headers required when auth_mode is static_headers", 400);
      }
      // Validate header entries before encryption
      for (const header of body.static_headers) {
        if (!header.name || !header.value) {
          return jsonError("Each static header must have name and value", 400);
        }
      }
      const headerValidation = validateHeaders(
        body.static_headers as Array<{ name: string; value: string }>,
      );
      if (!headerValidation.ok) {
        return jsonError(headerValidation.error, 400);
      }
      encryptedHeaders = encryptHeaders(
        body.static_headers as Array<{ name: string; value: string }>,
        encryptionKey,
      );
    }

    // Re-enable: check for a previously disabled server with the same URL.
    // This preserves existing tool records, grants, and governance edges.
    const disabledServer = await findDisabledServerByUrl(deps.surreal, workspaceRecord, urlString);
    if (disabledServer) {
      const row = await reEnableMcpServer(deps.surreal, disabledServer.id, {
        name: name,
        transport,
        authMode,
        staticHeaders: encryptedHeaders,
        providerRecord,
      });

      const response = toMcpServerResponse(row, providerName) as Record<string, unknown>;
      response.re_enabled = true;

      // Trigger sync to re-enable matching tools from the server
      if (authMode !== "oauth") {
        triggerAutoSync(row as unknown as McpServerRecord);
      }

      return jsonResponse(response, 200);
    }

    // Check duplicate name (only among active servers)
    const duplicate = await serverNameExists(deps.surreal, workspaceRecord, name);
    if (duplicate) {
      return jsonError(`MCP server "${name}" already exists in this workspace`, 409);
    }

    // OAuth pre-flight: probe the MCP server for OAuth metadata BEFORE creating
    // the server record. If the auth server doesn't support dynamic client
    // registration, fail early so the user can choose a different auth mode.
    if (authMode === "oauth") {
      const preFlightError = await checkOAuthViability(urlString);
      if (preFlightError) {
        return jsonError(
          `${preFlightError} Use "Static Headers" auth mode with an Authorization header instead.`,
          422,
        );
      }
    }

    // Create server
    const row = await createMcpServer(deps.surreal, workspaceRecord, {
      name: name,
      url: urlString,
      transport,
      authMode,
      staticHeaders: encryptedHeaders,
      providerRecord,
    });

    const response = toMcpServerResponse(row, providerName) as Record<string, unknown>;

    // OAuth auto-discovery: create/find provider, register as dynamic client,
    // then generate the authorization URL so the frontend can redirect.
    if (authMode === "oauth") {
      const authResult = await autoDiscoverAndAuthorize(row, workspaceRecord);
      if (authResult?.authorizationUrl) {
        response.authorization_url = authResult.authorizationUrl;
      }
    } else {
      // Non-OAuth servers can sync tools immediately after creation
      triggerAutoSync(row as unknown as McpServerRecord);
    }

    return jsonResponse(response, 201);
  }

  /**
   * Pre-flight check: can this MCP server's OAuth flow actually work?
   * Probes for OAuth metadata and checks if dynamic client registration
   * is available. Returns an error message if OAuth is not viable,
   * or undefined if it can proceed.
   */
  async function checkOAuthViability(mcpServerUrl: string): Promise<string | undefined> {
    try {
      const info = await discoverMcpServerOAuth(mcpServerUrl);
      if (!info) {
        return "No OAuth metadata found at this server URL.";
      }
      if (!info.authorizationServerMetadata?.registration_endpoint) {
        return "The authorization server does not support dynamic client registration.";
      }
      return undefined;
    } catch (error) {
      return `OAuth discovery failed: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }

  /**
   * Auto-discover OAuth metadata from an MCP server and generate an authorization URL.
   * Uses MCP SDK's built-in OAuth functions for discovery, DCR, and PKCE.
   *
   * Returns { authorizationUrl } on success, { error } when OAuth cannot proceed,
   * or undefined when discovery finds no OAuth metadata at all.
   */
  async function autoDiscoverAndAuthorize(
    server: McpServerRow,
    workspaceRecord: RecordId<"workspace", string>,
  ): Promise<{ authorizationUrl: string; error?: undefined } | { authorizationUrl?: undefined; error: string } | undefined> {
    try {
      const info = await discoverMcpServerOAuth(server.url);
      if (!info) return undefined;

      const metadata = info.authorizationServerMetadata;
      const authServerUrl = info.authorizationServerUrl;
      const scopesSupported = info.resourceMetadata?.scopes_supported;

      // Find or create credential_provider
      const existingProvider = await findProviderByDiscoverySource(
        deps.surreal,
        workspaceRecord,
        server.url,
      );
      const providerRecord = existingProvider ?? await createProvider(
        deps.surreal,
        workspaceRecord,
        {
          name: new URL(authServerUrl).hostname,
          display_name: new URL(authServerUrl).hostname,
          auth_method: "oauth2",
          authorization_url: metadata?.authorization_endpoint?.toString(),
          token_url: metadata?.token_endpoint?.toString(),
          discovery_source: server.url,
          auth_server_url: authServerUrl,
          ...(scopesSupported ? { scopes: scopesSupported } : {}),
        },
      );

      // Track client_id: from existing provider or dynamic registration
      let clientId: string | undefined = existingProvider?.client_id;
      let clientSecret: string | undefined;

      const wsId = workspaceRecord.id as string;
      const redirectUri = `${deps.config.baseUrl}/api/workspaces/${wsId}/mcp-servers/oauth/callback`;

      // Dynamic client registration (RFC 7591) — only for newly created providers
      if (metadata?.registration_endpoint && !existingProvider) {
        try {
          const registrationResult = await registerOAuthClient(
            authServerUrl,
            redirectUri,
            metadata,
          );

          clientId = registrationResult.clientId;
          clientSecret = registrationResult.clientSecret;

          const encryptionKey = deps.config.toolEncryptionKey;
          const clientSecretEncrypted = clientSecret && encryptionKey
            ? encryptSecret(clientSecret, encryptionKey)
            : undefined;

          await updateProviderClientRegistration(
            deps.surreal,
            providerRecord.id,
            registrationResult.clientId,
            clientSecretEncrypted,
            authServerUrl,
          );
        } catch (regError) {
          log.error("mcp-server.auto-discover", "Dynamic client registration failed", regError, {
            serverId: server.id.id as string,
          });
        }
      }

      // Link mcp_server to provider
      await updateMcpServerProvider(deps.surreal, server.id, providerRecord.id);

      if (!clientId) {
        log.error("mcp-server.auto-discover", "No client_id available — authorization server does not support dynamic client registration", undefined, {
          serverId: server.id.id as string,
          authServer: authServerUrl,
        });
        return { error: "The authorization server does not support dynamic client registration." };
      }

      // Generate PKCE + authorization URL via MCP SDK
      const clientInfo = { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) };
      const state = crypto.randomUUID();
      const scopes = existingProvider?.scopes ?? scopesSupported;

      const authStart = await startOAuthAuthorization(
        authServerUrl,
        clientInfo,
        redirectUri,
        {
          metadata,
          scope: scopes?.join(" "),
          state,
          resource: new URL(server.url),
        },
      );

      await storePendingOAuthState(deps.surreal, server.id, authStart.codeVerifier, state);

      return { authorizationUrl: authStart.authorizationUrl };
    } catch (error) {
      log.error("mcp-server.auto-discover", "OAuth auto-discovery failed", error, {
        serverId: server.id.id as string,
      });
      return { error: `OAuth discovery failed: ${error instanceof Error ? error.message : "unknown error"}` };
    }
  }

  async function handleListServers(
    workspaceId: string,
    _request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("mcp-server.list", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const rows = await listMcpServers(deps.surreal, workspaceRecord);
    const servers = rows.map((row) => toMcpServerResponse(row));
    return jsonResponse({ servers }, 200);
  }

  async function handleGetServerDetail(
    workspaceId: string,
    serverId: string,
    _request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("mcp-server.detail", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const serverRecord = new RecordId("mcp_server", serverId);
    const row = await getMcpServerById(deps.surreal, serverRecord, workspaceRecord);

    if (!row) {
      return jsonError("MCP server not found", 404);
    }

    return jsonResponse(toMcpServerResponse(row), 200);
  }

  async function handleDeleteServer(
    workspaceId: string,
    serverId: string,
    _request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("mcp-server.delete", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const serverRecord = new RecordId("mcp_server", serverId);
    const disabled = await disableMcpServer(deps.surreal, serverRecord, workspaceRecord);

    if (!disabled) {
      return jsonError("MCP server not found", 404);
    }

    return jsonResponse({ disabled: true }, 200);
  }

  /**
   * Resolve server record for discovery/sync operations.
   * Returns the server row or an error response.
   */
  async function resolveServer(
    workspaceId: string,
    serverId: string,
  ): Promise<{ server: McpServerRow } | { error: Response }> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return { error: jsonError(error.message, error.status) };
      }
      log.error("mcp-server.resolve", "Failed to resolve workspace", error, { workspaceId });
      return { error: jsonError("internal error", 500) };
    }

    const serverRecord = new RecordId("mcp_server", serverId);
    const row = await getMcpServerById(deps.surreal, serverRecord, workspaceRecord);

    if (!row) {
      return { error: jsonError("MCP server not found", 404) };
    }

    return { server: row };
  }

  async function handleDiscover(
    workspaceId: string,
    serverId: string,
    _request: Request,
  ): Promise<Response> {
    const resolved = await resolveServer(workspaceId, serverId);
    if ("error" in resolved) return resolved.error;

    const server = resolved.server as unknown as McpServerRecord;

    try {
      const result = await discoverTools(
        { surreal: deps.surreal, mcpClientFactory: deps.mcpClientFactory, toolEncryptionKey: deps.config.toolEncryptionKey },
        server,
        { dryRun: true },
      );

      return jsonResponse(result, 200);
    } catch (error) {
      const message = `Failed to connect to MCP server: ${error instanceof Error ? error.message : "unknown error"}`;
      log.error("mcp-server.discover", "Discovery failed", error, { serverId });
      await updateMcpServerStatus(deps.surreal, server.id, "error", message).catch(() => undefined);
      return jsonError(message, 502);
    }
  }

  async function handleSync(
    workspaceId: string,
    serverId: string,
    request: Request,
  ): Promise<Response> {
    const resolved = await resolveServer(workspaceId, serverId);
    if ("error" in resolved) return resolved.error;

    const server = resolved.server as unknown as McpServerRecord;

    let selectedTools: string[] | undefined;
    try {
      const body = await request.json() as { selected_tools?: string[] };
      selectedTools = body.selected_tools;
    } catch {
      // Empty body is valid -- sync all tools
    }

    try {
      const result = await discoverTools(
        { surreal: deps.surreal, mcpClientFactory: deps.mcpClientFactory, toolEncryptionKey: deps.config.toolEncryptionKey },
        server,
        { dryRun: false, selectedTools },
      );

      await updateMcpServerStatus(deps.surreal, server.id, "ok").catch(() => undefined);
      return jsonResponse(result, 200);
    } catch (error) {
      const message = `Failed to connect to MCP server: ${error instanceof Error ? error.message : "unknown error"}`;
      log.error("mcp-server.sync", "Sync failed", error, { serverId });
      await updateMcpServerStatus(deps.surreal, server.id, "error", message).catch(() => undefined);
      return jsonError(message, 502);
    }
  }

  async function handleUpdateHeaders(
    workspaceId: string,
    serverId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("mcp-server.update-headers", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    let body: { headers?: Array<{ name?: string; value?: string }> };
    try {
      body = await request.json() as { headers?: Array<{ name?: string; value?: string }> };
    } catch {
      return jsonError("invalid JSON body", 400);
    }

    if (!Array.isArray(body.headers)) {
      return jsonError("headers array is required", 400);
    }

    const serverRecord = new RecordId("mcp_server", serverId);

    // Empty headers array = clear all headers and reset auth_mode to "none"
    if (body.headers.length === 0) {
      const clearedRow = await clearMcpServerHeaders(
        deps.surreal,
        serverRecord,
        workspaceRecord,
      );

      if (!clearedRow) {
        return jsonError("MCP server not found", 404);
      }

      return jsonResponse(toMcpServerResponse(clearedRow), 200);
    }

    // Validate each header entry
    for (const header of body.headers) {
      if (!header.name || !header.value) {
        return jsonError("Each header must have name and value", 400);
      }
    }
    const headerValidation = validateHeaders(
      body.headers as Array<{ name: string; value: string }>,
    );
    if (!headerValidation.ok) {
      return jsonError(headerValidation.error, 400);
    }

    const encryptionKey = deps.config.toolEncryptionKey;
    if (!encryptionKey) {
      log.error("mcp-server.update-headers", "TOOL_ENCRYPTION_KEY not configured", undefined, { workspaceId });
      return jsonError("Server encryption not configured", 500);
    }

    const encryptedHeaders = encryptHeaders(
      body.headers as Array<{ name: string; value: string }>,
      encryptionKey,
    );

    const updatedRow = await updateMcpServerHeaders(
      deps.surreal,
      serverRecord,
      workspaceRecord,
      encryptedHeaders,
    );

    if (!updatedRow) {
      return jsonError("MCP server not found", 404);
    }

    return jsonResponse(toMcpServerResponse(updatedRow), 200);
  }

  async function handleDiscoverAuth(
    workspaceId: string,
    serverId: string,
    _request: Request,
  ): Promise<Response> {
    const resolved = await resolveServer(workspaceId, serverId);
    if ("error" in resolved) return resolved.error;

    const server = resolved.server;

    try {
      const info = await discoverMcpServerOAuth(server.url);

      if (!info) {
        const response: DiscoverAuthResponse = {
          discovered: false,
          error: "No OAuth metadata found at the MCP server URL",
        };
        return jsonResponse(response, 200);
      }

      const metadata = info.authorizationServerMetadata;
      const authServerUrl = info.authorizationServerUrl;
      const scopesSupported = info.resourceMetadata?.scopes_supported;

      // Find or create credential_provider from discovery (dedup by discovery_source)
      const authServerHostname = new URL(authServerUrl).hostname;
      const existingProvider = await findProviderByDiscoverySource(
        deps.surreal,
        server.workspace,
        server.url,
      );
      const providerRecord = existingProvider ?? await createProvider(
        deps.surreal,
        server.workspace,
        {
          name: authServerHostname,
          display_name: authServerHostname,
          auth_method: "oauth2",
          authorization_url: metadata?.authorization_endpoint?.toString(),
          token_url: metadata?.token_endpoint?.toString(),
          discovery_source: server.url,
          auth_server_url: authServerUrl,
          ...(scopesSupported ? { scopes: scopesSupported } : {}),
        },
      );

      // Dynamic client registration (RFC 7591) — only for newly created providers
      if (metadata?.registration_endpoint && !existingProvider) {
        try {
          const redirectUri = `${deps.config.baseUrl}/api/workspaces/${workspaceId}/mcp-servers/oauth/callback`;
          const registrationResult = await registerOAuthClient(
            authServerUrl,
            redirectUri,
            metadata,
          );

          const encryptionKey = deps.config.toolEncryptionKey;
          const clientSecretEncrypted = registrationResult.clientSecret && encryptionKey
            ? encryptSecret(registrationResult.clientSecret, encryptionKey)
            : undefined;

          await updateProviderClientRegistration(
            deps.surreal,
            providerRecord.id,
            registrationResult.clientId,
            clientSecretEncrypted,
            authServerUrl,
          );
        } catch (regError) {
          log.error("mcp-server.discover-auth", "Dynamic client registration failed", regError, { serverId: server.id.id as string });
          // Non-fatal: proceed without dynamic registration
        }
      }

      // Link mcp_server to the new provider
      await updateMcpServerProvider(
        deps.surreal,
        server.id,
        providerRecord.id,
      );

      const response: DiscoverAuthResponse = {
        discovered: true,
        auth_server: authServerUrl,
        authorization_endpoint: metadata?.authorization_endpoint?.toString() ?? "",
        token_endpoint: metadata?.token_endpoint?.toString() ?? "",
        scopes_supported: scopesSupported,
        supports_dynamic_registration: metadata?.registration_endpoint !== undefined,
        provider_id: providerRecord.id.id as string,
      };

      return jsonResponse(response, 200);
    } catch (error) {
      log.error("mcp-server.discover-auth", "OAuth discovery failed", error, { serverId });
      return jsonError(
        `OAuth discovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
        502,
      );
    }
  }

  async function handleAuthorize(
    workspaceId: string,
    serverId: string,
    _request: Request,
  ): Promise<Response> {
    const resolved = await resolveServer(workspaceId, serverId);
    if ("error" in resolved) return resolved.error;

    const server = resolved.server;

    // Server must have a linked credential_provider (from discover-auth)
    if (!server.provider) {
      return jsonError("MCP server has no linked credential provider. Run discover-auth first.", 400);
    }

    const provider = await getProviderById(deps.surreal, server.provider.id as string);
    if (!provider) {
      return jsonError("Linked credential provider not found", 404);
    }

    const providerRecord = provider as unknown as {
      authorization_url?: string;
      client_id?: string;
      client_secret_encrypted?: string;
      scopes?: string[];
      auth_server_url?: string;
    };

    if (!providerRecord.authorization_url) {
      return jsonError("Provider missing authorization_url", 400);
    }

    const clientId = providerRecord.client_id;
    if (!clientId) {
      return jsonError(
        "Provider has no client_id. The authorization server may not support dynamic client registration. Use static_headers auth mode with a pre-issued token instead.",
        400,
      );
    }

    // Decrypt client_secret if available (confidential clients from DCR)
    const encryptionKey = deps.config.toolEncryptionKey;
    const clientSecret = providerRecord.client_secret_encrypted && encryptionKey
      ? decryptSecret(providerRecord.client_secret_encrypted, encryptionKey)
      : undefined;

    // Build the redirect_uri (Brain's OAuth callback)
    const redirectUri = `${deps.config.baseUrl}/api/workspaces/${workspaceId}/mcp-servers/oauth/callback`;

    // Resolve auth server URL (stored from discovery, or derive from authorization_url)
    const authServerUrl = providerRecord.auth_server_url ?? new URL(providerRecord.authorization_url).origin;

    // Generate PKCE + authorization URL via MCP SDK
    const clientInfo = { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) };
    const state = crypto.randomUUID();

    const authStart = await startOAuthAuthorization(
      authServerUrl,
      clientInfo,
      redirectUri,
      {
        scope: providerRecord.scopes?.join(" "),
        state,
        resource: new URL(server.url),
      },
    );

    // Store pending state on the mcp_server record
    await storePendingOAuthState(
      deps.surreal,
      server.id,
      authStart.codeVerifier,
      state,
    );

    return jsonResponse({ redirect_url: authStart.authorizationUrl, state }, 200);
  }

  async function handleOAuthCallback(
    workspaceId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("mcp-server.oauth-callback", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    // Parse code + state from query params (GET redirect from OAuth provider)
    // or request body (POST from frontend) for backwards compat
    let code: string | undefined;
    let state: string | undefined;

    const url = new URL(request.url);
    if (url.searchParams.has("code")) {
      code = url.searchParams.get("code") ?? undefined;
      state = url.searchParams.get("state") ?? undefined;
    } else {
      try {
        const body = await request.json() as { code?: string; state?: string };
        code = body.code;
        state = body.state;
      } catch {
        return jsonError("invalid request", 400);
      }
    }

    if (!code || typeof code !== "string") {
      return jsonError("code is required", 400);
    }
    if (!state || typeof state !== "string") {
      return jsonError("state is required", 400);
    }

    // Find the mcp_server that has this pending state
    const server = await findServerByPendingState(deps.surreal, workspaceRecord, state);
    if (!server) {
      return jsonError("No pending authorization found for the provided state", 404);
    }

    if (!server.pending_pkce_verifier) {
      return jsonError("Server missing PKCE code_verifier", 400);
    }

    // Load the linked credential_provider for token_endpoint
    if (!server.provider) {
      return jsonError("Server has no linked credential provider", 400);
    }

    const provider = await getProviderById(deps.surreal, server.provider.id as string);
    if (!provider) {
      return jsonError("Linked credential provider not found", 404);
    }

    const providerRecord = provider as unknown as {
      token_url?: string;
      client_id?: string;
      client_secret_encrypted?: string;
      auth_server_url?: string;
    };

    if (!providerRecord.token_url) {
      return jsonError("Provider missing token_url", 400);
    }

    const clientId = providerRecord.client_id;
    if (!clientId) {
      const msg = "Provider has no client_id configured";
      if (request.method === "GET") {
        return Response.redirect(
          `${deps.config.baseUrl}/tools?tab=servers&oauth=error`,
          302,
        );
      }
      return jsonError(msg, 400);
    }

    // Build redirect_uri (must match the one used during authorize)
    const redirectUri = `${deps.config.baseUrl}/api/workspaces/${workspaceId}/mcp-servers/oauth/callback`;

    try {
      const encryptionKey = deps.config.toolEncryptionKey;

      // Decrypt client_secret if the provider has one (confidential clients from DCR)
      const clientSecret = providerRecord.client_secret_encrypted && encryptionKey
        ? decryptSecret(providerRecord.client_secret_encrypted, encryptionKey)
        : undefined;

      // Resolve auth server URL
      const authServerUrl = providerRecord.auth_server_url ?? new URL(providerRecord.token_url).origin;

      // Build client info for the SDK
      const clientInfo = { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) };

      // Exchange the authorization code for tokens via MCP SDK
      // The SDK automatically selects the correct client auth method
      const tokens = await exchangeOAuthCode(
        authServerUrl,
        clientInfo,
        code,
        server.pending_pkce_verifier,
        redirectUri,
        { resource: new URL(server.url) },
      );

      // Store tokens — fail explicitly if preconditions are not met
      if (!encryptionKey) {
        throw new Error("TOOL_ENCRYPTION_KEY not configured, cannot store OAuth tokens");
      }

      const ownerIdentity = await findWorkspaceOwnerIdentity(deps.surreal, workspaceRecord);
      if (!ownerIdentity) {
        throw new Error("No workspace owner identity found, cannot store OAuth tokens");
      }

      const accountContent: Record<string, unknown> = {
        identity: ownerIdentity,
        provider: server.provider,
        workspace: workspaceRecord,
        status: "active",
        access_token_encrypted: encryptSecret(tokens.access_token, encryptionKey),
      };

      if (tokens.refresh_token) {
        accountContent.refresh_token_encrypted = encryptSecret(tokens.refresh_token, encryptionKey);
      }

      if (tokens.expires_in) {
        accountContent.token_expires_at = new Date(Date.now() + tokens.expires_in * 1000);
      }

      if (tokens.scope) {
        accountContent.scopes = tokens.scope.split(" ");
      }

      const account = await createConnectedAccount(deps.surreal, accountContent);
      await updateMcpServerOAuthAccount(deps.surreal, server.id, account.id);

      // Clear pending PKCE state and mark server as authenticated
      await clearPendingOAuthState(deps.surreal, server.id);
      await updateMcpServerStatus(deps.surreal, server.id, "ok");

      // Re-fetch server so oauth_account is populated
      const freshServer = await getMcpServerById(deps.surreal, server.id, workspaceRecord);
      if (freshServer) {
        triggerAutoSync(freshServer as unknown as McpServerRecord);
      }

      if (request.method === "GET") {
        return Response.redirect(
          `${deps.config.baseUrl}/tools?tab=servers&oauth=success`,
          302,
        );
      }
      return jsonResponse({ token_type: tokens.token_type, scope: tokens.scope }, 200);
    } catch (error) {
      log.error("mcp-server.oauth-callback", "Token exchange failed", error, { workspaceId });
      if (request.method === "GET") {
        return Response.redirect(
          `${deps.config.baseUrl}/tools?tab=servers&oauth=error`,
          302,
        );
      }
      return jsonError(
        `Token exchange failed: ${error instanceof Error ? error.message : "unknown error"}`,
        502,
      );
    }
  }

  async function handleGetAuthStatus(
    workspaceId: string,
    serverId: string,
    _request: Request,
  ): Promise<Response> {
    let workspaceRecord: RecordId<"workspace", string>;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("mcp-server.auth-status", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const serverRecord = new RecordId("mcp_server", serverId);
    const result = await getMcpServerAuthStatus(deps.surreal, serverRecord, workspaceRecord);

    if (!result) {
      return jsonError("MCP server not found", 404);
    }

    return jsonResponse(result, 200);
  }

  /**
   * Fire-and-forget tool sync after server creation or successful OAuth.
   * Errors are logged but never surface to the caller.
   */
  function triggerAutoSync(server: McpServerRecord): void {
    const work = discoverTools(
      { surreal: deps.surreal, mcpClientFactory: deps.mcpClientFactory, toolEncryptionKey: deps.config.toolEncryptionKey },
      server,
      { dryRun: false },
    ).then(() => {
      updateMcpServerStatus(deps.surreal, server.id, "ok").catch(() => undefined);
    }).catch((error) => {
      log.error("mcp-server.auto-sync", "Auto-sync failed", error, {
        serverId: server.id.id as string,
      });
    });

    deps.inflight.track(work);
  }

  return {
    handleCreateServer,
    handleListServers,
    handleGetServerDetail,
    handleDeleteServer,
    handleDiscover,
    handleDiscoverAuth,
    handleAuthorize,
    handleOAuthCallback,
    handleSync,
    handleUpdateHeaders,
    handleGetAuthStatus,
  };
}
