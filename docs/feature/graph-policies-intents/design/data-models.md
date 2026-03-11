# Data Models: Graph Policies and Intents

## Existing Schema (No Changes Required)

### Policy Table
```
policy (SCHEMAFULL)
  title: string
  description: option<string>
  version: int
  status: string          -- draft | testing | active | deprecated | superseded
  selector: object        -- { workspace?, agent_role?, resource? }
  rules: array<object>    -- [{ id, condition, effect, priority }]
  human_veto_required: bool
  max_ttl: option<string>
  created_by: record<identity>
  workspace: record<workspace>
  supersedes: option<record<policy>>
  created_at: datetime
  updated_at: option<datetime>
```

### Intent Table
```
intent (SCHEMAFULL)
  goal: string
  reasoning: string
  priority: int
  status: string          -- draft | pending_auth | pending_veto | approved | vetoed | executing | completed | failed
  action_spec: object     -- { provider, action, params? }
  evaluation: option<object>  -- { passed, policy_trace, risk_score, reason, ... }
  veto_expires_at: option<datetime>
  workspace: record<workspace>
  created_at: datetime
  updated_at: option<datetime>
```

### Governance Relation Tables
```
governing   TYPE RELATION IN identity  OUT policy          -- who authored/owns policy
protects    TYPE RELATION IN policy    OUT workspace       -- which workspace policy guards
triggered_by TYPE RELATION IN intent   OUT task            -- which task triggered intent
gates       TYPE RELATION IN intent    OUT agent_session   -- which session intent gates
vetoed_by   TYPE RELATION IN identity  OUT intent          -- who vetoed intent (+ reason, vetoed_at)
```

## Type Changes Required

### EntityKind (contracts.ts)
```
BEFORE: "workspace" | "project" | "person" | "identity" | "feature" | "task" | "decision" | "question" | "observation" | "suggestion" | "message" | "agent_session" | "intent"
AFTER:  + "policy"
```

### GraphEntityTable (queries.ts)
```
BEFORE: "workspace" | "project" | "person" | "identity" | "feature" | "task" | "decision" | "question" | "observation" | "suggestion"
AFTER:  + "intent" | "policy"
```

## Intent Status Filtering (Architectural Note)

The intent table contains records across multiple lifecycle states: `draft`, `pending_auth`, `pending_veto`, `approved`, `vetoed`, `executing`, `completed`, `failed`. The graph view query should include intents scoped to the workspace. Crafter decides whether to filter by status (e.g., exclude `draft` intents) or show all. The feed awareness tier specifically targets `vetoed` intents within a 24h window.

## Entity Name Resolution Map

| Table | Name Field | Display Label |
|-------|-----------|---------------|
| policy | `title` | "Policy" |
| intent | `goal` | "Intent" |

## Graph Edge Taxonomy

### Existing Edges (Already in fn::edges_between)
- `entity_relation`, `belongs_to`, `has_feature`, `has_task`, `has_project`
- `depends_on`, `owns`, `observes`, `suggests_for`, `subtask_of`

### New Governance Edges (To Add)
| Edge | From | To | Visual Style |
|------|------|----|-------------|
| `governing` | identity | policy | Dashed, governance color |
| `protects` | policy | workspace | Dashed, governance color |
| `triggered_by` | intent | task | Solid, authorization color |
| `gates` | intent | agent_session | Solid, authorization color |
| `vetoed_by` | identity | intent | Dashed, warning/deny color |

## Feed Data: Vetoed Intent Row

New query result type for awareness-tier vetoed intents:

```
VetoedIntentRow:
  id: RecordId<"intent">
  goal: string
  status: "vetoed"
  priority: int
  veto_reason: string       -- from vetoed_by edge
  vetoed_at: datetime       -- from vetoed_by edge
  updated_at: datetime      -- for 24h window filter
```

Maps to `GovernanceFeedItem` with:
- `tier`: "awareness"
- `entityKind`: "intent"
- `entityName`: goal
- `reason`: "Vetoed: {veto_reason}"
- `actions`: [] (informational only, already resolved)
