-- Migration 0067: MCP Server Auth Modes
-- Adds auth_mode enum, static_headers array, oauth_account link to mcp_server.
-- Adds discovery_source to credential_provider.
-- Updates last_status ASSERT to include "auth_error".
-- Backfills existing servers with provider references to auth_mode=provider.

BEGIN TRANSACTION;

-- ---------------------------------------------------------------------------
-- mcp_server: auth mode and static headers
-- ---------------------------------------------------------------------------
DEFINE FIELD OVERWRITE auth_mode ON mcp_server TYPE string
  DEFAULT "none"
  ASSERT $value IN ["none", "static_headers", "oauth", "provider"];

DEFINE FIELD OVERWRITE static_headers ON mcp_server TYPE option<array<object>>;
DEFINE FIELD OVERWRITE static_headers[*].name ON mcp_server TYPE string;
DEFINE FIELD OVERWRITE static_headers[*].value_encrypted ON mcp_server TYPE string;

-- OAuth account link (for oauth auth_mode)
DEFINE FIELD OVERWRITE oauth_account ON mcp_server TYPE option<record<connected_account>>;

-- Update last_status to include auth_error
DEFINE FIELD OVERWRITE last_status ON mcp_server TYPE option<string>
  ASSERT $value IN ["ok", "error", "auth_error"] OR $value IS NONE;

-- ---------------------------------------------------------------------------
-- credential_provider: discovery source
-- ---------------------------------------------------------------------------
DEFINE FIELD OVERWRITE discovery_source ON credential_provider TYPE option<string>;

-- ---------------------------------------------------------------------------
-- Backfill: servers with a provider get auth_mode=provider
-- ---------------------------------------------------------------------------
UPDATE mcp_server SET auth_mode = "provider" WHERE provider IS NOT NONE;

COMMIT TRANSACTION;
