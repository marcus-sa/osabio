# Shared Artifacts Registry: Dynamic Behavior Definitions

## Purpose
Every `${variable}` in the journey visualizations and TUI mockups has a single source of truth documented here. Untracked artifacts cause horizontal integration failures.

---

## Behavior Definition Artifacts

### definition_title
- **Source of truth**: `behavior_definition` table, `title` field
- **Consumers**: Library card title, Definition detail page header, Score detail "Definition" label, Trend dashboard label, Feed items referencing the definition, Scorer Agent context
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: HIGH -- title mismatch between library and score views breaks user trust
- **Validation**: Title must be identical wherever the definition is referenced by ID

### definition_goal
- **Source of truth**: `behavior_definition` table, `goal` field
- **Consumers**: Definition detail page, Scorer Agent evaluation context, Definition edit form
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: MEDIUM -- goal is consumed by Scorer Agent; stale goal produces inconsistent scoring
- **Validation**: When definition is edited, version increments; Scorer must use version-matched goal

### scoring_logic
- **Source of truth**: `behavior_definition` table, `scoring_logic` field
- **Consumers**: Definition detail page, Scorer Agent evaluation context, Score rationale (implicit reference), Definition edit form
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: HIGH -- scoring_logic drives the Scorer Agent's evaluation; mismatch between displayed logic and actual scoring is a trust violation
- **Validation**: Scorer Agent must include the definition_version in score provenance so users can verify which logic version produced a given score

### definition_status
- **Source of truth**: `behavior_definition` table, `status` field (values: `draft`, `active`, `archived`)
- **Consumers**: Library card badge, Library filter, Scorer matching logic (only `active` definitions are scored), Feed items
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: HIGH -- if status is `draft` in DB but shown as `active` in UI, the Scorer will not score against it, confusing the admin
- **Validation**: UI badge must reflect DB state; Scorer queries must filter by `status = 'active'`

### definition_version
- **Source of truth**: `behavior_definition` table, `version` field (integer, incremented on edit)
- **Consumers**: Definition detail page, Score provenance (behavior.source_telemetry.definition_version), Definition edit confirmation
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: MEDIUM -- without version tracking, admin cannot determine which scoring logic produced a historical score
- **Validation**: Every behavior record must include `definition_version` in source_telemetry

### scoring_mode
- **Source of truth**: `behavior_definition` table, `scoring_mode` field (values: `llm`, `deterministic`)
- **Consumers**: Library card badge, Scorer dispatch logic (LLM vs deterministic path), Definition creation form
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: MEDIUM -- incorrect mode badge would mislead admin about how scoring works
- **Validation**: Badge text matches DB field

### telemetry_types
- **Source of truth**: `behavior_definition` table, `telemetry_types` field (array of strings)
- **Consumers**: Definition detail page, Telemetry-to-definition matching logic, No-match warning (E2), Definition creation form checkboxes
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: HIGH -- if matching logic uses different telemetry type names than what is displayed, events will silently fail to match
- **Validation**: Telemetry type names must come from a shared enum/constant used by both UI and matcher

---

## Behavior Score Artifacts

### score_value
- **Source of truth**: `behavior` table, `score` field (number 0.0-1.0)
- **Consumers**: Score timeline chart, Score detail card, Trend analysis, Policy predicates (behavior_scores dot-path), Authorizer context enrichment, Feed items
- **Owner**: Scorer Agent (producer), Behavior CRUD queries (persistence)
- **Integration risk**: HIGH -- score drives policy decisions; any drift between persisted value and what Authorizer reads is a governance failure
- **Validation**: Score in behavior record must exactly match what Authorizer reads via enrichBehaviorScores()

### score_rationale
- **Source of truth**: `behavior` table, `source_telemetry.rationale` field
- **Consumers**: Score detail view, Score detail modal, Observer context for root cause analysis
- **Owner**: Scorer Agent (producer)
- **Integration risk**: MEDIUM -- rationale is the transparency mechanism; missing rationale erodes admin trust
- **Validation**: Every behavior record with scoring_mode=llm must have a non-empty rationale

### score_timestamp
- **Source of truth**: `behavior` table, `created_at` field
- **Consumers**: Score timeline chart X-axis, Score detail card, Trend analysis ordering
- **Owner**: Behavior CRUD queries (set at creation time)
- **Integration risk**: LOW -- timestamp is set once at creation and is append-only
- **Validation**: Timestamps must be monotonically increasing for a given identity+definition

### acting_identity
- **Source of truth**: `identity` table, traversed via `exhibits` edge from behavior record
- **Consumers**: Score detail card identity label, Per-agent trend breakdown, Feed items
- **Owner**: Behavior CRUD queries (exhibits edge creation)
- **Integration risk**: MEDIUM -- wrong identity linkage means wrong agent is blamed/restricted
- **Validation**: exhibits edge `in` field must match the identity that produced the telemetry event

### behavior_node_id
- **Source of truth**: `behavior` table, `id` field (RecordId)
- **Consumers**: exhibits edge target, Score detail deep link, Observer scan, Graph visualization
- **Owner**: Behavior CRUD queries
- **Integration risk**: LOW -- auto-generated, append-only
- **Validation**: Format follows existing convention: `beh-${uuid}`

### behavior_definition_id
- **Source of truth**: `behavior_definition` table, `id` field (RecordId)
- **Consumers**: Score provenance (link from behavior record to definition), Definition detail navigation, Scorer Agent definition lookup
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: HIGH -- a behavior record must be traceable to the definition that produced it
- **Validation**: Every behavior record must reference the definition ID (new field or in source_telemetry)

