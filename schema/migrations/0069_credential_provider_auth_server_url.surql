-- Add auth_server_url to credential_provider for OAuth 2.1 flows.
-- Stores the authorization server base URL (from RFC 9728 discovery)
-- so token exchange and refresh can use the MCP SDK's built-in functions.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE auth_server_url ON credential_provider TYPE option<string>;

COMMIT TRANSACTION;
