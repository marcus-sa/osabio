# Data Models: Intent-Gated MCP Tool Access

## Schema Changes

### No new tables required

All required tables already exist: `proxy_token`, `agent_session`, `intent`, `gates`, `mcp_tool`, `mcp_server`, `can_use`, `trace`.

### No schema migration required

The `proxy_token` table already has `intent` and `session` fields (added in sandbox-agent-integration R2, migration 0065+). The `gates` relation table already exists. No new fields are needed on any existing table.

---

## Existing Schema (Relevant Tables)

### proxy_token

```sql
DEFINE TABLE proxy_token SCHEMAFULL;
DEFINE FIELD token_hash ON proxy_token TYPE string;
DEFINE FIELD workspace ON proxy_token TYPE record<workspace>;
DEFINE FIELD identity ON proxy_token TYPE record<identity>;
DEFINE FIELD expires_at ON proxy_token TYPE datetime;
DEFINE FIELD created_at ON proxy_token TYPE datetime DEFAULT time::now();
DEFINE FIELD revoked ON proxy_token TYPE bool DEFAULT false;
DEFINE FIELD intent ON proxy_token TYPE option<record<intent>>;      -- initial intent (provenance)
DEFINE FIELD session ON proxy_token TYPE option<record<agent_session>>; -- linked session
```

**Usage**: Agent MCP endpoint uses `session` field to resolve the agent's session. The `intent` field provides provenance to the initial task-spawning intent (separate from runtime tool intents).

### gates (relation: intent -> agent_session)

```sql
DEFINE TABLE gates TYPE RELATION IN intent OUT agent_session SCHEMAFULL;
DEFINE FIELD created_at ON gates TYPE datetime;
```

**Direction**: `intent -gates-> agent_session`. This means:
- To find all intents for a session: `SELECT in.* FROM gates WHERE out = $session`
- To create a gates edge: `RELATE $intent->gates->$sess SET created_at = time::now();`

**Usage**: The scope engine queries gates edges to find all authorized intents linked to a session. The create-intent handler creates gates edges when intents are created.

### intent

```sql
DEFINE TABLE intent SCHEMAFULL;
DEFINE FIELD goal ON intent TYPE string;
DEFINE FIELD reasoning ON intent TYPE string;
DEFINE FIELD status ON intent TYPE string
  ASSERT $value IN ["draft", "pending_auth", "pending_veto", "authorized", "executing", "completed", "vetoed", "failed"];
DEFINE FIELD priority ON intent TYPE int;
DEFINE FIELD action_spec ON intent TYPE object FLEXIBLE;
-- action_spec fields: provider (string), action (string), params (option<object>)
DEFINE FIELD authorization_details ON intent TYPE option<array<object>> FLEXIBLE;
-- Each element: { type: "osabio_action", action: string, resource: string, constraints?: object }
DEFINE FIELD workspace ON intent TYPE record<workspace>;
DEFINE FIELD requester ON intent TYPE record<identity>;
-- ... evaluation, veto, trace fields omitted for brevity
```

**Usage**: The create-intent handler creates intent records. The scope engine reads `authorization_details` from authorized intents.

### mcp_tool

```sql
DEFINE TABLE mcp_tool SCHEMAFULL;
DEFINE FIELD name ON mcp_tool TYPE string;
DEFINE FIELD toolkit ON mcp_tool TYPE string;           -- provider name (e.g., "github", "stripe")
DEFINE FIELD description ON mcp_tool TYPE string;
DEFINE FIELD input_schema ON mcp_tool TYPE object FLEXIBLE;
DEFINE FIELD output_schema ON mcp_tool TYPE option<object> FLEXIBLE;
DEFINE FIELD risk_level ON mcp_tool TYPE string ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD workspace ON mcp_tool TYPE record<workspace>;
DEFINE FIELD status ON mcp_tool TYPE string ASSERT $value IN ["active", "disabled"];
DEFINE FIELD source_server ON mcp_tool TYPE option<record<mcp_server>>;
```

