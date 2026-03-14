# Shared Artifacts Registry: Objective & Behavior Nodes

## Objective Node Artifacts

### objective_id
- **Source of truth**: `objective` table in SurrealDB (record ID)
- **Consumers**: supports edge (intent->objective), progress view, alignment report, feed cards, coherence auditor
- **Owner**: Graph layer (objective CRUD)
- **Integration risk**: HIGH -- ID mismatch breaks all downstream references
- **Validation**: RecordId round-trip test: raw -> RecordId -> raw

### objective_title
- **Source of truth**: `objective.title` field
- **Consumers**: feed cards (alignment warning, progress), chat responses, alignment report, progress view
- **Owner**: Extraction pipeline (creates from chat) or direct creation
- **Integration risk**: MEDIUM -- display inconsistency confuses users
- **Validation**: Title in feed card matches source record

### objective_target_date
- **Source of truth**: `objective.target_date` field (datetime)
- **Consumers**: progress view, coherence auditor (staleness/expiry check), alignment report
- **Owner**: Objective node (set at creation, updatable)
- **Integration risk**: MEDIUM -- missed expiry leaves stale objectives active
- **Validation**: Coherence auditor checks target_date against current date

### objective_success_criteria
- **Source of truth**: `objective.success_criteria` field (array of strings)
- **Consumers**: progress view (key results tracking), alignment report
- **Owner**: Objective node
- **Integration risk**: LOW -- display only, no downstream logic depends on it
- **Validation**: Array not empty for active objectives

### objective_status
- **Source of truth**: `objective.status` field (active | expired | completed | archived)
- **Consumers**: Authorizer (only matches against "active" objectives), progress view, coherence auditor
- **Owner**: Objective lifecycle (human transitions, auditor auto-expires)
- **Integration risk**: HIGH -- status mismatch could cause false alignment warnings or missed enforcement
- **Validation**: Only "active" objectives appear in authorizer's matching pool

### objective_priority
- **Source of truth**: `objective.priority` field (int 0-100)
- **Consumers**: Alignment report (ordering), progress view, intent disambiguation (higher priority preferred)
- **Owner**: Objective node (human-set)
- **Integration risk**: LOW -- affects display ordering only
- **Validation**: Value within 0-100 range

### objective_progress
- **Source of truth**: Computed aggregation (supporting intent count, related task completion, key result metrics)
- **Consumers**: Progress view (progress bar), alignment report
- **Owner**: Computed at read time (not stored)
- **Integration risk**: MEDIUM -- computation must include all supports edges
- **Validation**: Progress percentage between 0-100, consistent with supporting data

### alignment_score
- **Source of truth**: Computed at intent authorization time (vector similarity between intent.goal and objective embeddings)
- **Consumers**: Authorizer evaluation (threshold check), feed warning cards, alignment report
- **Owner**: Authorizer Agent (computed, not stored permanently -- logged in intent evaluation)
- **Integration risk**: HIGH -- threshold mismatch between authorizer and feed card display
- **Validation**: Score in feed card matches score in intent evaluation record

---

## Behavior Node Artifacts

### behavior_id
- **Source of truth**: `behavior` table in SurrealDB (record ID)
- **Consumers**: exhibits edge (identity->behavior), dashboard, policy evaluation, Observer behavior extension
- **Owner**: Observer Agent (writes after each agent session)
- **Integration risk**: HIGH -- ID mismatch breaks exhibits edge and policy queries
- **Validation**: RecordId round-trip test

### metric_type
- **Source of truth**: `behavior.metric_type` field (string enum: TDD_Adherence, Security_First, Review_Responsiveness, etc.)
- **Consumers**: dashboard columns, policy rule conditions, learning evidence context, observer agent write target
- **Owner**: Defined by human (Tomasz) via chat, used by Observer Agent
- **Integration risk**: HIGH -- metric_type string must match exactly between behavior record, policy condition, and dashboard query
- **Validation**: Enum consistency check: all metric_types in policy conditions exist in behavior records

### behavior_score
- **Source of truth**: `behavior.score` field (float 0.0-1.0)
- **Consumers**: dashboard cells, policy evaluation (threshold comparison), trend computation, Observer behavior extension
- **Owner**: Observer Agent (computes from session telemetry)
- **Integration risk**: HIGH -- score used in policy enforcement decisions
- **Validation**: Score in dashboard matches score in behavior record; score used by authorizer matches latest behavior record

### source_telemetry
- **Source of truth**: `behavior.source_telemetry` field (object with session-specific metrics)
- **Consumers**: dashboard detail view (expandable), learning evidence context, Observer behavior extension reasoning
- **Owner**: Observer Agent (collects from agent session data)
- **Integration risk**: LOW -- display only, not used in enforcement decisions
- **Validation**: Contains session reference for traceability

### behavior_trend
- **Source of truth**: Computed from behavior score history (last N records per identity+metric_type)
- **Consumers**: dashboard trend column (UP/DOWN/FLAT), Observer behavior extension trigger
- **Owner**: Computed at read time
- **Integration risk**: MEDIUM -- trend direction affects Observer behavior extension learning proposals
- **Validation**: Trend computed from minimum 3 data points; direction matches score progression

