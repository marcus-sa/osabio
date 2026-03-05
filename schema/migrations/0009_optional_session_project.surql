BEGIN TRANSACTION;

-- Make project optional on agent_session (workspace-scoped sessions)
DEFINE FIELD OVERWRITE project ON agent_session TYPE option<record<project>>;

COMMIT TRANSACTION;
