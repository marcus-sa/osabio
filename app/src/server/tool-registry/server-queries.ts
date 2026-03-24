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
  readonly status: string;
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
    `SELECT id FROM mcp_server WHERE workspace = $ws AND name = $name AND status = "active" LIMIT 1;`,
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
    status: "active",
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
    `SELECT * FROM mcp_server WHERE workspace = $ws AND status = "active" ORDER BY created_at DESC;`,
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
 * Soft-delete an mcp_server: set status to "disabled" and disable all linked tools.
 * Preserves the server record, tool records, can_use grants, and governs_tool edges
 * so they can be re-enabled if the server is re-added.
 *
 * Returns true if the server existed and was disabled.
 */
export async function disableMcpServer(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<boolean> {
  const existing = await getMcpServerById(surreal, serverRecord, workspaceRecord);
  if (!existing) {
    return false;
  }

  await surreal.query(
    `UPDATE $server SET status = "disabled";
     UPDATE mcp_tool SET status = "disabled" WHERE source_server = $server;`,
    { server: serverRecord },
  );

  return true;
}

/**
 * Find a disabled mcp_server with the same URL in the workspace.
 * Used during server creation to re-enable a previously disabled server.
 */
export async function findDisabledServerByUrl(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  url: string,
): Promise<McpServerRow | undefined> {
  const results = await surreal.query<[McpServerRow[]]>(
    `SELECT * FROM mcp_server WHERE workspace = $ws AND url = $url AND status = "disabled" LIMIT 1;`,
    { ws: workspaceRecord, url },
  );
  return (results[0] ?? [])[0];
}

/**
 * Re-enable a previously disabled mcp_server.
 * Updates the server's name, transport, auth config, and sets status back to "active".
 * Does NOT re-enable tools — that happens via discovery/sync.
 */
export async function reEnableMcpServer(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  input: {
    name: string;
    transport: string;
    authMode?: string;
    staticHeaders?: Array<{ name: string; value_encrypted: string }>;
    providerRecord?: RecordId<"credential_provider", string>;
  },
): Promise<McpServerRow> {
  const content: Record<string, unknown> = {
    status: "active",
    name: input.name,
    transport: input.transport,
    auth_mode: input.authMode ?? "none",
  };

  if (input.providerRecord) {
    content.provider = input.providerRecord;
  }

  if (input.staticHeaders && input.staticHeaders.length > 0) {
    content.static_headers = input.staticHeaders;
  }

  const results = await surreal.query<[McpServerRow[]]>(
    `UPDATE $server MERGE $content RETURN AFTER;`,
    { server: serverRecord, content },
  );

  return (results[0] ?? [])[0]!;
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

/**
 * Find an mcp_server by its pending OAuth state parameter.
 * Returns the server row with pending_pkce_verifier, or undefined if not found.
 */
export async function findServerByPendingState(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  state: string,
): Promise<(McpServerRow & { pending_pkce_verifier?: string; pending_oauth_state?: string }) | undefined> {
  const results = await surreal.query<[(McpServerRow & { pending_pkce_verifier?: string; pending_oauth_state?: string })[]]>(
    `SELECT * FROM mcp_server WHERE workspace = $ws AND pending_oauth_state = $state LIMIT 1;`,
    { ws: workspaceRecord, state },
  );
  return (results[0] ?? [])[0];
}

/**
 * Find the owner identity for a workspace via member_of relation.
 * Returns the identity RecordId, or undefined if no owner found.
 */
export async function findWorkspaceOwnerIdentity(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<RecordId<"identity", string> | undefined> {
  const results = await surreal.query<[Array<RecordId<"identity", string>>]>(
    "SELECT VALUE `in` FROM member_of WHERE out = $ws LIMIT 1;",
    { ws: workspaceRecord },
  );
  return (results[0] ?? [])[0];
}

/**
 * Link an mcp_server to a connected_account and set auth_mode to "oauth".
 * Called after successful OAuth token exchange.
 */
export async function updateMcpServerOAuthAccount(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  accountRecord: RecordId<"connected_account", string>,
): Promise<void> {
  await surreal.query(
    `UPDATE $server SET oauth_account = $account, auth_mode = "oauth";`,
    { server: serverRecord, account: accountRecord },
  );
}

/**
 * Update last_status on an mcp_server record.
 * Used to surface auth_error when token refresh fails.
 */
export async function updateMcpServerStatus(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  lastStatus: string,
  lastError?: string,
): Promise<void> {
  await surreal.query(
    lastError
      ? `UPDATE $server SET last_status = $status, last_error = $error;`
      : `UPDATE $server SET last_status = $status, last_error = NONE;`,
    { server: serverRecord, status: lastStatus, ...(lastError ? { error: lastError } : {}) },
  );
}

/**
 * Auth status for an MCP server's OAuth connection.
 */
export type McpServerAuthStatusResult = {
  auth_status: "connected" | "expired" | "error" | "not_authorized" | "none";
};

/**
 * Determine the auth status for an MCP server.
 *
 * - "connected": has oauth_account with active status
 * - "expired": has oauth_account but status is expired
 * - "error": last_status is auth_error
 * - "not_authorized": auth_mode is oauth but no oauth_account
 * - "none": auth_mode is not oauth
 */
export async function getMcpServerAuthStatus(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<McpServerAuthStatusResult | undefined> {
  const server = await getMcpServerById(surreal, serverRecord, workspaceRecord);
  if (!server) return undefined;

  if (server.auth_mode !== "oauth") {
    return { auth_status: "none" };
  }

  if (!server.oauth_account) {
    return { auth_status: "not_authorized" };
  }

  // Check the connected_account status first -- it takes priority over last_status
  const [accountRows] = await surreal.query<[Array<{ status: string }>]>(
    `SELECT status FROM $acct;`,
    { acct: server.oauth_account },
  );
  const account = (accountRows ?? [])[0];

  if (!account) {
    return { auth_status: "not_authorized" };
  }

  if (account.status === "expired") {
    return { auth_status: "expired" };
  }

  if (account.status === "active") {
    return { auth_status: "connected" };
  }

  // Fallback: last_status = auth_error or other non-active/non-expired states
  if (server.last_status === "auth_error") {
    return { auth_status: "error" };
  }

  return { auth_status: "error" };
}

/**
 * Clear pending PKCE verifier and OAuth state from an mcp_server record
 * after successful token exchange.
 */
export async function clearPendingOAuthState(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
): Promise<void> {
  await surreal.query(
    `UPDATE $server SET pending_pkce_verifier = NONE, pending_oauth_state = NONE;`,
    { server: serverRecord },
  );
}
