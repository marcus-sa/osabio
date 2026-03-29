BEGIN TRANSACTION;

-- Step 1: Define name as optional so existing records pass validation
DEFINE FIELD OVERWRITE name ON agent TYPE option<string>;

-- Step 2: Define runtime as optional so existing records pass validation
DEFINE FIELD OVERWRITE runtime ON agent TYPE option<string>;

-- Backfill name from agent_type for records that don't have one
UPDATE agent SET name = agent_type WHERE name IS NONE OR name = '';

-- Backfill runtime from agent_type
UPDATE agent SET runtime = IF agent_type IN ['code_agent', 'mcp'] THEN 'external'
  ELSE 'osabio'
END
WHERE runtime IS NONE OR runtime = '';

-- Step 3: Now all records have values — tighten to required with assertions
DEFINE FIELD OVERWRITE runtime ON agent TYPE string
  ASSERT $value IN ['osabio', 'sandbox', 'external'];

DEFINE FIELD OVERWRITE name ON agent TYPE string;

-- Step 4: Remove agent_type from agent table (replaced by name + runtime)
REMOVE FIELD agent_type ON agent;
UPDATE agent UNSET agent_type;

-- Add sandbox_config for sandbox agents
DEFINE FIELD OVERWRITE sandbox_config ON agent TYPE option<object>;
DEFINE FIELD OVERWRITE sandbox_config.coding_agents ON agent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars ON agent TYPE option<array<object>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].key ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].value ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.image ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.snapshot ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.model ON agent TYPE option<string>;

-- Step 5: Remove agent_type from authority_scope
-- Delete all existing authority_scope records (duplicated per agent_type)
DELETE FROM authority_scope;

-- Remove agent_type field
REMOVE FIELD agent_type ON authority_scope;
UPDATE authority_scope UNSET agent_type;

-- Update index to exclude agent_type
DEFINE INDEX OVERWRITE authority_scope_lookup ON authority_scope
  FIELDS action, workspace;

-- Re-seed: one authority_scope per action with default permission
CREATE authority_scope CONTENT { action: "create_decision", permission: "provisional", created_at: time::now() };
CREATE authority_scope CONTENT { action: "confirm_decision", permission: "blocked", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_task", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "complete_task", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_observation", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "acknowledge_observation", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "resolve_observation", permission: "blocked", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_question", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_suggestion", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "create_intent", permission: "auto", created_at: time::now() };
CREATE authority_scope CONTENT { action: "submit_intent", permission: "auto", created_at: time::now() };

COMMIT TRANSACTION;