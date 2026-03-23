/**
 * Tool Registry UI Acceptance Test Kit
 *
 * Domain-specific helpers for testing the HTTP API endpoints that
 * the Tool Registry UI consumes. Extends the shared acceptance-test-kit
 * with business-language helpers for providers, accounts, tools,
 * grants, and governance.
 *
 * Driving ports:
 *   POST   /api/workspaces/:wsId/providers                        (create provider)
 *   GET    /api/workspaces/:wsId/providers                        (list providers)
 *   POST   /api/workspaces/:wsId/accounts/connect/:providerId     (connect account)
 *   GET    /api/workspaces/:wsId/accounts                         (list accounts)
 *   DELETE /api/workspaces/:wsId/accounts/:accountId              (revoke account)
 *   GET    /api/workspaces/:wsId/tools                            (list tools)
 *   GET    /api/workspaces/:wsId/tools/:toolId                    (tool detail)
 *   POST   /api/workspaces/:wsId/tools/:toolId/grants             (grant access)
 *   GET    /api/workspaces/:wsId/tools/:toolId/grants             (list grants)
 *   POST   /api/workspaces/:wsId/tools/:toolId/governance         (attach governance)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestUserWithMcp,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
  type TestUserWithMcp,
} from "../acceptance-test-kit";
import type { McpClientFactory, McpConnectionResult, ToolListResult, CallToolResult } from "../../../app/src/server/tool-registry/mcp-client";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  createWorkspaceDirectly,
  createIdentity,
} from "../shared-fixtures";

// Re-export shared helpers
export {
  setupAcceptanceSuite,
  createTestUser,
  createTestUserWithMcp,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
  type TestUserWithMcp,
};

export { createWorkspaceDirectly, createIdentity };

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

/**
 * Sets up a tool-registry-ui acceptance test suite with isolated server + DB.
 */
export function setupToolRegistrySuite(
  suiteName: string,
  options?: { mcpClientFactory?: McpClientFactory },
): () => AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName, {
    configOverrides: {
      toolEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    mcpClientFactoryOverride: options?.mcpClientFactory,
  });
}

// ---------------------------------------------------------------------------
// Mock MCP Client Factory
// ---------------------------------------------------------------------------

/** Configurable tool for mock MCP server. */
export type MockMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

/** Configurable tool call handler. */
export type MockToolCallHandler = (
  name: string,
  args: Record<string, unknown>,
) => CallToolResult;

/**
 * Create a mock McpClientFactory that simulates upstream MCP servers.
 *
 * The mock returns configured tools from listTools and dispatches callTool
 * to the provided handler (or returns a default success response).
 */
export function createMockMcpClientFactory(config: {
  tools: MockMcpTool[];
  onCallTool?: MockToolCallHandler;
  serverInfo?: { name: string; version: string };
}): McpClientFactory {
  const defaultHandler: MockToolCallHandler = (name, args) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ tool: name, result: "success", args }) }],
  });

  const handler = config.onCallTool ?? defaultHandler;
  const serverInfo = config.serverInfo ?? { name: "mock-mcp-server", version: "1.0.0" };

  // Track connections for disconnect verification
  const activeConnections = new Set<object>();

  return {
    connect: async (_url, _transport, _headers) => {
      const fakeClient = {} as Client;
      activeConnections.add(fakeClient);
      return {
        client: fakeClient,
        serverInfo,
        capabilities: { tools: { listChanged: true } },
      } as McpConnectionResult;
    },

    fetchToolList: async (_client) => {
      return {
        tools: config.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          annotations: t.annotations,
        })),
      } as ToolListResult;
    },

    callTool: async (_client, name, args) => {
      return handler(name, args);
    },

    disconnect: async (client) => {
      activeConnections.delete(client as object);
    },
  };
}

// ---------------------------------------------------------------------------
// Provider Helpers -- HTTP driving port
// ---------------------------------------------------------------------------

export type CreateProviderInput = {
  name: string;
  display_name: string;
  auth_method: "oauth2" | "api_key" | "bearer" | "basic";
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  api_key_header?: string;
};

/**
 * Register a credential provider via HTTP endpoint.
 */
export async function createProvider(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  input: CreateProviderInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/providers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(input),
    },
  );
}

/**
 * List credential providers via HTTP endpoint.
 */
