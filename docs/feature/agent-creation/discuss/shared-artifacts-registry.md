# Shared Artifacts Registry: Agent Management

## Artifacts

### agent_list

```yaml
source_of_truth: "SurrealDB agent table + identity graph (workspace <- member_of <- identity <- identity_agent -> agent)"
consumers:
  - "Agents page card grid"
  - "Agent count badge in navigation"
  - "Filter tab counts (brain/sandbox/external)"
  - "Agent detail page header"
owner: "agents API route"
integration_risk: "HIGH -- graph traversal must produce correct workspace-scoped list; incorrect member_of edges produce invisible agents"
validation: "Agent list count matches SELECT count() FROM identity WHERE type = 'agent' AND workspace = $ws"
```

### runtime_type

```yaml
source_of_truth: "agent.runtime field (string: 'brain' | 'sandbox' | 'external')"
consumers:
  - "Agent card runtime badge (color + text)"
  - "Filter tabs on agents page"
  - "Card action buttons (conditional rendering)"
  - "Creation form (determines which fields appear)"
  - "Agent detail page layout"
  - "Authority resolution fallback path (brain uses seed defaults, custom uses authorized_to)"
owner: "agent table schema"
integration_risk: "HIGH -- runtime determines UI behavior, authority resolution path, and creation flow. Mismatch breaks governance."
validation: "agent.runtime value matches one of ['brain', 'sandbox', 'external']; same value displayed in all consumer locations"
```

### agent_name

```yaml
source_of_truth: "agent.name field"
consumers:
  - "Agent card title"
  - "Identity record name (synced at creation, updated on edit)"
  - "Agent detail page header"
  - "Creation confirmation dialog"
  - "Delete confirmation (type-to-confirm)"
  - "Session list agent reference"
owner: "agent table schema"
integration_risk: "MEDIUM -- agent.name and identity.name must stay in sync; desync causes confusion in authority resolution and UI"
validation: "agent.name == linked identity.name; unique within workspace"
```

### authority_scopes

```yaml
source_of_truth: "authorized_to relation edges (identity -> authority_scope)"
consumers:
  - "Agent detail authority section"
  - "Creation form authority scope table"
  - "Edit form authority scope table"
  - "Confirmation dialog scope count"
  - "Runtime authority resolution (iam/authority.ts Layer 1)"
  - "Proxy policy evaluation"
owner: "iam module (authority.ts)"
integration_risk: "HIGH -- authorized_to edges are the governance surface for custom agents. Missing edges = blocked actions. Extra edges = unauthorized autonomy."
validation: "Count of authorized_to edges matches count of configured scopes; each edge points to a valid authority_scope record"
```

### sandbox_config

```yaml
source_of_truth: "agent.sandbox_config object (env_vars, agents; cloud providers add image, snapshot, template)"
consumers:
  - "Agent detail configuration section"
  - "Sandbox Agent SDK at session spawn (CreateSessionRequest)"
  - "Edit form sandbox configuration fields"
  - "Creation confirmation dialog"
owner: "agent table schema"
integration_risk: "MEDIUM -- sandbox_config values are passed to external SDK at spawn time. Invalid env vars cause spawn failures. Image/snapshot only relevant for cloud providers (e2b, daytona, docker), not local."
validation: "agent.sandbox_config fields match what Sandbox Agent SDK expects; image field present only when workspace uses cloud provider"
```

### workspace_sandbox_provider

```yaml
source_of_truth: "workspace.settings.sandbox_provider (string: 'local' | 'e2b' | 'daytona' | 'docker')"
consumers:
  - "Sandbox agent creation form (validation gate)"
  - "Agent detail provider label"
  - "Sandbox Agent SDK provider selection at spawn"
  - "Settings page sandbox provider section"
owner: "workspace settings"
integration_risk: "HIGH -- creating sandbox agent without configured provider produces unspawnable agent. Must validate at creation time."
validation: "workspace.settings.sandbox_provider is set before any sandbox agent can be created"
```

### proxy_token

```yaml
source_of_truth: "Generated at external agent creation time (stored as hashed value in proxy_token table)"
consumers:
  - "Creation confirmation dialog (shown once, plaintext)"
  - "External agent X-Brain-Auth header"
  - "Proxy authentication (proxy-auth.ts hashProxyToken)"
owner: "proxy auth module"
integration_risk: "HIGH -- token shown only once at creation. Lost token requires regeneration. Token format must match proxy auth expectations (raw, no Bearer prefix)."
validation: "sha256(plaintext_token) matches proxy_token.token_hash in SurrealDB"
```

### session_list

```yaml
source_of_truth: "agent_session table (filtered by agent identifier)"
consumers:
  - "Agent detail session list (grouped by orchestrator_status)"
  - "Agent card active session count"
  - "Delete confirmation (active session warning)"
owner: "orchestrator module"
integration_risk: "MEDIUM -- session list query must match agent correctly. Current schema stores agent as string (agent_type), migration needed to store agent record ID."
validation: "agent_session records for agent match expected count; orchestrator_status values are valid enum members"
```

### session_orchestrator_status

```yaml
source_of_truth: "agent_session.orchestrator_status (string enum)"
consumers:
  - "Session status badge in agent detail"
  - "Session grouping (active/idle/completed)"
  - "Active session count on agent card"
  - "Delete confirmation active session detection"
owner: "orchestrator module"
integration_risk: "LOW -- existing field with established enum; consumers display but do not modify"
validation: "orchestrator_status IN ['spawning', 'active', 'idle', 'completed', 'aborted', 'error']"
```

## Integration Risk Summary

| Risk Level | Artifacts | Mitigation |
|-----------|-----------|------------|
| HIGH | runtime_type, authority_scopes, workspace_sandbox_provider, proxy_token, agent_list | Validate at creation time; acceptance tests for each integration point |
| MEDIUM | agent_name, sandbox_config, session_list | Sync checks on edit; spawn-time validation |
| LOW | session_orchestrator_status | Existing field, display-only |
