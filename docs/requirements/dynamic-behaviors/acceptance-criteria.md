# Acceptance Criteria: Dynamic Behavior Definitions

## Traceability Matrix

| Story | Job | Journey | Scenarios | Priority |
|-------|-----|---------|-----------|----------|
| US-DB-001 | Job 1 | Define-and-Monitor Steps 1-3 | 5 | Must Have |
| US-DB-002 | Job 2 | Reflex Circuit Steps 1-3 | 5 | Must Have |
| US-DB-003 | Job 3 | Reflex Circuit Steps 4, 7 | 4 | Must Have |
| US-DB-004 | Job 3 | Reflex Circuit Steps 5-6 | 4 | Must Have |
| US-DB-005 | Job 1 | Define-and-Monitor Steps 1-2 | 5 | Should Have |
| US-DB-006 | Job 1, 2 | Define-and-Monitor Steps 4-5 | 3 | Should Have |
| US-DB-007 | Job 3 | Reflex Circuit Step 4 (variant) | 4 | Could Have |

---

## US-DB-001: Behavior Definition Schema and CRUD

### AC-001.1: Schema Creation
Derived from: Scenario "Create a behavior definition"
- behavior_definition table exists in SurrealDB with SCHEMAFULL mode
- Required fields: title (string), goal (string), scoring_logic (string), scoring_mode (string enum: llm | deterministic), telemetry_types (array of strings), status (string enum: draft | active | archived), version (int, default 1), workspace (record reference)
- Optional fields: category (string)
- created_at and updated_at timestamps auto-set

### AC-001.2: CRUD API Endpoints
Derived from: Scenarios "Create", "Activate", "Archive", "Edit"
- POST /api/workspaces/:workspaceId/behavior-definitions creates a definition with status "draft"
- GET /api/workspaces/:workspaceId/behavior-definitions lists definitions, filterable by status
- GET /api/workspaces/:workspaceId/behavior-definitions/:id returns single definition
- PUT /api/workspaces/:workspaceId/behavior-definitions/:id updates fields, increments version if status is "active"
- Definition is workspace-scoped (workspace field set from URL parameter)

### AC-001.3: Status Lifecycle
Derived from: Scenarios "Activate", "Archive"
- Valid transitions: draft -> active, active -> archived, draft -> archived
- Invalid transitions are rejected with 400 error
- Archiving preserves all existing behavior records referencing this definition

### AC-001.4: Validation
Derived from: Scenario "Reject creation with missing goal"
- Creation fails with 400 if goal is empty or missing
- Creation fails with 400 if title is empty or missing
- Creation fails with 400 if telemetry_types is empty

### AC-001.5: Version Increment
Derived from: Scenario "Edit active definition increments version"
- When an active definition's goal, scoring_logic, or telemetry_types are updated, version increments by 1
- Editing a draft definition does not increment version

---

## US-DB-002: Scorer Agent -- Evaluate Telemetry Against Definitions

### AC-002.1: Telemetry Matching
Derived from: Scenarios "Score telemetry", "No matching definitions"
- Incoming telemetry events are matched to active behavior definitions by telemetry_type
- Only definitions with status "active" are matched
- If no definitions match the telemetry type, no evaluation is triggered

### AC-002.2: Context Assembly
Derived from: Scenario "Score telemetry against matching definition"
- Scorer Agent receives: definition goal, definition scoring_logic, telemetry event payload, graph evidence for referenced entities
- Graph evidence lookup queries entities referenced in the telemetry payload
- Context includes the definition version being used

### AC-002.3: Score Production
Derived from: Scenarios "Score telemetry", "Score with evidence"
- Score is a number between 0.0 and 1.0 (inclusive)
- Rationale is a human-readable string explaining the score
- Rationale references specific evidence examined

### AC-002.4: Score Persistence
Derived from: Scenario "Behavior Node created for low score" (reflex circuit)
- Behavior record created with metric_type set to the definition title
- source_telemetry includes: rationale, evidence_checked, definition_version, telemetry_type
- exhibits edge created: identity -> behavior record
- Behavior record is workspace-scoped

### AC-002.5: Multi-Definition Scoring
Derived from: Scenario "Multiple definitions match"
- When multiple active definitions match the same telemetry type, each is evaluated independently
- One behavior record is created per definition evaluation

### AC-002.6: Failure Handling
Derived from: Scenario "Scorer handles timeout"
- LLM timeout after 30 seconds: no score recorded, event queued for retry
- Up to 3 retry attempts
- Scorer failure does not affect the agent's existing scores or capabilities
- Scorer failure does not block the agent's current action

### AC-002.7: Deterministic Scorer Compatibility
Derived from: Technical constraint
- Existing deterministic scorers (scoreTddAdherence, scoreSecurityFirst) continue to function
- Deterministic scorers are invoked for definitions with scoring_mode=deterministic
- LLM Scorer Agent is invoked for definitions with scoring_mode=llm

---

## US-DB-003: Authorizer Reads Dynamic Behavior Scores

### AC-003.1: Dynamic Score Enrichment
Derived from: Scenario "Deny intent when dynamic score below threshold"
- `getLatestBehaviorScores()` returns scores keyed by dynamic metric_type strings (e.g., "Honesty": 0.05)
- `enrichBehaviorScores()` populates the IntentEvaluationContext with dynamic scores
- Policy predicates can reference `behavior_scores.Honesty` (arbitrary string after dot)

