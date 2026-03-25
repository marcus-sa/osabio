BEGIN TRANSACTION;

-- Sandbox provider: "local", "docker", "e2b", "daytona"
DEFINE FIELD OVERWRITE provider ON agent_session TYPE option<string>;

-- Session type discriminator: "claude_agent_sdk" (current) or "sandbox_agent" (new)
DEFINE FIELD OVERWRITE session_type ON agent_session TYPE option<string>;

COMMIT TRANSACTION;
