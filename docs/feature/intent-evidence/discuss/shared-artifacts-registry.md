# Shared Artifacts Registry: Evidence-Backed Intent Authorization

## Artifacts

### evidence_refs
- **Source of truth**: `intent.evidence_refs` field in SurrealDB schema
- **Type**: `option<array<record<decision | task | feature | project | observation | policy | objective | learning | git_commit>>>`
- **Consumers**:
  - Intent creation API (accepts from agent)
  - Evidence verification pipeline (validates each ref)
  - LLM evaluator (receives as enriched context)
  - Risk router (counts verified vs failed for score adjustment)
  - Governance feed UI (displays evidence chain)
  - Audit trail (persisted on intent record)
- **Owner**: Intent system (`app/src/server/intent/`)
- **Integration risk**: HIGH -- mismatch between schema type and verification pipeline expectations breaks the entire evidence flow
- **Validation**: Schema type must match the union of tables the verification pipeline queries

### evidence_verification
- **Source of truth**: `intent.evidence_verification` field in SurrealDB schema
- **Type**: `object { verified_count: int, failed_refs: option<array<string>>, verification_time_ms: int, warnings: option<array<string>> }`
- **Consumers**:
  - Risk router (uses verified_count and failed_refs for score adjustment)
  - LLM evaluator (receives verification summary as context)
  - Governance feed UI (displays verification status per ref)
  - Audit trail (persisted on intent record)
- **Owner**: Evidence verification pipeline (`app/src/server/intent/`)
- **Integration risk**: HIGH -- if verification result shape changes, risk router and feed UI break
- **Validation**: Verify evidence_verification is populated before risk routing proceeds

### evidence_enforcement
- **Source of truth**: `workspace.evidence_enforcement` field in SurrealDB schema
- **Type**: `string` ASSERT `$value IN ['bootstrap', 'soft', 'hard']`
- **Consumers**:
  - Evidence verification pipeline (determines whether to reject or penalize)
  - Risk router (uses enforcement mode for routing logic)
  - Workspace settings UI (displays and allows admin override)
  - Bootstrapping logic (auto-transitions based on maturity threshold)
- **Owner**: Workspace system (`app/src/server/workspace/`)
- **Integration risk**: MEDIUM -- enforcement mode drives pipeline behavior; wrong mode silently changes authorization outcomes
- **Validation**: Default must be "soft" for existing workspaces; "bootstrap" only for new workspaces with zero confirmed decisions

### evidence_enforcement_threshold
- **Source of truth**: `workspace.evidence_enforcement_threshold` field in SurrealDB schema
- **Type**: `option<object> { min_decisions: int, min_tasks: int }`
- **Consumers**:
  - Bootstrapping auto-transition logic
  - Workspace settings UI
- **Owner**: Workspace system
- **Integration risk**: LOW -- only consumed by transition logic
- **Validation**: Defaults: min_decisions=10, min_tasks=5

### risk_tier_evidence_requirements
- **Source of truth**: Constants in evidence verification pipeline (defaults) + policy rules (overrides)
- **Type**: Lookup table: risk_score_range -> { min_count, required_types, independent_author_count }
- **Consumers**:
  - Evidence verification pipeline
  - Risk router
  - Policy evaluation (overrides defaults)
- **Owner**: Intent system + Policy system
- **Integration risk**: MEDIUM -- mismatch between default tiers and policy overrides could create contradictory requirements
- **Validation**: Policy overrides must be at least as strict as defaults (monotonic attenuation)

### valid_evidence_statuses
- **Source of truth**: Constants in evidence verification pipeline
- **Type**: Map of entity_type -> valid_status_set
- **Values**:
  - decision: `["confirmed"]`
  - task: `["in_progress", "completed"]`
  - observation: `["open"]` (with confidence threshold)
  - policy: `["active"]`
  - feature: `["active", "completed"]`
  - project: `["active"]`
  - objective: `["active"]`
  - learning: `["active"]`
  - git_commit: any (commits are immutable)
- **Consumers**:
  - Evidence verification pipeline (liveness check)
- **Owner**: Evidence verification pipeline
- **Integration risk**: MEDIUM -- if a table adds new statuses, this map must be updated
- **Validation**: Cross-reference with SurrealDB schema ASSERT constraints on each table's status field

## Integration Checkpoints

1. **Schema consistency**: `evidence_refs` type on intent table must match the union of tables the verification query can resolve
2. **Verification before LLM**: The evaluation pipeline in `authorizer.ts` must call evidence verification before `llmEvaluator`
3. **Enforcement mode at creation time**: The enforcement mode must be read from workspace at intent evaluation time, not at creation time (enforcement could change between creation and evaluation)
4. **Feed display completeness**: Every field in `evidence_verification` must have a corresponding UI representation in the governance feed
5. **Policy override precedence**: Policy-defined evidence requirements override default tier requirements; the more restrictive rule wins
