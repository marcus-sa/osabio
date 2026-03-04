-- MCP auth and question coding agent fields.
-- Adds api_key_hash to workspace for MCP API key auth.
-- Adds asked_by, options, answer_summary, blocking_task to question for coding agent integration.

BEGIN TRANSACTION;

-- Workspace: API key hash for MCP auth
DEFINE FIELD OVERWRITE api_key_hash ON workspace TYPE option<string>;

-- Question: coding agent fields
DEFINE FIELD OVERWRITE asked_by ON question TYPE option<string>;
DEFINE FIELD OVERWRITE options ON question TYPE option<array<string>>;
DEFINE FIELD OVERWRITE answer_summary ON question TYPE option<string>;
DEFINE FIELD OVERWRITE blocking_task ON question TYPE option<record<task>>;

COMMIT TRANSACTION;
