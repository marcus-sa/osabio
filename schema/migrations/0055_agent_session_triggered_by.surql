-- Add triggered_by field to agent_session (polymorphic: which entity caused activation)
-- Add description field to agent (text, for LLM classification in agent activator)

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE triggered_by ON agent_session TYPE option<record<observation | task | decision | question>>;
DEFINE FIELD OVERWRITE description ON agent TYPE option<string>;

COMMIT TRANSACTION;
