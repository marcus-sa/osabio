# Data Models: Agent Management

## Schema Changes

### Agent Table (modified)

Current schema:
```sql
DEFINE TABLE agent SCHEMAFULL;
DEFINE FIELD agent_type ON agent TYPE string ASSERT $value IN ['code_agent', 'architect', 'management', 'design_partner', 'observer', 'chat_agent', 'mcp'];
DEFINE FIELD model ON agent TYPE option<string>;
DEFINE FIELD description ON agent TYPE option<string>;
DEFINE FIELD managed_by ON agent TYPE record<identity>;
DEFINE FIELD created_at ON agent TYPE datetime;
```

New fields (migration 0081):
```sql
DEFINE FIELD OVERWRITE runtime ON agent TYPE string
  ASSERT $value IN ['brain', 'sandbox', 'external'];
DEFINE FIELD OVERWRITE name ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config ON agent TYPE option<object>;
DEFINE FIELD OVERWRITE sandbox_config.coding_agents ON agent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars ON agent TYPE option<array<object>>;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].key ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.env_vars[*].value ON agent TYPE string;
DEFINE FIELD OVERWRITE sandbox_config.image ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.snapshot ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE sandbox_config.model ON agent TYPE option<string>;
```

Transition field (migration 0083, deferred):
```sql
DEFINE FIELD OVERWRITE agent_type ON agent TYPE option<string>;
```

### Workspace Table (modified)

New settings field (migration 0082):
```sql
DEFINE FIELD OVERWRITE settings.sandbox_provider ON workspace TYPE option<string>
  ASSERT $value = NONE OR $value IN ['local', 'e2b', 'daytona', 'docker'];
```

### No New Tables

This feature does not introduce new tables. It extends:
- `agent` -- runtime, name, sandbox_config fields
- `workspace` -- settings.sandbox_provider field

And uses existing tables and relations:
- `identity` -- hub for agent identity
- `identity_agent` -- spoke edge from identity to agent
- `member_of` -- workspace membership edge
- `authorized_to` -- per-identity authority override edge
- `authority_scope` -- permission definitions (existing seed data)
- `proxy_token` -- token storage for external agents
- `agent_session` -- session history (read-only for this feature)

## Graph Traversal Patterns

### List agents for workspace

```
workspace <- member_of <- identity <- identity_agent -> agent
```

Single query:
```sql
SELECT
  out.id AS agent_id,
  out.name AS name,
  out.description AS description,
  out.runtime AS runtime,
  out.model AS model,
  out.created_at AS created_at,
  in.id AS identity_id
FROM identity_agent
WHERE in IN (
  SELECT VALUE in FROM member_of WHERE out = $ws
)
AND in.type = 'agent'
ORDER BY out.created_at DESC;
```

### Get agent detail with authority scopes

```sql
-- Agent + identity
SELECT * FROM $agentRecord;

-- Identity via edge
SELECT VALUE in FROM identity_agent WHERE out = $agentRecord LIMIT 1;

-- Authority scopes for identity
SELECT out.action AS action, permission FROM authorized_to WHERE in = $identityRecord;

-- Recent sessions
SELECT id, started_at, ended_at, orchestrator_status, summary, created_at
FROM agent_session
WHERE workspace = $ws
ORDER BY created_at DESC
LIMIT 20;
```

**R1 limitation**: `agent_session.agent` is currently a string field storing the `agent_type` value, not an agent record reference. In R1, the session list returns recent workspace sessions (not filtered per-agent). The UI should label this as "Recent workspace sessions". In R2 (US-08), `agent_session.agent` will be migrated to a record reference for per-agent filtering.

### Validate name uniqueness

```sql
SELECT id FROM agent WHERE name = $name AND id IN (
  SELECT VALUE out FROM identity_agent WHERE in IN (
    SELECT VALUE id FROM identity WHERE workspace = $ws
  )
) LIMIT 1;
```

### Delete agent (transaction)

```sql
BEGIN TRANSACTION;

-- Abort active sessions
UPDATE agent_session SET orchestrator_status = 'aborted', ended_at = time::now()
WHERE workspace = $ws
AND orchestrator_status IN ['spawning', 'active', 'idle']
AND id IN (SELECT VALUE id FROM agent_session WHERE agent = $agentName);

-- Remove authorized_to edges
DELETE authorized_to WHERE in = $identityRecord;

-- Remove member_of edge
DELETE member_of WHERE in = $identityRecord AND out = $ws;

-- Remove identity_agent edge
DELETE identity_agent WHERE in = $identityRecord AND out = $agentRecord;

-- Remove identity
DELETE $identityRecord;

-- Revoke proxy tokens (external agents)
UPDATE proxy_token SET revoked = true WHERE identity = $identityRecord;

-- Remove agent
DELETE $agentRecord;

COMMIT TRANSACTION;
```

## TypeScript Types

### API Request/Response Types

```typescript
// Shared contract types (app/src/shared/contracts.ts)

type AgentRuntime = "brain" | "sandbox" | "external";

type AgentListItem = {
  id: string;
  name: string;
  description?: string;
  runtime: AgentRuntime;
  model?: string;
  identity_id: string;
  created_at: string;
};

type CreateAgentRequest = {
  name: string;
  description?: string;
  runtime: "sandbox" | "external";
  model?: string;
  sandbox_config?: SandboxConfig;
  authority_scopes?: AuthorityScopeInput[];
};

type SandboxConfig = {
  coding_agents?: string[];
  env_vars?: { key: string; value: string }[];
  image?: string;
  snapshot?: string;
  model?: string;
};

/** All 11 configurable actions for agent authority scopes */
type AuthorityAction =
  | "create_decision" | "confirm_decision"
  | "create_task" | "complete_task"
  | "create_observation" | "acknowledge_observation" | "resolve_observation"
  | "create_question" | "create_suggestion"
  | "create_intent" | "submit_intent";

type AuthorityScopeInput = {
  action: AuthorityAction;
  permission: "auto" | "propose" | "blocked";
};
// When authority_scopes is omitted from CreateAgentRequest,
// all 11 actions default to "propose" (safe by default).

type CreateAgentResponse = {
  agent: AgentListItem;
  proxy_token?: string;  // present only for external agents (brp_ prefix)
  workspace_id: string;  // for connection instructions in UI
};

type AgentDetailResponse = {
  agent: AgentListItem & {
    sandbox_config?: SandboxConfig;
  };
  identity: {
    id: string;
    name: string;
    type: string;
    role?: string;
  };
  authority_scopes: {
    action: string;
    permission: string;
  }[];
  sessions: SessionSummary[];
};

type SessionSummary = {
  id: string;
  started_at: string;
  ended_at?: string;
  orchestrator_status?: string;
  summary?: string;
};

type DeleteAgentRequest = {
  confirm_name: string;
};

type DeleteAgentResponse = {
  deleted: true;
  sessions_aborted: number;
};
```

## Migration Sequence

| Migration | File | Content | Release |
|-----------|------|---------|---------|
| 0081 | `0081_agent_runtime_name.surql` | Add `runtime`, `name`, `sandbox_config` to agent; backfill from `agent_type` | R1 |
| 0082 | `0082_workspace_sandbox_provider.surql` | Add `settings.sandbox_provider` to workspace | R1 |
| 0083 | `0083_agent_type_optional.surql` | Make `agent_type` optional (deferred to R3 cleanup) | R3 |

Note: Per project convention, this project does NOT maintain backwards compatibility with existing data. However, the `runtime` backfill is included because `agent_type` data encodes the correct runtime mapping and preserving it costs nothing.