---

## Policy and Enforcement Artifacts

### threshold_value
- **Source of truth**: Policy rule predicate (e.g., `behavior_scores.Honesty >= 0.50`)
- **Consumers**: Feed item restriction detail, Restriction override confirmation, Recovery criteria
- **Owner**: Policy module
- **Integration risk**: HIGH -- if the threshold displayed in the feed differs from the actual policy predicate, admin makes decisions on wrong information
- **Validation**: Feed item must extract threshold from the actual policy rule, not hardcode

### restricted_scopes
- **Source of truth**: Policy evaluation result (list of denied scopes)
- **Consumers**: Feed item, Agent denial response, Recovery tracking
- **Owner**: Authorizer module
- **Integration risk**: HIGH -- agent must receive the same scope list as what is shown in the feed
- **Validation**: Denied scopes in agent response must match feed item

### retained_scopes
- **Source of truth**: Policy evaluation result (list of allowed scopes despite restriction)
- **Consumers**: Feed item, Agent capabilities
- **Owner**: Authorizer module
- **Integration risk**: MEDIUM -- agent and admin must agree on what the agent can still do
- **Validation**: Retained scopes must be the complement of restricted scopes within the agent's normal scope set

### policy_rule
- **Source of truth**: `policy` table, rule containing `behavior_scores` predicate
- **Consumers**: Authorizer evaluation, Feed item detail, Restriction provenance
- **Owner**: Policy module
- **Integration risk**: MEDIUM -- rule must support dynamic metric type names (not only hardcoded enum)
- **Validation**: Policy predicate parser must accept any string as metric name in behavior_scores.{name}

---

## Learning and Recovery Artifacts

### learning_title
- **Source of truth**: `learning` table, `title` field
- **Consumers**: Feed item, Learning Library card, Agent prompt injection
- **Owner**: Observer (producer), Learning CRUD (persistence)
- **Integration risk**: MEDIUM -- title is human-facing; inconsistency is confusing but not a governance failure
- **Validation**: Title in feed must match title in Learning Library

### learning_content
- **Source of truth**: `learning` table, `content` field
- **Consumers**: Learning detail view, Agent prompt injection (JIT loader)
- **Owner**: Observer (producer), Admin (editor)
- **Integration risk**: HIGH -- content is what actually shapes agent behavior; stale content is a governance failure
- **Validation**: JIT loader must read from DB at session start, not cache

### learning_status
- **Source of truth**: `learning` table, `status` field (values: `proposed`, `active`, `deactivated`, `dismissed`)
- **Consumers**: Learning Library filter, Feed item badge, Agent prompt loader (only loads `active`)
- **Owner**: Learning CRUD module
- **Integration risk**: HIGH -- if status shows `active` but loader skips it, the learning has no effect
- **Validation**: Prompt loader must query `status = 'active'`; UI must reflect DB state

### root_cause_hypothesis
- **Source of truth**: Observer analysis output (stored in learning provenance or linked observation)
- **Consumers**: Learning provenance view, Feed item detail
- **Owner**: Observer agent
- **Integration risk**: LOW -- informational, not governance-critical
- **Validation**: Must be persisted, not ephemeral

### target_agent
- **Source of truth**: `learning` table, `target_agent` or scope field
- **Consumers**: Learning scope label, Prompt loader agent filter, Feed item
- **Owner**: Observer (producer), Admin (can modify)
- **Integration risk**: MEDIUM -- wrong target means wrong agent gets the learning
- **Validation**: Target must match an existing identity in the workspace

---

## Community Template Artifacts

### community_template_list
- **Source of truth**: `behavior_definition_template` table (system-level, no workspace filter)
- **Consumers**: Library page template section
- **Owner**: System/platform (not workspace-specific)
- **Integration risk**: LOW -- templates are read-only starting points
- **Validation**: Templates must produce valid definitions when used

### active_definition_count
- **Source of truth**: `behavior_definition` table, `COUNT(*) WHERE status = 'active' AND workspace = $ws`
- **Consumers**: Library page header, Navigation badge (optional)
- **Owner**: Behavior Definition CRUD module
- **Integration risk**: LOW -- display-only metric
- **Validation**: Count must reflect actual DB state

---

## Integration Checkpoints

| Checkpoint | Artifacts Involved | Validation |
|------------|-------------------|------------|
| Definition creation | definition_title, definition_goal, scoring_logic, scoring_mode, telemetry_types | All persisted in single transaction; validation preview runs before persist |
| Telemetry matching | telemetry_types, definition_status | Only active definitions matched; telemetry type names use shared enum |
| Score persistence | score_value, score_rationale, behavior_definition_id, acting_identity, definition_version | All fields present; exhibits edge created atomically |
| Authorizer enrichment | score_value, threshold_value, policy_rule | enrichBehaviorScores() returns dynamic metric names; policy parser accepts them |
| Feed item generation | All restriction artifacts | Feed item data extracted from actual evaluation result, not hardcoded |
| Learning proposal | learning_title, learning_content, target_agent, root_cause_hypothesis | Observer references specific behavior record and definition |
| Learning injection | learning_content, learning_status, target_agent | JIT loader reads active learnings for target identity at session start |
| Recovery detection | score_value, threshold_value, restored_scopes | Authorizer uses same threshold for restriction and recovery |