export async function listProviders(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/providers`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

// ---------------------------------------------------------------------------
// Account Helpers -- HTTP driving port
// ---------------------------------------------------------------------------

export type ConnectAccountInput = {
  api_key?: string;
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
};

/**
 * Connect an account to a provider via HTTP endpoint.
 * For static credentials (api_key, bearer, basic): sends credentials in body.
 * For oauth2: returns redirect_url (no body needed).
 *
 * Route handler reads X-Brain-Identity from headers for identity resolution.
 */
export async function connectAccount(
  baseUrl: string,
  user: TestUserWithMcp,
  workspaceId: string,
  providerId: string,
  credentials?: ConnectAccountInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/accounts/connect/${providerId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Brain-Identity": user.identityId,
        ...user.headers,
      },
      body: JSON.stringify(credentials ?? {}),
    },
  );
}

/**
 * List connected accounts via HTTP endpoint.
 * Route handler reads X-Brain-Identity from headers for identity scoping.
 */
export async function listAccounts(
  baseUrl: string,
  user: TestUserWithMcp,
  workspaceId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/accounts`,
    {
      method: "GET",
      headers: {
        "X-Brain-Identity": user.identityId,
        ...user.headers,
      },
    },
  );
}

/**
 * Revoke a connected account via HTTP endpoint.
 * Route handler reads X-Brain-Identity from headers for ownership verification.
 */