### policy_threshold
- **Source of truth**: `policy.rules[*].condition` (behavior metric threshold value)
- **Consumers**: dashboard threshold markers, authorizer policy evaluation, feed card veto reasoning
- **Owner**: Policy node (human-defined)
- **Integration risk**: HIGH -- threshold in policy must match threshold used in authorizer evaluation
- **Validation**: Threshold displayed in feed card matches policy record; threshold in dashboard matches policy record

---

## Cross-Journey Artifacts

### identity_name
- **Source of truth**: `identity.name` field
- **Consumers**: Strategic alignment feed cards, behavior dashboard rows, learning nodes, alignment report, veto feed cards
- **Owner**: Identity table (existing infrastructure)
- **Integration risk**: MEDIUM -- name displayed in multiple views must be consistent
- **Validation**: Name in feed card matches identity record

### intent_id
- **Source of truth**: `intent` table in SurrealDB (record ID)
- **Consumers**: supports edge (intent->objective), authorization flow, feed cards, alignment report
- **Owner**: Intent system (existing infrastructure)
- **Integration risk**: HIGH -- existing artifact, new consumers (supports edge)
- **Validation**: Existing RecordId contract applies

### policy_id
- **Source of truth**: `policy` table in SurrealDB (record ID)
- **Consumers**: Authorizer evaluation, feed cards (veto reasoning), policy management view
- **Owner**: Policy system (existing infrastructure, extended with behavior conditions)
- **Integration risk**: MEDIUM -- existing artifact, new condition types (behavior thresholds)
- **Validation**: Policy with behavior conditions evaluable by authorizer

### learning_text
- **Source of truth**: `learning.text` field (text string)
- **Consumers**: JIT prompt injection (500-token budget), Learning Library UI
- **Owner**: Observer Agent (proposes with status "pending_approval"), human (approves/creates directly)
- **Integration risk**: MEDIUM -- text must be injected correctly via JIT prompt loading; constraints always included, instructions by priority, precedents by semantic similarity
- **Validation**: Learning with status "active" referenced in agent session context via JIT injection

### learning_type
- **Source of truth**: `learning.learning_type` field (constraint | instruction | precedent)
- **Consumers**: Three-layer collision detection, JIT loading priority order, Learning Library filter
- **Owner**: Learning table (set at creation)
- **Integration risk**: MEDIUM -- type determines collision thresholds and injection priority
- **Validation**: Enum value matches one of: constraint, instruction, precedent

### learning_status
- **Source of truth**: `learning.status` field (active | pending_approval | dismissed | superseded | deactivated)
- **Consumers**: JIT prompt injection (filters to "active" only), Learning Library lifecycle, Observer proposal pipeline
- **Owner**: Learning lifecycle (agent proposes as "pending_approval", human transitions)
- **Integration risk**: HIGH -- only "active" learnings injected; status mismatch could inject dismissed/deactivated learnings
- **Validation**: JIT injection query filters on status = "active"; lifecycle transitions logged with timestamp

### learning_evidence_edge
- **Source of truth**: `learning_evidence` relation table (learning -> observation | message | trace | agent_session | behavior)
- **Consumers**: Learning Library detail view (evidence links), effectiveness tracking
- **Owner**: Observer Agent (creates evidence edges when proposing behavior-triggered learnings)
- **Integration risk**: LOW -- display and traceability only
- **Validation**: Evidence edges reference valid behavior records

### learning_target_agents
- **Source of truth**: `learning.target_agents` field (array of agent identity strings)
- **Consumers**: JIT prompt injection (scopes learning to specific agents), Learning Library filter
- **Owner**: Observer Agent (sets based on behavior analysis), human (can override)
- **Integration risk**: MEDIUM -- agent identity strings must match identity table names exactly
- **Validation**: All values in target_agents correspond to existing identity records

### supersedes_edge
- **Source of truth**: `supersedes` relation table (new learning -> old learning)
- **Consumers**: Learning Library (shows supersession chain), JIT injection (skips superseded learnings)
- **Owner**: Observer Agent or human (when creating replacement learnings)
- **Integration risk**: LOW -- lifecycle management only
- **Validation**: Superseded learning status transitions to "superseded"

---

## Integration Risk Summary

| Risk Level | Artifacts | Mitigation |
|-----------|-----------|------------|
| HIGH | objective_id, objective_status, alignment_score, behavior_id, metric_type, behavior_score, policy_threshold, intent_id, learning_status | RecordId round-trip tests, enum consistency checks, threshold matching assertions, JIT injection status filter |
| MEDIUM | objective_title, objective_target_date, objective_progress, behavior_trend, identity_name, policy_id, learning_text, learning_type, learning_target_agents | Display consistency tests, computation validation, collision detection threshold checks |
| LOW | objective_success_criteria, objective_priority, source_telemetry, learning_evidence_edge, supersedes_edge | Manual verification sufficient |

## New Relation Tables Required

| Relation | Type | In | Out | Purpose | Status |
|----------|------|-----|------|---------|--------|
| `supports` | RELATION | intent | objective | Links agent intent to business objective | New (this feature) |
| `exhibits` | RELATION | identity | behavior | Links agent identity to behavior record | New (this feature) |
| `governed_by` | RELATION | behavior | policy | Links behavior metric to governing policy | New (this feature) |
| `learning_evidence` | RELATION | learning | observation, message, trace, agent_session, behavior | Links learning to evidence sources | Existing (PR #145) |
| `supersedes` | RELATION | learning | learning | Links new learning to old learning it replaces | Existing (PR #145) |
