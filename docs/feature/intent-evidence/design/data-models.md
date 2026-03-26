# Data Models: Evidence-Backed Intent Authorization

## Schema Changes

### Intent Table -- New Fields

```sql
-- Evidence references: typed polymorphic array of graph records
DEFINE FIELD OVERWRITE evidence_refs ON intent
  TYPE option<array<record<decision | task | feature | project | observation | policy | objective | learning | git_commit>>>;

-- Evidence verification result: stored after verification pipeline completes
DEFINE FIELD OVERWRITE evidence_verification ON intent TYPE option<object>;
DEFINE FIELD OVERWRITE evidence_verification.verified_count ON intent TYPE int;
DEFINE FIELD OVERWRITE evidence_verification.failed_refs ON intent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE evidence_verification.verification_time_ms ON intent TYPE int;
DEFINE FIELD OVERWRITE evidence_verification.warnings ON intent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE evidence_verification.independent_author_count ON intent TYPE option<int>;
DEFINE FIELD OVERWRITE evidence_verification.tier_met ON intent TYPE option<bool>;
DEFINE FIELD OVERWRITE evidence_verification.enforcement_mode ON intent TYPE option<string>
  ASSERT $value = NONE OR $value IN ['bootstrap', 'soft', 'hard'];
```

### Workspace Table -- New Fields

```sql
-- Evidence enforcement mode: controls pipeline behavior
DEFINE FIELD OVERWRITE evidence_enforcement ON workspace TYPE option<string>
  ASSERT $value = NONE OR $value IN ['bootstrap', 'soft', 'hard'];

-- Evidence enforcement maturity threshold: triggers auto-transition
DEFINE FIELD OVERWRITE evidence_enforcement_threshold ON workspace TYPE option<object>;
DEFINE FIELD OVERWRITE evidence_enforcement_threshold.min_decisions ON workspace TYPE option<int>;
DEFINE FIELD OVERWRITE evidence_enforcement_threshold.min_tasks ON workspace TYPE option<int>;
```

## TypeScript Type Contracts

### EvidenceVerificationResult

This is the sole output contract of the evidence verification pipeline. Consumed by: risk router, LLM evaluator context, intent record storage, feed display.

```
EvidenceVerificationResult:
  verified_count: number           -- count of refs that passed all checks
  total_count: number              -- total refs submitted
  failed_refs?: string[]           -- "table:id" strings of refs that failed (with reason prefix)
  verification_time_ms: number     -- wall-clock time for the full pipeline
  warnings?: string[]              -- non-fatal issues (e.g. "evidence near minimum age")
  independent_author_count?: number -- count of distinct non-requester authors (Release 2)
  tier_met?: boolean               -- whether risk-tier evidence requirements are satisfied (Release 2)
  enforcement_mode: EvidenceEnforcementMode -- mode used for this evaluation
```

### EvidenceEnforcementMode

```
EvidenceEnforcementMode: "bootstrap" | "soft" | "hard"
```

### EvidenceRef (parsed)

```
ParsedEvidenceRef:
  table: string      -- entity table name (from allowlist)
  id: string         -- record ID
  record: RecordId   -- constructed RecordId for SurrealDB query
```

### RiskTierRequirements

```
RiskTierRequirements:
  min_count: number                    -- minimum total evidence refs
  required_types?: string[]            -- at least one ref must be of these types
  independent_author_count?: number    -- minimum distinct non-requester authors
```

### Tier Requirement Defaults

```
Risk Score 0-30 (low):
  min_count: 1
  required_types: (any)
  independent_author_count: 0

Risk Score 31-70 (medium):
  min_count: 2
  required_types: ["decision", "task"]
  independent_author_count: 1

Risk Score 71-100 (high):
  min_count: 3
  required_types: ["decision", "task", "observation"]
  independent_author_count: 2
```

### Valid Evidence Statuses

Maps entity type to the set of statuses considered "live" (not stale, superseded, or terminal):

```
decision:    ["confirmed"]
task:        ["in_progress", "completed", "done"]
observation: ["open"]
policy:      ["active"]
feature:     ["active", "in_progress"]
project:     ["active"]
objective:   ["active"]
learning:    ["active"]
git_commit:  (any -- commits are immutable)
```

### Table Allowlist

Extends the existing `VALID_TABLES` from `observer/evidence-validator.ts`:

```
"decision", "task", "feature", "project", "observation",
"policy", "objective", "learning", "git_commit"
```

Excluded tables (never valid as evidence): `identity`, `workspace`, `conversation`, `message`, `agent_session`, `trace`, `intent`, `proxy_token`, `audit_event`.

Note: `intent` is excluded from evidence to prevent circular self-referencing.

### MCP Tool Schema Extension

The `createIntentSchema` in `brain-tool-definitions.ts` gains an optional `evidence_refs` field:

```
createIntentSchema (extended):
  goal: string
  reasoning: string
  action_spec: { provider, action, params? }
  evidence_refs?: string[]   -- array of "table:id" strings (e.g. ["decision:abc123", "task:def456"])
```