### AC-003.2: Threshold Enforcement
Derived from: Scenarios "Deny intent", "Allow intent"
- When behavior_scores.{metric} < threshold specified in policy rule, intent is denied
- Denial response includes: metric name, current score value, threshold value
- When behavior_scores.{metric} >= threshold, intent is allowed

### AC-003.3: Missing Score Handling
Derived from: Scenario "Allow intent when no score exists"
- When no behavior record exists for a metric referenced in a policy rule, the rule does not deny the intent
- Missing score is treated as "not yet evaluated," not as a violation

### AC-003.4: Recovery Detection
Derived from: Scenario "Allow intent when score above threshold" (reflex circuit step 7)
- When a previously failing score recovers above threshold, the next intent evaluation succeeds
- The threshold for recovery is the same threshold used for restriction (symmetry)
- A feed item is generated noting the recovery

### AC-003.5: Feed Item Generation
Derived from: Scenario "Restriction appears in admin feed"
- Restriction events generate feed items with: agent identity, metric name, score, threshold, restricted scopes, retained scopes
- Recovery events generate feed items with: agent identity, metric name, old score, new score, restored scopes

---

## US-DB-004: Observer Proposes Learnings from Dynamic Behavior Scores

### AC-004.1: Dynamic Score Scanning
Derived from: Scenario "Observer proposes learning from critical score"
- Observer graph scan includes behavior records with dynamic metric_type values
- Observer reads the behavior record's rationale and the definition's goal for context
- Observer identifies critical patterns: single very low score, drift trend, flat-line below threshold

### AC-004.2: Learning Proposal Content
Derived from: Scenario "Observer proposes learning"
- Proposed learning title references the behavioral issue
- Proposed learning content provides actionable instruction for the agent
- Learning references the specific behavior definition and triggering score
- Learning targets the specific agent identity

### AC-004.3: Rate Limiting
Derived from: Scenario "Observer creates observation when rate limited"
- Existing 5-per-7-day rate limit applies to behavior-triggered learnings
- When rate limited, Observer creates observation with severity "critical" instead
- The observation references the low score and affected agent

### AC-004.4: Archived Definition Exclusion
Derived from: Scenario "Observer ignores archived definitions"
- Observer does not analyze scores for definitions with status "archived"
- Only active definitions trigger learning proposals or critical observations

---

## US-DB-005: Behavior Library Page -- Browse and Create

### AC-005.1: Definition Card Display
Derived from: Scenario "Browse active definitions"
- Each definition card shows: title, scoring mode badge (Deterministic | LLM-scored), average score, trend indicator, score count
- Cards grouped by status: active first, then draft, then archived

### AC-005.2: Community Templates
Derived from: Scenario "Create definition from template"
- Community templates shown in a separate section
- Each template has a description and "Use Template" button
- Clicking "Use Template" opens creation form pre-filled with template data

### AC-005.3: Empty State
Derived from: Scenario "Empty state for new workspace"
- Empty state shows explanatory message and "Create Your First Definition" CTA
- Community templates visible even in empty state

### AC-005.4: Validation Preview
Derived from: Scenario "Validation preview"
- Preview runs on change, showing detected rubric levels and applicable telemetry types
- Warnings shown for ambiguous or overly broad goals

### AC-005.5: Status Filter
Derived from: Scenario "Filter definitions by status"
- Filter control for active/draft/archived status
- Default view shows all statuses

---

## US-DB-006: Score Dashboard -- View and Inspect Scores

### AC-006.1: Score Timeline
Derived from: Scenario "View score timeline"
- Timeline chart with data points, X-axis (time), Y-axis (0.0-1.0)
- Average score displayed
- Definition version change markers on timeline

### AC-006.2: Score Detail
Derived from: Scenario "Inspect scoring rationale"
- Each score entry shows: identity, action type, score, timestamp
- "Details" button reveals full rationale and definition version

### AC-006.3: Per-Agent Breakdown
Derived from: Scenario "Per-agent breakdown"
- Per-agent section showing each agent's average score and trend for this definition

---

## US-DB-007: Warn-Only Mode and Manual Override

### AC-007.1: Default Enforcement Mode
Derived from: Scenario "Warn-only creates feed item without restriction"
- New definitions default to enforcement_mode "warn_only"
- Warn-only: low scores generate feed items but do not restrict scopes
- Feed item clearly states: "No scopes restricted (warn-only mode)"

### AC-007.2: Opt-In Automatic Enforcement
Derived from: Scenario "Enable automatic enforcement"
- Admin can change enforcement_mode to "automatic" with a threshold
- Change requires confirmation
- Subsequent low scores trigger Authorizer restriction

### AC-007.3: Manual Override
Derived from: Scenario "Manual override restores scopes"
- Override immediately restores all restricted scopes for the agent
- Override logged in feed with admin identity
- Override does not modify any behavior scores
- Agent can be re-restricted if new low scores are produced after override

### AC-007.4: Feed Item Differentiation
Derived from: Multiple scenarios
- Warn-only feed items visually distinct from enforcement feed items
- Override feed items clearly indicate manual action
- Recovery feed items show score improvement
