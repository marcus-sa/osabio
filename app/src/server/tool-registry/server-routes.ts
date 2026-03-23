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
  deleteMcpServer,
  type McpServerRow,
} from "./server-queries";
import { getProviderById } from "./queries";
import { discoverTools } from "./discovery";
import type { McpServerRecord, EncryptedHeaderEntry } from "./types";
import { encryptSecret } from "./encryption";
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

    // Validate name
    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return jsonError("name is required", 400);
    }

    // Validate URL
    const urlString = body.url ?? "";
    const urlValidation = validateMcpServerUrl(urlString);
    if (!urlValidation.ok) {
      return jsonError(urlValidation.error, 400);
    }

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
      encryptedHeaders = body.static_headers.map((header) => {
        if (!header.name || !header.value) {
          throw new HttpError(400, "Each static header must have name and value");
        }
        return {
          name: header.name,
          value_encrypted: encryptSecret(header.value, encryptionKey),
        };
      });
    }

    // Check duplicate name
    const duplicate = await serverNameExists(deps.surreal, workspaceRecord, body.name);
    if (duplicate) {
      return jsonError(`MCP server "${body.name}" already exists in this workspace`, 409);
    }

    // Create server
    const row = await createMcpServer(deps.surreal, workspaceRecord, {
      name: body.name,
      url: urlString,
      transport,
      authMode,
      staticHeaders: encryptedHeaders,
      providerRecord,
    });

    return jsonResponse(toMcpServerResponse(row, providerName), 201);
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
    const deleted = await deleteMcpServer(deps.surreal, serverRecord, workspaceRecord);

    if (!deleted) {
      return jsonError("MCP server not found", 404);
    }

    return jsonResponse({ deleted: true }, 200);
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
        { surreal: deps.surreal, mcpClientFactory: deps.mcpClientFactory },
        server,
        { dryRun: true },
      );

      return jsonResponse(result, 200);
    } catch (error) {
      log.error("mcp-server.discover", "Discovery failed", error, { serverId });
      return jsonError(
        `Failed to connect to MCP server: ${error instanceof Error ? error.message : "unknown error"}`,
        502,
      );
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
        { surreal: deps.surreal, mcpClientFactory: deps.mcpClientFactory },
        server,
        { dryRun: false, selectedTools },
      );

      return jsonResponse(result, 200);
    } catch (error) {
      log.error("mcp-server.sync", "Sync failed", error, { serverId });
      return jsonError(
        `Failed to connect to MCP server: ${error instanceof Error ? error.message : "unknown error"}`,
        502,
      );
    }
  }

  return {
    handleCreateServer,
    handleListServers,
    handleGetServerDetail,
    handleDeleteServer,
    handleDiscover,
    handleSync,
  };
}
