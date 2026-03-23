/**
 * Tool Registry Domain Types
 *
 * Credential providers, connected accounts, tools, grants, governance,
 * MCP servers, and discovery.
 *
 * Auth method variants: oauth2, api_key, bearer, basic.
 * Encrypted fields use _encrypted suffix (ADR-068).
 */
import type { RecordId } from "surrealdb";

export type AuthMethod = "oauth2" | "api_key" | "bearer" | "basic";

/**
 * Input payload for creating a credential provider via API.
 * client_secret is plaintext here -- encrypted before storage.
 */
export type CreateProviderInput = {
  name: string;
  display_name: string;
  auth_method: AuthMethod;
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  api_key_header?: string;
};

/**
 * SurrealDB record shape for credential_provider.
 */
export type CredentialProviderRecord = {
  id: RecordId<"credential_provider", string>;
  name: string;
  display_name: string;
  auth_method: AuthMethod;
  workspace: RecordId<"workspace", string>;
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  client_secret_encrypted?: string;
  scopes?: string[];
  api_key_header?: string;
  created_at: Date;
};

/**
 * Status of a connected account.
 */
export type AccountStatus = "active" | "revoked" | "expired";

/**
 * Input payload for connecting an account via static credentials (API key, basic, bearer).
 * OAuth2 connections are initiated via redirect flow -- no credentials in this payload.
 */
export type ConnectAccountInput = {
  api_key?: string;
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
};

/**
 * SurrealDB record shape for connected_account.
 */
export type ConnectedAccountRecord = {
  id: RecordId<"connected_account", string>;
  identity: RecordId<"identity", string>;
  provider: RecordId<"credential_provider", string>;
  workspace: RecordId<"workspace", string>;
  status: AccountStatus;
  access_token_encrypted?: string;
  refresh_token_encrypted?: string;
  token_expires_at?: Date;
  api_key_encrypted?: string;
  basic_username?: string;
  basic_password_encrypted?: string;
  bearer_token_encrypted?: string;
  scopes?: string[];
  connected_at: Date;
  updated_at: Date;
};

/**
 * API response shape for connected accounts -- never contains plaintext secrets.
 */
export type ConnectedAccountApiResponse = {
  id: string;
  provider_id: string;
  status: AccountStatus;
  has_api_key: boolean;
  has_bearer_token: boolean;
  has_basic_credentials: boolean;
  has_access_token: boolean;
  connected_at: string;
};

/**
 * OAuth2 initiation response -- returned when connecting to an oauth2 provider.
 */
export type OAuth2InitiationResponse = {
  redirect_url: string;
  state: string;
};

/**
 * API response shape -- never contains plaintext secrets.
 */
export type ProviderApiResponse = {
  id: string;
  name: string;
  display_name: string;
  auth_method: AuthMethod;
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  has_client_secret: boolean;
  scopes?: string[];
  api_key_header?: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Tool Types
// ---------------------------------------------------------------------------

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";
export type ToolStatus = "active" | "disabled";

/**
 * Summary shape for the tools list (Tools tab).
 * Includes grant/governance counts for UI grouping.
 */
export type ToolListItem = {
  id: string;
  name: string;
  toolkit: string;
  description: string;
  risk_level: ToolRiskLevel;
  status: ToolStatus;
  grant_count: number;
  governance_count: number;
  created_at: string;
};

/**
 * Grant detail within a tool's access tab.
 */
export type GrantDetail = {
  identity_id: string;
  identity_name: string;
  max_calls_per_hour?: number;
  granted_at: string;
};

/**
 * Governance policy detail within a tool's governance tab.
 */
export type GovernancePolicyDetail = {
  policy_title: string;
  policy_status: string;
  conditions?: string;
  max_per_call?: number;
  max_per_day?: number;
};

/**
 * Full tool detail: list item fields plus schema, grants, and governance.
 */
export type ToolDetail = ToolListItem & {
  input_schema: Record<string, unknown>;
  grants: GrantDetail[];
  governance_policies: GovernancePolicyDetail[];
};

/**
 * SurrealDB record shape for mcp_tool.
 */
export type McpToolRecord = {
  id: RecordId<"mcp_tool", string>;
  name: string;
  toolkit: string;
  description: string;
  input_schema: Record<string, unknown>;
  risk_level: ToolRiskLevel;
  status: ToolStatus;
  workspace: RecordId<"workspace", string>;
  provider?: RecordId<"credential_provider", string>;
  source_server?: RecordId<"mcp_server", string>;
  created_at: Date;
};

// ---------------------------------------------------------------------------
// Grant / Governance Input Types
// ---------------------------------------------------------------------------

/**
 * Input for creating a tool access grant via API.
 */
export type CreateGrantInput = {
  identity_id: string;
  max_calls_per_hour?: number;
};

/**
 * Input for attaching a governance policy to a tool via API.
 */
export type AttachGovernanceInput = {
  policy_id: string;
  conditions?: string;
  max_per_call?: number;
  max_per_day?: number;
};

// ---------------------------------------------------------------------------
// MCP Server Types
// ---------------------------------------------------------------------------

export type McpTransport = "sse" | "streamable-http";
export type McpServerStatus = "ok" | "error";

/**
 * SurrealDB record shape for mcp_server.
 */
export type McpServerRecord = {
  id: RecordId<"mcp_server", string>;
  name: string;
  url: string;
  transport: McpTransport;
  workspace: RecordId<"workspace", string>;
  provider?: RecordId<"credential_provider", string>;
  last_status?: McpServerStatus;
  last_error?: string;
  server_info?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  last_discovery?: Date;
  tool_count: number;
  created_at: Date;
};

/**
 * Summary shape for the MCP servers list.
 */
export type McpServerListItem = {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  last_status?: McpServerStatus;
  tool_count: number;
  created_at: string;
};

/**
 * Input for registering an MCP server via API.
 */
export type AddMcpServerInput = {
  name: string;
  url: string;
  transport?: McpTransport;
  provider_id?: string;
};

// ---------------------------------------------------------------------------
// Discovery Types
// ---------------------------------------------------------------------------

export type ToolSyncAction = "create" | "update" | "disable" | "unchanged";

/**
 * A single tool found during MCP server discovery with its sync action.
 */
export type ToolSyncDetail = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  action: ToolSyncAction;
  risk_level: ToolRiskLevel;
};

/**
 * Result of an MCP server tool discovery operation.
 */
export type DiscoveryResult = {
  server_id: string;
  tools: ToolSyncDetail[];
};

// ---------------------------------------------------------------------------
// Resolved Tool (extends proxy type with source server)
// ---------------------------------------------------------------------------

/**
 * Resolved tool from Brain's can_use graph query.
 * Extends the proxy's tool format with optional source_server_id
 * for tools discovered from MCP servers.
 */
export type ResolvedTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  toolkit: string;
  risk_level: string;
  source_server_id?: string;
};