**Usage**: tools/list queries mcp_tool to build the full tool list. The `toolkit` field maps to the `provider` in `action_spec`. The `source_server` field links to the upstream MCP server for forwarding.

### can_use (relation: identity -> mcp_tool)

```sql
DEFINE TABLE can_use TYPE RELATION IN identity OUT mcp_tool SCHEMAFULL;
DEFINE FIELD granted_at ON can_use TYPE datetime DEFAULT time::now();
DEFINE FIELD max_calls_per_hour ON can_use TYPE option<int>;
```

**Usage**: The scope engine queries can_use to determine which tools are granted to the agent's identity. This is the first gate -- a tool must be granted before intent authorization matters.

### mcp_server

```sql
DEFINE TABLE mcp_server SCHEMAFULL;
DEFINE FIELD name ON mcp_server TYPE string;
DEFINE FIELD url ON mcp_server TYPE string;
DEFINE FIELD transport ON mcp_server TYPE string DEFAULT "streamable-http";
DEFINE FIELD workspace ON mcp_server TYPE record<workspace>;
DEFINE FIELD status ON mcp_server TYPE string DEFAULT "active";
DEFINE FIELD auth_mode ON mcp_server TYPE string DEFAULT "none";
-- ... credential, discovery fields omitted for brevity
```

**Usage**: tools/call uses `source_server` on the mcp_tool record to look up the upstream MCP server for forwarding.

---

## Query Patterns

### Q1: Resolve session from proxy token

Already implemented in `proxy-auth.ts:createLookupProxyToken`.

```sql
SELECT workspace, identity, expires_at, revoked, intent, session
FROM proxy_token
WHERE token_hash = $hash
LIMIT 1;
```

### Q2: Load session record

Already implemented in `session-lifecycle.ts:lookupSession`.

```sql
SELECT * FROM $sessionRecord;
-- where $sessionRecord = new RecordId("agent_session", sessionId)
```

### Q3: Load authorized intents for session (scope computation)

**New query** for scope-engine.ts.

```sql
SELECT
  in.id AS intent_id,
  in.authorization_details AS authorization_details
FROM gates
WHERE out = $session
  AND in.status = "authorized";
```

**Note**: The `in` traversal follows the `gates` relation direction (intent -> agent_session). Filtering `in.status = "authorized"` ensures only authorized intents contribute to scope.

**Bound parameters**:
- `$session`: `RecordId<"agent_session", string>`

**Result type**:
```typescript
type IntentScopeRow = {
  intent_id: RecordId<"intent", string>;
  authorization_details: OsabioAction[] | undefined;
};
```

### Q4: Load granted tools for identity (can_use resolution)

Already implemented in `proxy/tool-resolver.ts:createQueryGrantedTools`.

```sql
SELECT out.name AS name, out.description AS description,
       out.input_schema AS input_schema, out.output_schema AS output_schema,
       out.toolkit AS toolkit, out.risk_level AS risk_level,
       out.source_server.id AS source_server_id
FROM can_use
WHERE in = $identity AND out.status = 'active' AND out.workspace = $workspace;
```

### Q5: Load all active tools in workspace (for gated tool listing)

**New query** for tools-list-handler.ts. Required to show gated tools the agent doesn't yet have access to.

```sql
SELECT name, description, input_schema, toolkit, risk_level, source_server
FROM mcp_tool
WHERE workspace = $workspace AND status = "active";
```

**Bound parameters**:
- `$workspace`: `RecordId<"workspace", string>`

### Q6: Create gates edge (intent -> session)

Already implemented in `session-lifecycle.ts:transitionIntentToExecuting`.

```sql
RELATE $intent->gates->$sess SET created_at = time::now();
```

**Bound parameters**:
- `$intent`: `RecordId<"intent", string>`
- `$sess`: `RecordId<"agent_session", string>` (note: `$session` is a SurrealDB protected variable)

### Q7: Intent dedup check (Release 3)

