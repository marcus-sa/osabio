/**
 * SurrealDB queries for mcp_server CRUD.
 */
import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type McpServerRow = {
  readonly id: RecordId<"mcp_server", string>;
  readonly name: string;
  readonly url: string;
  readonly transport: string;
  readonly workspace: RecordId<"workspace", string>;
  readonly auth_mode: string;
  readonly provider?: RecordId<"credential_provider", string>;
  readonly static_headers?: Array<{ name: string; value_encrypted: string }>;
  readonly oauth_account?: RecordId<"connected_account", string>;
  readonly last_status?: string;
  readonly last_error?: string;
  readonly server_info?: Record<string, unknown>;
  readonly capabilities?: Record<string, unknown>;
  readonly last_discovery?: Date | string;
  readonly tool_count: number;
  readonly created_at: Date | string;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Check if an mcp_server with the given name already exists in the workspace.
 */
export async function serverNameExists(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  name: string,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM mcp_server WHERE workspace = $ws AND name = $name LIMIT 1;`,
    { ws: workspaceRecord, name },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Create an mcp_server record.
 */
export async function createMcpServer(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  input: {
    name: string;
    url: string;
    transport: string;
    authMode?: string;
    staticHeaders?: Array<{ name: string; value_encrypted: string }>;
    providerRecord?: RecordId<"credential_provider", string>;
  },
): Promise<McpServerRow> {
  const serverId = crypto.randomUUID();
  const serverRecord = new RecordId("mcp_server", serverId);

  const content: Record<string, unknown> = {
    name: input.name,
    url: input.url,
    transport: input.transport,
    auth_mode: input.authMode ?? "none",
    workspace: workspaceRecord,
    tool_count: 0,
    created_at: new Date(),
  };

  if (input.providerRecord) {
    content.provider = input.providerRecord;
  }

  if (input.staticHeaders && input.staticHeaders.length > 0) {
    content.static_headers = input.staticHeaders;
  }

  await surreal.query(`CREATE $server CONTENT $content;`, {
    server: serverRecord,
    content,
  });

  return {
    id: serverRecord,
    ...content,
  } as unknown as McpServerRow;
}

/**
 * List all mcp_servers in a workspace.
 */
export async function listMcpServers(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<McpServerRow[]> {
  const results = await surreal.query<[McpServerRow[]]>(
    `SELECT * FROM mcp_server WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  );
  return results[0] ?? [];
}

/**
 * Get a single mcp_server by ID, scoped to workspace.
 */
export async function getMcpServerById(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<McpServerRow | undefined> {
  const results = await surreal.query<[McpServerRow[]]>(
    `SELECT * FROM $server WHERE workspace = $ws;`,
    { server: serverRecord, ws: workspaceRecord },
  );
  return (results[0] ?? [])[0];
}

/**
 * Replace all static headers on an mcp_server and set auth_mode to "static_headers".
 * Returns the updated row, or undefined if the server was not found in the workspace.
 */
export async function updateMcpServerHeaders(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  workspaceRecord: RecordId<"workspace", string>,
  encryptedHeaders: Array<{ name: string; value_encrypted: string }>,
): Promise<McpServerRow | undefined> {
  const existing = await getMcpServerById(surreal, serverRecord, workspaceRecord);
  if (!existing) {
    return undefined;
  }

  await surreal.query(
    `UPDATE $server SET static_headers = $headers, auth_mode = "static_headers";`,
    { server: serverRecord, headers: encryptedHeaders },
  );

  return getMcpServerById(surreal, serverRecord, workspaceRecord);
}

/**
 * Clear all static headers on an mcp_server and reset auth_mode to "none".
 * Returns the updated row, or undefined if the server was not found in the workspace.
 */
export async function clearMcpServerHeaders(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<McpServerRow | undefined> {
  const existing = await getMcpServerById(surreal, serverRecord, workspaceRecord);
  if (!existing) {
    return undefined;
  }

  await surreal.query(
    `UPDATE $server SET static_headers = NONE, auth_mode = "none";`,
    { server: serverRecord },
  );

  return getMcpServerById(surreal, serverRecord, workspaceRecord);
}

/**
 * Link an mcp_server to a credential_provider and set auth_mode to "oauth".
 */
export async function updateMcpServerProvider(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  providerRecord: RecordId<"credential_provider", string>,
): Promise<void> {
  await surreal.query(
    `UPDATE $server SET provider = $provider, auth_mode = "oauth";`,
    { server: serverRecord, provider: providerRecord },
  );
}

/**
 * Delete an mcp_server and disable all tools linked via source_server.
 * Returns true if the server existed and was deleted.
 */
export async function deleteMcpServer(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<boolean> {
  // Check existence first (workspace-scoped)
  const existing = await getMcpServerById(surreal, serverRecord, workspaceRecord);
  if (!existing) {
    return false;
  }

  // Disable all tools linked to this server, then delete the server
  await surreal.query(
    `UPDATE mcp_tool SET status = "disabled" WHERE source_server = $server;
     DELETE $server;`,
    { server: serverRecord },
  );

  return true;
}

/**
 * Store pending PKCE verifier and OAuth state on an mcp_server record.
 * These are ephemeral -- cleared after token exchange.
 */
export async function storePendingOAuthState(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  codeVerifier: string,
  state: string,
): Promise<void> {
  await surreal.query(
    `UPDATE $server SET pending_pkce_verifier = $verifier, pending_oauth_state = $state;`,
    { server: serverRecord, verifier: codeVerifier, state },
  );
}
