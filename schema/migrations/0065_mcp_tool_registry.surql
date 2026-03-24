-- Migration 0065: MCP Tool Registry
-- Creates tables for tool definitions, authorization, credentials, and governance.

BEGIN TRANSACTION;

-- ---------------------------------------------------------------------------
-- mcp_tool: Tool definitions registered in a workspace
-- ---------------------------------------------------------------------------
DEFINE TABLE mcp_tool SCHEMAFULL;
DEFINE FIELD name ON mcp_tool TYPE string;
DEFINE FIELD toolkit ON mcp_tool TYPE string;
DEFINE FIELD description ON mcp_tool TYPE string;
DEFINE FIELD input_schema ON mcp_tool TYPE object FLEXIBLE;
DEFINE FIELD output_schema ON mcp_tool TYPE option<object> FLEXIBLE;
DEFINE FIELD provider ON mcp_tool TYPE option<record<credential_provider>>;
DEFINE FIELD risk_level ON mcp_tool TYPE string ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD workspace ON mcp_tool TYPE record<workspace>;
DEFINE FIELD status ON mcp_tool TYPE string ASSERT $value IN ["active", "disabled"];
DEFINE FIELD created_at ON mcp_tool TYPE datetime DEFAULT time::now();

DEFINE INDEX mcp_tool_workspace ON mcp_tool FIELDS workspace;
DEFINE INDEX mcp_tool_workspace_name ON mcp_tool FIELDS workspace, name;
DEFINE INDEX mcp_tool_workspace_toolkit ON mcp_tool FIELDS workspace, toolkit;
DEFINE INDEX mcp_tool_workspace_status ON mcp_tool FIELDS workspace, status;

-- ---------------------------------------------------------------------------
-- can_use: Authorization edge from identity to mcp_tool
-- ---------------------------------------------------------------------------
DEFINE TABLE can_use TYPE RELATION IN identity OUT mcp_tool SCHEMAFULL;
DEFINE FIELD granted_at ON can_use TYPE datetime DEFAULT time::now();
DEFINE FIELD max_calls_per_hour ON can_use TYPE option<int>;
DEFINE INDEX can_use_identity ON can_use FIELDS in;
DEFINE INDEX can_use_tool ON can_use FIELDS out;

-- ---------------------------------------------------------------------------
-- credential_provider: External service credential configuration
-- ---------------------------------------------------------------------------
DEFINE TABLE credential_provider SCHEMAFULL;
DEFINE FIELD name ON credential_provider TYPE string;
DEFINE FIELD display_name ON credential_provider TYPE string;
DEFINE FIELD auth_method ON credential_provider TYPE string ASSERT $value IN ["oauth2", "api_key", "bearer", "basic"];
DEFINE FIELD workspace ON credential_provider TYPE record<workspace>;
DEFINE FIELD authorization_url ON credential_provider TYPE option<string>;
DEFINE FIELD token_url ON credential_provider TYPE option<string>;
DEFINE FIELD client_id ON credential_provider TYPE option<string>;
DEFINE FIELD client_secret_encrypted ON credential_provider TYPE option<string>;
DEFINE FIELD scopes ON credential_provider TYPE option<array<string>>;
DEFINE FIELD api_key_header ON credential_provider TYPE option<string>;
DEFINE FIELD created_at ON credential_provider TYPE datetime DEFAULT time::now();

DEFINE INDEX credential_provider_workspace ON credential_provider FIELDS workspace;
DEFINE INDEX credential_provider_workspace_name ON credential_provider FIELDS workspace, name;

-- ---------------------------------------------------------------------------
-- connected_account: Identity's connected credentials for a provider
-- ---------------------------------------------------------------------------
DEFINE TABLE connected_account SCHEMAFULL;
DEFINE FIELD identity ON connected_account TYPE record<identity>;
DEFINE FIELD provider ON connected_account TYPE record<credential_provider>;
DEFINE FIELD workspace ON connected_account TYPE record<workspace>;
DEFINE FIELD status ON connected_account TYPE string ASSERT $value IN ["active", "revoked", "expired"];
DEFINE FIELD access_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD refresh_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD token_expires_at ON connected_account TYPE option<datetime>;
DEFINE FIELD api_key_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD basic_username ON connected_account TYPE option<string>;
DEFINE FIELD basic_password_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD bearer_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD scopes ON connected_account TYPE option<array<string>>;
DEFINE FIELD connected_at ON connected_account TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON connected_account TYPE datetime DEFAULT time::now();

DEFINE INDEX connected_account_identity_provider ON connected_account FIELDS identity, provider;
DEFINE INDEX connected_account_workspace ON connected_account FIELDS workspace;
DEFINE INDEX connected_account_identity ON connected_account FIELDS identity;

-- ---------------------------------------------------------------------------
-- governs_tool: Policy governance edge from policy to mcp_tool
-- ---------------------------------------------------------------------------
DEFINE TABLE governs_tool TYPE RELATION IN policy OUT mcp_tool SCHEMAFULL;
DEFINE FIELD conditions ON governs_tool TYPE option<string>;
DEFINE FIELD max_per_call ON governs_tool TYPE option<int>;
DEFINE FIELD max_per_day ON governs_tool TYPE option<int>;
DEFINE INDEX governs_tool_policy ON governs_tool FIELDS in;
DEFINE INDEX governs_tool_tool ON governs_tool FIELDS out;

COMMIT TRANSACTION;
