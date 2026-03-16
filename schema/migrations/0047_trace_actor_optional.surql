-- Make trace.actor and trace.workspace optional for LLM proxy traces
-- that may not have an authenticated identity or workspace context
BEGIN TRANSACTION;
DEFINE FIELD OVERWRITE actor ON trace TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE workspace ON trace TYPE option<record<workspace>>;
COMMIT TRANSACTION;
