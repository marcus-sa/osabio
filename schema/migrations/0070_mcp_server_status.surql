-- Add status field to mcp_server for soft-delete support.
-- Servers are "active" by default; removing a server sets status to "disabled"
-- instead of hard-deleting, preserving tool references and grants.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE status ON mcp_server TYPE string DEFAULT "active"
  ASSERT $value IN ["active", "disabled"];

DEFINE INDEX OVERWRITE idx_mcp_server_workspace_status ON mcp_server FIELDS workspace, status;

-- Backfill existing servers as active
UPDATE mcp_server SET status = "active" WHERE status IS NONE;

COMMIT TRANSACTION;
