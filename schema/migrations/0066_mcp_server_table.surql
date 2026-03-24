-- Migration 0066: MCP Server Table
-- Creates the mcp_server table for MCP server connection management
-- and adds source_server field on mcp_tool for discovered tool tracking.

BEGIN TRANSACTION;

-- ---------------------------------------------------------------------------
-- mcp_server: MCP server connection configuration
-- ---------------------------------------------------------------------------
DEFINE TABLE mcp_server SCHEMAFULL;
DEFINE FIELD name ON mcp_server TYPE string;
DEFINE FIELD url ON mcp_server TYPE string;
DEFINE FIELD transport ON mcp_server TYPE string DEFAULT "streamable-http"
  ASSERT $value IN ["streamable-http", "sse"];
DEFINE FIELD workspace ON mcp_server TYPE record<workspace>;
DEFINE FIELD provider ON mcp_server TYPE option<record<credential_provider>>;
DEFINE FIELD last_status ON mcp_server TYPE option<string>
  ASSERT $value IN ["ok", "error"] OR $value IS NONE;
DEFINE FIELD last_error ON mcp_server TYPE option<string>;
DEFINE FIELD server_info ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD capabilities ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD last_discovery ON mcp_server TYPE option<datetime>;
DEFINE FIELD tool_count ON mcp_server TYPE int DEFAULT 0;
DEFINE FIELD created_at ON mcp_server TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_mcp_server_workspace ON mcp_server FIELDS workspace;
DEFINE INDEX idx_mcp_server_workspace_name ON mcp_server FIELDS workspace, name UNIQUE;

-- ---------------------------------------------------------------------------
-- source_server: Link from mcp_tool to its originating mcp_server
-- ---------------------------------------------------------------------------
DEFINE FIELD OVERWRITE source_server ON mcp_tool TYPE option<record<mcp_server>>;

COMMIT TRANSACTION;