export async function revokeAccount(
  baseUrl: string,
  user: TestUserWithMcp,
  workspaceId: string,
  accountId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/accounts/${accountId}`,
    {
      method: "DELETE",
      headers: {
        "X-Brain-Identity": user.identityId,
        ...user.headers,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Tool Helpers -- HTTP driving port (NEW endpoints, will 404 until implemented)
// ---------------------------------------------------------------------------

/**
 * List tools in workspace via HTTP endpoint.
 */
export async function listTools(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/tools`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

/**
 * Get tool detail via HTTP endpoint.
 */
export async function getToolDetail(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  toolId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

// ---------------------------------------------------------------------------
// Grant Helpers -- HTTP driving port (NEW endpoints)
// ---------------------------------------------------------------------------

export type GrantToolAccessInput = {
  identity_id: string;
  max_calls_per_hour?: number;
};

/**
 * Grant tool access to an identity via HTTP endpoint.
 */
export async function grantToolAccess(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  toolId: string,
  input: GrantToolAccessInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}/grants`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(input),
    },
  );
}

/**
 * List grants for a tool via HTTP endpoint.
 */
export async function listToolGrants(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  toolId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}/grants`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

// ---------------------------------------------------------------------------
// Governance Helpers -- HTTP driving port (NEW endpoints)
// ---------------------------------------------------------------------------

export type AttachGovernanceInput = {
  policy_id: string;
  conditions?: string;
  max_per_call?: number;
  max_per_day?: number;
};

/**
 * Attach governance policy to a tool via HTTP endpoint.
 */
export async function attachGovernance(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  toolId: string,
  input: AttachGovernanceInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}/governance`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(input),
    },
  );
}

// ---------------------------------------------------------------------------
// DB Seed Helpers -- for Given steps (test preconditions)
// ---------------------------------------------------------------------------

/**
 * Seed an mcp_tool record directly in SurrealDB for test preconditions.
 */
export async function seedTool(
  surreal: Surreal,
  workspaceId: string,
  options: {
    name: string;
    toolkit: string;
    description?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    status?: "active" | "disabled";
    providerId?: string;
    inputSchema?: Record<string, unknown>;
  },
): Promise<{ toolId: string }> {
  const toolId = `tool-${crypto.randomUUID()}`;
  const toolRecord = new RecordId("mcp_tool", toolId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    name: options.name,
    toolkit: options.toolkit,
    description: options.description ?? `${options.name} tool`,
    input_schema: options.inputSchema ?? { type: "object", properties: {} },
    risk_level: options.riskLevel ?? "medium",
    workspace: workspaceRecord,
    status: options.status ?? "active",
    created_at: new Date(),
  };

  if (options.providerId) {
    content.provider = new RecordId("credential_provider", options.providerId);
  }

  await surreal.query(`CREATE $tool CONTENT $content;`, {
    tool: toolRecord,
    content,
  });

  return { toolId };
}

/**
 * Seed a credential_provider directly in SurrealDB for test preconditions.
 */
export async function seedProvider(
  surreal: Surreal,
  workspaceId: string,
  options: {
    name: string;
    displayName: string;
    authMethod: "oauth2" | "api_key" | "bearer" | "basic";
    authorizationUrl?: string;
    tokenUrl?: string;
    clientId?: string;
    clientSecretEncrypted?: string;
    scopes?: string[];
    apiKeyHeader?: string;
  },
): Promise<{ providerId: string }> {
  const providerId = `prov-${crypto.randomUUID()}`;
  const providerRecord = new RecordId("credential_provider", providerId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    name: options.name,
    display_name: options.displayName,
    auth_method: options.authMethod,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (options.authorizationUrl) content.authorization_url = options.authorizationUrl;
  if (options.tokenUrl) content.token_url = options.tokenUrl;
  if (options.clientId) content.client_id = options.clientId;
  if (options.clientSecretEncrypted) content.client_secret_encrypted = options.clientSecretEncrypted;
  if (options.scopes) content.scopes = options.scopes;
  if (options.apiKeyHeader) content.api_key_header = options.apiKeyHeader;

  await surreal.query(`CREATE $provider CONTENT $content;`, {
    provider: providerRecord,
    content,
  });

  return { providerId };
}

/**
 * Seed a connected_account directly in SurrealDB for test preconditions.
 */
export async function seedAccount(
  surreal: Surreal,
  options: {
    identityId: string;
    providerId: string;
    workspaceId: string;
    status?: "active" | "revoked" | "expired";
    apiKeyEncrypted?: string;
    bearerTokenEncrypted?: string;
    basicUsername?: string;
    basicPasswordEncrypted?: string;
    accessTokenEncrypted?: string;
  },
): Promise<{ accountId: string }> {
  const accountId = `acct-${crypto.randomUUID()}`;
  const accountRecord = new RecordId("connected_account", accountId);
  const identityRecord = new RecordId("identity", options.identityId);
  const providerRecord = new RecordId("credential_provider", options.providerId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    identity: identityRecord,
    provider: providerRecord,
    workspace: workspaceRecord,
    status: options.status ?? "active",
    connected_at: new Date(),
    updated_at: new Date(),
  };

  if (options.apiKeyEncrypted) content.api_key_encrypted = options.apiKeyEncrypted;
  if (options.bearerTokenEncrypted) content.bearer_token_encrypted = options.bearerTokenEncrypted;
  if (options.basicUsername) content.basic_username = options.basicUsername;
  if (options.basicPasswordEncrypted) content.basic_password_encrypted = options.basicPasswordEncrypted;
  if (options.accessTokenEncrypted) content.access_token_encrypted = options.accessTokenEncrypted;

  await surreal.query(`CREATE $account CONTENT $content;`, {
    account: accountRecord,
    content,
  });

  return { accountId };
}

/**
 * Seed a can_use edge (grant) directly in SurrealDB for test preconditions.
 */
export async function seedGrant(
  surreal: Surreal,
  identityId: string,
  toolId: string,
  options?: { maxCallsPerHour?: number },
): Promise<void> {
  const identityRecord = new RecordId("identity", identityId);
  const toolRecord = new RecordId("mcp_tool", toolId);

  const setClause = options?.maxCallsPerHour
    ? `SET granted_at = time::now(), max_calls_per_hour = ${options.maxCallsPerHour}`
    : `SET granted_at = time::now()`;

  await surreal.query(
    `RELATE $identity->can_use->$tool ${setClause};`,
    { identity: identityRecord, tool: toolRecord },
  );
}

/**
 * Seed a policy record for governance test preconditions.
 */
export async function seedPolicy(
  surreal: Surreal,
  workspaceId: string,
  options: {
    title: string;
    status?: "active" | "draft" | "deprecated";
    identityId?: string;
  },
): Promise<{ policyId: string }> {
  const policyId = `policy-${crypto.randomUUID()}`;
  const policyRecord = new RecordId("policy", policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const createdByRecord = new RecordId(
    "identity",
    options.identityId ?? `id-${crypto.randomUUID()}`,
  );

  // Ensure identity exists for created_by reference
  if (!options.identityId) {
    await surreal.query(`CREATE $identity CONTENT $content;`, {
      identity: createdByRecord,
      content: {
        name: "Policy Author",
        type: "human",
        identity_status: "active",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });
  }

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: options.title,
      description: `Governance policy: ${options.title}`,
      status: options.status ?? "active",
      version: 1,
      workspace: workspaceRecord,
      created_by: createdByRecord,
      selector: {},
      rules: [],
      created_at: new Date(),
    },
  });

  return { policyId };
}

// ---------------------------------------------------------------------------
// MCP Server Helpers -- HTTP driving port (NEW endpoints)
// ---------------------------------------------------------------------------

export type AddMcpServerInput = {
  name: string;
  url: string;
  transport?: "sse" | "streamable-http";
  provider_id?: string;
};

/**
 * Register an MCP server in the workspace via HTTP endpoint.
 */
export async function addMcpServer(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  input: AddMcpServerInput,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(input),
    },
  );
}

/**
 * List MCP servers in the workspace via HTTP endpoint.
 */
export async function listMcpServers(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

/**
 * Get MCP server detail via HTTP endpoint.
 */
export async function getMcpServerDetail(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  serverId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/${serverId}`,
    {
      method: "GET",
      headers: user.headers,
    },
  );
}

