# Data Models: Observer LLM Reasoning

## Schema Changes

### Observation Table — New Fields

The existing `observation` table needs two new optional fields to store LLM reasoning metadata.

```sql
-- New fields on existing observation table
DEFINE FIELD OVERWRITE confidence ON observation TYPE option<float>;
DEFINE FIELD OVERWRITE evidence_refs ON observation TYPE option<array<record<project | feature | task | decision | question | observation | intent | git_commit>>>;
```

| Field | Type | Purpose |
|-------|------|---------|
| `confidence` | `option<float>` | LLM verdict confidence score (0.0-1.0). Absent for deterministic-only observations. |
| `evidence_refs` | `option<array<record<project \| feature \| task \| decision \| question \| observation \| intent \| git_commit>>>` | Entity records referenced in LLM reasoning. Post-validated against workspace. Uses same target types as the `observes` relation. |

### Workspace Table — New Settings Field

The `workspace` table gets a `settings` object field for per-workspace configuration. This is a general-purpose settings field that other features can extend.

```sql
DEFINE FIELD OVERWRITE settings ON workspace TYPE option<object>;
DEFINE FIELD OVERWRITE settings.observer_skip_deterministic ON workspace TYPE option<bool>;
```

| Field | Type | Purpose |
|-------|------|---------|
| `settings` | `option<object>` | Per-workspace configuration. Extensible for future settings. |
| `settings.observer_skip_deterministic` | `option<bool>` | When `true`, skip LLM when deterministic verdict is match + CI passing. Defaults to `true` when absent. |

### No New Tables Required

The existing schema already supports all needed structures:
- `observation` table has `observation_type` with `contradiction`, `pattern`, `validation` values
- `observes` relation supports `observation -> project | feature | task | decision | question | intent | git_commit | observation`
- `observation.source` field (option<string>) can hold `llm`, `deterministic_fallback`, `github`, `peer_review`
- `observation.data` field (option<object> FLEXIBLE) available for additional structured metadata if needed

### Observation Types Used

| observation_type | Source Pipeline | When Created |
|-----------------|----------------|--------------|
| `contradiction` | Semantic verification | LLM detects mismatch between decision and task/implementation |
| `validation` | Semantic verification, peer review | LLM confirms match or reviews another observation |
| `pattern` | Pattern synthesis | LLM correlates anomalies into named systemic pattern |
| `anomaly` | Graph scan (existing) | Deterministic detection of stale blockers, status drift |

### Observation Source Values

| source | Meaning |
|--------|---------|
| `llm` | Verdict produced by LLM reasoning |
| `github` | Verdict produced by deterministic check with GitHub CI confirmation |
| `deterministic_fallback` | LLM was attempted but failed; deterministic verdict used |
| `peer_review` | Deterministic peer review (legacy, pre-LLM) |
| `none` | No external source (intent verification, etc.) |

## Migration Script

File: `schema/migrations/NNNN_observer_llm_fields.surql`

```sql
BEGIN TRANSACTION;

-- Add confidence score for LLM verdicts
DEFINE FIELD OVERWRITE confidence ON observation TYPE option<float>;

-- Add evidence references from LLM reasoning
DEFINE FIELD OVERWRITE evidence_refs ON observation TYPE option<array<record<project | feature | task | decision | question | observation | intent | git_commit>>>;

-- Add per-workspace settings (extensible object)
DEFINE FIELD OVERWRITE settings ON workspace TYPE option<object>;
DEFINE FIELD OVERWRITE settings.observer_skip_deterministic ON workspace TYPE option<bool>;

COMMIT TRANSACTION;
```

The migration number will be determined by scanning `schema/migrations/` for the highest existing prefix at implementation time.

## Multiple Observes Edges

The current `createObservation` function creates a single `observes` edge via `relatedRecord`. LLM reasoning needs to create multiple edges (e.g., observation -> task AND observation -> decision for a contradiction).

The observation writer will be extended to accept an array of related records and create one `observes` edge per target. This is a modification to `observation/queries.ts`, not a schema change — the `observes` relation already supports all needed target types.

## Structured Output Schemas (Zod)

These schemas are defined in code (`observer/schemas.ts`), not in the database. They constrain the LLM's JSON output via Vercel AI SDK `generateObject`.

### Verification Verdict Schema

```
LlmVerdict:
  verdict: "match" | "mismatch" | "inconclusive"
  confidence: float (0.0-1.0)
  reasoning: string (natural language explanation)
  evidence_refs: string[] (table:id format, parsed to RecordId[] before DB write)
  contradiction?: { claim: string, reality: string }
```

### Synthesis Pattern Schema

```
SynthesisPattern:
  pattern_name: "bottleneck_decision" | "cascade_block" | "priority_drift" | "stale_cluster" | "contradiction_cluster"
  description: string (natural language synthesis)
  contributing_entities: string[] (entity IDs, minimum 2)
  severity: "warning" | "conflict"
  suggested_action: string
```

### Peer Review Verdict Schema

```
PeerReviewVerdict:
  verdict: "sound" | "questionable" | "unsupported"
  confidence: float (0.0-1.0)
  reasoning: string (evidence evaluation)
```
