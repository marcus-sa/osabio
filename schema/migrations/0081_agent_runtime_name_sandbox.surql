BEGIN TRANSACTION;

-- Add runtime field (replaces agent_type over time)
DEFINE FIELD OVERWRITE runtime ON agent TYPE string
  ASSERT $value IN ['brain', 'sandbox', 'external'];

-- Add name field to agent
DEFINE FIELD OVERWRITE name ON agent TYPE string;

-- Add sandbox_config for sandbox agents
DEFINE FIELD OVERWRITE sandbox_config ON agent TYPE option<object>;
DEFINE FIELD OVERWRITE sandbox_config.coding_agents ON agent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars ON agent TYPE option<array<object>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].key ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].value ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.image ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.snapshot ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.model ON agent TYPE option<string>;

-- Backfill runtime from agent_type
UPDATE agent SET runtime = IF agent_type IN ['code_agent', 'mcp'] THEN 'external'
  ELSE IF agent_type = 'observer' OR agent_type = 'chat_agent' OR agent_type = 'architect' OR agent_type = 'management' OR agent_type = 'design_partner' THEN 'brain'
  ELSE 'brain'
END;

-- Backfill name from identity (via identity_agent edge)
UPDATE agent SET name = (SELECT VALUE in.name FROM identity_agent WHERE out = $parent.id LIMIT 1)[0]
  WHERE name IS NONE OR name = '';

COMMIT TRANSACTION;