Check for existing non-terminal intent with same session + action_spec.

```sql
SELECT id, status
FROM intent
WHERE workspace = $workspace
  AND id IN (SELECT in FROM gates WHERE out = $session).in
  AND action_spec.provider = $provider
  AND action_spec.action = $action
  AND status NOT IN ["vetoed", "failed", "completed"]
LIMIT 1;
```

### Q8: Observer scan for authorized intents on idle sessions

**New query** for observer resume pattern.

```sql
SELECT
  out.id AS session_id,
  out.external_session_id AS external_session_id,
  in.id AS intent_id,
  in.status AS intent_status,
  in.goal AS intent_goal,
  in.action_spec AS action_spec,
  in.veto_reason AS veto_reason
FROM gates
WHERE out.orchestrator_status = "idle"
  AND in.status IN ["authorized", "vetoed"]
  AND in.updated_at > $last_scan;
```

**Bound parameters**:
- `$last_scan`: `datetime` (last observer scan timestamp)

---

## ActionSpec-to-OsabioAction Mapping

When the agent calls `create_intent`, the `action_spec` is mapped to `authorization_details` (array of `OsabioAction`):

```typescript
// Input from agent
const actionSpec: ActionSpec = {
  provider: "stripe",
  action: "create_refund",
  params: { amount: 5000, currency: "usd" }
};

// Derived OsabioAction for authorization_details
const brainAction: OsabioAction = {
  type: "osabio_action",
  action: "execute",
  resource: `mcp_tool:${actionSpec.provider}:${actionSpec.action}`,
  constraints: actionSpec.params  // only policy-relevant params become constraints
};
```

The `resource` field uses a composite identifier: `mcp_tool:<provider>:<action>`. This allows policies to match on provider wildcards (`mcp_tool:stripe:*`) or specific tools (`mcp_tool:stripe:create_refund`).

For composite intents, the `authorization_details` array contains multiple `OsabioAction` entries:

```typescript
const compositeDetails: OsabioAction[] = [
  { type: "osabio_action", action: "execute", resource: "mcp_tool:stripe:list_charges" },
  { type: "osabio_action", action: "execute", resource: "mcp_tool:stripe:create_refund",
    constraints: { amount: 5000, currency: "usd" } },
];
```

---

## Scope Computation Algorithm (Pure)

```
Input: session gates edges, identity can_use grants

1. Query gates edges for session -> get authorized intents
2. Flatten all intents' authorization_details -> EffectiveScope.authorizedActions
3. Query can_use grants for identity -> granted tools
4. For each granted tool:
   a. If tool name is in brainNativeToolNames -> classify as "osabio_native"
   b. Else, check if any authorizedAction matches the tool (by resource):
      - resource = "mcp_tool:{tool.toolkit}:{tool.name}"
      - If match found -> classify as "authorized" (with matching intent)
      - If no match -> classify as "gated"
5. Additionally, query all workspace mcp_tools NOT in can_use grants:
   - These are also "gated" (agent can see them but needs both grant + intent)

Output: ClassifiedTool[] for tools/list; EffectiveScope for tools/call
```

---

## Trace Record Schema

Uses the existing trace capture pattern from `proxy/tool-trace-writer.ts`. The `captureToolTrace` function already supports `sessionId` and tool metadata. For intent-gated calls, the trace includes:

| Field | Type | Description |
|-------|------|-------------|
| tool_name | string | MCP tool name |
| workspace_id | string | Workspace scope |
| identity_id | string | Agent's identity |
| session_id | string | Agent session |
| intent_id | string | Authorizing intent (new field) |
| outcome | string | "success", "error", "timeout", "constraint_violated", "intent_required" |
| duration_ms | number | Total call duration |
| input | object | Tool arguments (sanitized) |
| output | object | Tool result or error (sanitized) |

The `intent_id` field is a new addition to the trace context, linking each tool call to the specific intent that authorized it. This enables audit queries like "show all tool calls authorized by intent X".