/**
 * Remove an MCP server via HTTP endpoint.
 */
export async function removeMcpServer(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  serverId: string,
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/${serverId}`,
    {
      method: "DELETE",
      headers: user.headers,
    },
  );
}

/**
 * Trigger tool discovery on an MCP server (dry run or apply).
 */
export async function discoverTools(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  serverId: string,
  options?: { dryRun?: boolean },
): Promise<Response> {
  const dryRun = options?.dryRun ?? true;
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/${serverId}/discover?dry_run=${dryRun}`,
    {
      method: "POST",
      headers: user.headers,
    },
  );
}

/**
 * Apply discovery results (sync) to an MCP server.
 */
export async function syncServerTools(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  serverId: string,
  selectedTools?: string[],
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/${serverId}/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(selectedTools ? { selected_tools: selectedTools } : {}),
    },
  );
}

// ---------------------------------------------------------------------------
// MCP Server DB Seed Helpers -- for Given steps (test preconditions)
// ---------------------------------------------------------------------------

/**
 * Seed an mcp_server record directly in SurrealDB for test preconditions.
 */
export async function seedMcpServer(
  surreal: Surreal,
  workspaceId: string,
  options: {
    name: string;
    url: string;
    transport?: "sse" | "streamable-http";
    lastStatus?: "ok" | "error";
    providerId?: string;
    toolCount?: number;
    lastDiscovery?: Date;
    lastError?: string;
  },
): Promise<{ serverId: string }> {
  const serverId = `srv-${crypto.randomUUID()}`;
  const serverRecord = new RecordId("mcp_server", serverId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    name: options.name,
    url: options.url,
    transport: options.transport ?? "streamable-http",
    workspace: workspaceRecord,
    last_status: options.lastStatus ?? "ok",
    tool_count: options.toolCount ?? 0,
    created_at: new Date(),
  };

  if (options.providerId) {
    content.provider = new RecordId("credential_provider", options.providerId);
  }
  if (options.lastDiscovery) {
    content.last_discovery = options.lastDiscovery;
  }
  if (options.lastError) {
    content.last_error = options.lastError;
  }

  await surreal.query(`CREATE $server CONTENT $content;`, {
    server: serverRecord,
    content,
  });

  return { serverId };
}

/**
 * Seed an mcp_tool with a source_server link for discovered tool preconditions.
 */
export async function seedDiscoveredTool(
  surreal: Surreal,
  workspaceId: string,
  serverId: string,
  options: {
    name: string;
    toolkit: string;
    description?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    status?: "active" | "disabled";
    providerId?: string;
    inputSchema?: Record<string, unknown>;
  },
): Promise<{ toolId: string }> {
  const toolId = `tool-${crypto.randomUUID()}`;
  const toolRecord = new RecordId("mcp_tool", toolId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const serverRecord = new RecordId("mcp_server", serverId);

  const content: Record<string, unknown> = {
    name: options.name,
    toolkit: options.toolkit,
    description: options.description ?? `${options.name} tool`,
    input_schema: options.inputSchema ?? { type: "object", properties: {} },
    risk_level: options.riskLevel ?? "medium",
    workspace: workspaceRecord,
    status: options.status ?? "active",
    source_server: serverRecord,
    created_at: new Date(),
  };

  if (options.providerId) {
    content.provider = new RecordId("credential_provider", options.providerId);
  }

  await surreal.query(`CREATE $tool CONTENT $content;`, {
    tool: toolRecord,
    content,
  });

  return { toolId };
}

/**
 * Seed a governs_tool edge directly in SurrealDB for test preconditions.
 */
export async function seedGovernance(
  surreal: Surreal,
  policyId: string,
  toolId: string,
  options?: { conditions?: string; maxPerCall?: number; maxPerDay?: number },
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);
  const toolRecord = new RecordId("mcp_tool", toolId);

  const setClauses: string[] = [];
  if (options?.conditions) setClauses.push(`conditions = $conditions`);
  if (options?.maxPerCall !== undefined) setClauses.push(`max_per_call = ${options.maxPerCall}`);
  if (options?.maxPerDay !== undefined) setClauses.push(`max_per_day = ${options.maxPerDay}`);

  const setString = setClauses.length > 0 ? `SET ${setClauses.join(", ")}` : "";

  await surreal.query(
    `RELATE $policy->governs_tool->$tool ${setString};`,
    { policy: policyRecord, tool: toolRecord, conditions: options?.conditions },
  );
}
