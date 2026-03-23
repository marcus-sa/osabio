-- Add pending OAuth state fields to mcp_server for PKCE flow.
-- These are ephemeral: set during authorize, cleared after token exchange.
BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE pending_pkce_verifier ON mcp_server TYPE option<string>;
DEFINE FIELD OVERWRITE pending_oauth_state ON mcp_server TYPE option<string>;

COMMIT TRANSACTION;