The `CREATE_INTENT_TOOL` description must guide agents:
```
"Create an intent to request authorization for a gated tool.
Use this when a tool you need is marked as [GATED].
Provide the goal, reasoning, and action_spec describing the tool you want to use.

Optionally include evidence_refs — an array of graph entity IDs (e.g.
['decision:abc123', 'task:def456']) that justify this action. Evidence
references are verified against the knowledge graph: they must exist in
your workspace, have valid status, and predate the intent. Under soft
enforcement, missing evidence raises your risk score. Under hard
enforcement, insufficient evidence causes rejection before evaluation.
Valid entity types: decision, task, observation, feature, project,
policy, objective, learning, git_commit."
```

The `CreateIntentInput` type in `create-intent-handler.ts` mirrors the schema:

```
CreateIntentInput (extended):
  goal: string
  reasoning: string
  action_spec: { provider, action, params? }
  evidence_refs?: string[]   -- raw table:id strings from agent
```

The handler's `validateInput` parses each ref string into a `RecordId` at the HTTP boundary, validating the table against the allowlist.

### IntentRecord Extension

The existing `IntentRecord` type gains two optional fields:

```
IntentRecord (extended):
  ... existing fields ...
  evidence_refs?: RecordId[]     -- submitted by agent
  evidence_verification?: {      -- populated by verification pipeline
    verified_count: number
    failed_refs?: string[]
    verification_time_ms: number
    warnings?: string[]
    independent_author_count?: number
    tier_met?: boolean
    enforcement_mode: string
  }
```

### StatusUpdateFields Extension

```
StatusUpdateFields (extended):
  ... existing fields ...
  evidence_verification?: EvidenceVerificationResult
```

### IntentEvaluationContext Extension

The policy gate context gains an evidence summary so policy rules can reference evidence state:

```
IntentEvaluationContext (extended):
  ... existing fields ...
  evidence_verified_count?: number
  evidence_tier_met?: boolean
```

### EvaluateIntentInput Extension

```
EvaluateIntentInput (extended):
  ... existing fields ...
  evidence_refs?: RecordId[]
  workspaceEnforcementMode?: EvidenceEnforcementMode
```

## Batch Query Design

The evidence verification pipeline executes a **single SurrealDB query** that resolves all refs in one round-trip. The query shape:

```sql
-- For each ref, SELECT existence + workspace + status + created_at + author fields
-- All refs batched into a single query using $refs parameter
SELECT id, workspace, status, created_at,
  -- Author resolution varies by table:
  -- decision: decided_by / confirmed_by
  -- task: owner
  -- observation: source_agent (identity via session)
  -- Others: created_by or NONE
FROM $refs;
```

Since SurrealDB supports `SELECT ... FROM $record` where `$record` is a RecordId, and we can batch multiple RecordIds, the query resolves all refs in O(1) round-trips regardless of ref count (capped at 10).

For authorship resolution (Release 2), the batch query includes the author-relevant fields per entity type. The pure pipeline maps these to a unified author identity for independence checking.

## Migration Strategy

### Release 1 Migration (Walking Skeleton + Core Verification)

```sql
BEGIN TRANSACTION;

-- Intent: evidence_refs and basic verification result
DEFINE FIELD OVERWRITE evidence_refs ON intent
  TYPE option<array<record<decision | task | feature | project | observation | policy | objective | learning | git_commit>>>;
DEFINE FIELD OVERWRITE evidence_verification ON intent TYPE option<object>;
DEFINE FIELD OVERWRITE evidence_verification.verified_count ON intent TYPE int;
DEFINE FIELD OVERWRITE evidence_verification.failed_refs ON intent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE evidence_verification.verification_time_ms ON intent TYPE int;
DEFINE FIELD OVERWRITE evidence_verification.warnings ON intent TYPE option<array<string>>;

-- Workspace: enforcement mode
DEFINE FIELD OVERWRITE evidence_enforcement ON workspace TYPE option<string>
  ASSERT $value = NONE OR $value IN ['bootstrap', 'soft', 'hard'];

COMMIT TRANSACTION;
```

### Release 2 Migration (Fabrication Resistance)

```sql
BEGIN TRANSACTION;

-- Extended verification fields
DEFINE FIELD OVERWRITE evidence_verification.independent_author_count ON intent TYPE option<int>;
DEFINE FIELD OVERWRITE evidence_verification.tier_met ON intent TYPE option<bool>;
DEFINE FIELD OVERWRITE evidence_verification.enforcement_mode ON intent TYPE option<string>
  ASSERT $value = NONE OR $value IN ['bootstrap', 'soft', 'hard'];

-- Workspace: maturity thresholds
DEFINE FIELD OVERWRITE evidence_enforcement_threshold ON workspace TYPE option<object>;
DEFINE FIELD OVERWRITE evidence_enforcement_threshold.min_decisions ON workspace TYPE option<int>;
DEFINE FIELD OVERWRITE evidence_enforcement_threshold.min_tasks ON workspace TYPE option<int>;

COMMIT TRANSACTION;
```

Note: Per project convention, no backwards compatibility or data migration needed. Schema changes are breaking; old data is discarded.
