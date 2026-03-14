# User Stories: Dynamic Behavior Definitions

---

## Feature 0: Walking Skeleton -- The Reflex Circuit

### US-DB-001: Behavior Definition Schema and CRUD

#### Problem
Elena Vasquez is a workspace admin who wants to define behavioral standards for her agents. She finds it impossible to measure values like honesty or evidence-based reasoning because the behavior system only supports 5 hardcoded metric types (TDD_Adherence, Security_First, Conciseness, Review_Responsiveness, Documentation_Quality), and adding a new one requires a code change.

#### Who
- Workspace Admin | Setting up agent governance | Wants to define what "good behavior" looks like in plain language

#### Solution
A `behavior_definition` table and API endpoints allowing creation, retrieval, update, and archival of behavior definitions with plain-language goal, scoring logic, and telemetry type configuration.

#### Domain Examples

##### 1: Elena Creates an Honesty Definition
Elena creates a behavior definition titled "Honesty" with the goal: "Agents must not fabricate claims. Every factual assertion must be verifiable against graph data." She sets the scoring mode to LLM-scored and selects telemetry types: chat_response, decision_proposal. The definition is saved with status "draft."

##### 2: Elena Activates a Definition
Elena has a draft definition "Evidence-Based Reasoning." She clicks Activate. The status changes to "active." The Scorer Agent begins matching chat_response and observation_creation telemetry events to this definition.

##### 3: Elena Archives an Outdated Definition
Elena decides that "Conciseness" is no longer a priority for her team. She archives the definition. Its status changes to "archived." The Scorer Agent stops matching new telemetry to it. Existing scores are preserved.

#### UAT Scenarios (BDD)

##### Scenario: Create a behavior definition
Given Elena is authenticated as a workspace admin for "Acme AI Team"
When she submits a new behavior definition with:
  | field          | value                                                    |
  | title          | Honesty                                                  |
  | goal           | Agents must not fabricate claims                         |
  | scoring_logic  | Score 0.9-1.0: All claims verifiable...                  |
  | scoring_mode   | llm                                                      |
  | telemetry_types| chat_response, decision_proposal                         |
Then a behavior_definition record is created with status "draft"
And the definition is scoped to workspace "Acme AI Team"

##### Scenario: Activate a draft definition
Given Elena has a draft behavior definition "Honesty"
When she updates the status to "active"
Then the definition status is "active"
And the definition is available for Scorer Agent matching

##### Scenario: Archive an active definition
Given Elena has an active behavior definition "Conciseness"
When she updates the status to "archived"
Then the definition status is "archived"
And the Scorer Agent no longer matches telemetry to this definition
And existing behavior records referencing "Conciseness" are preserved

##### Scenario: Edit an active definition increments version
Given Elena has an active behavior definition "Honesty" at version 1
When she updates the scoring_logic
Then the definition version increments to 2
And subsequent scoring uses version 2

##### Scenario: Reject definition creation with missing goal
Given Elena submits a behavior definition without a goal field
Then the creation fails with an error: "Goal is required"

#### Acceptance Criteria
- [ ] behavior_definition table created with fields: title, goal, scoring_logic, scoring_mode, telemetry_types, category, status, version, workspace
- [ ] CRUD API endpoints: POST (create), GET (list/detail), PUT (update), PATCH (archive)
- [ ] Status lifecycle: draft -> active -> archived
- [ ] Version increments on edit of active definition
- [ ] Workspace-scoped: definitions are only visible within their workspace
- [ ] Existing behavior records are never modified by definition changes

#### Technical Notes
- New SCHEMAFULL table `behavior_definition` in SurrealDB schema
- Migration script needed (next autoincrement prefix in schema/migrations/)
- No backwards compatibility needed per project convention
- Existing KNOWN_METRIC_TYPES remain available; deterministic scorers are represented as behavior_definitions with scoring_mode=deterministic

#### Dependencies
- None (greenfield table)

---

### US-DB-002: Scorer Agent -- Evaluate Telemetry Against Definitions

#### Problem
Elena Vasquez has created behavior definitions but there is no way to evaluate agent actions against them. The existing `scoreTelemetry()` function in `behavior/scorer.ts` only handles two hardcoded metric types with deterministic ratio-based logic. It cannot evaluate "Does this agent's chat response demonstrate evidence-based reasoning?" because that requires semantic understanding.

#### Who
- System (automated) | Processing agent telemetry events | Needs to produce behavior scores for dynamic definitions

#### Solution
A Scorer Agent -- a specialized lightweight LLM agent that receives a telemetry event, matches it to relevant active behavior definitions, assembles scoring context (definition goal + scoring_logic + telemetry + graph evidence), and produces a score (0.0-1.0) with rationale.

#### Domain Examples

##### 1: Scoring a Chat Response for Honesty
Coding-agent-alpha produces a chat_response claiming "Feature X is complete, all tests passing, PR merged." The Scorer Agent matches this to the active "Honesty" definition, queries the graph for feature:X (status: in_progress, 0 commits, no PR), and scores 0.05 with rationale: "Three claims made, zero verifiable against graph data."

##### 2: Scoring a Decision Proposal for Evidence-Based Reasoning
Coding-agent-beta proposes a decision to "Migrate billing API to tRPC" and cites decision:d42 (standardization decision), performance benchmarks from observation:obs-789, and cost estimates referencing vendor pricing. The Scorer Agent matches to "Evidence-Based Reasoning" definition and scores 0.85 with rationale: "All alternatives cited with trade-offs. Minor gap: latency claim lacks specific benchmark."

##### 3: Scorer Agent Timeout
Design-agent produces an observation_creation. The Scorer Agent attempts to evaluate against "Honesty" but the LLM times out after 30 seconds. The event is queued for retry. No score is recorded. The agent's existing scores and capabilities are not affected.

#### UAT Scenarios (BDD)

##### Scenario: Score telemetry against matching definition
Given the "Honesty" behavior definition is active with telemetry_types including "chat_response"
And coding-agent-alpha produces a chat_response with fabricated claims
And graph evidence contradicts the claims
When the Scorer Agent evaluates the telemetry event
Then a behavior record is created with metric_type "Honesty"
And the score is between 0.00 and 0.15
And the source_telemetry contains a rationale referencing the evidence discrepancy
And the source_telemetry contains definition_version 1
And an exhibits edge links coding-agent-alpha to the behavior record

##### Scenario: Score telemetry with evidence-supported claims
Given the "Evidence-Based Reasoning" definition is active
And coding-agent-beta produces a decision_proposal citing 3 graph entities
And all cited entities exist and support the claims
When the Scorer Agent evaluates the telemetry event
Then a behavior record is created with score above 0.80
And the rationale confirms the cited evidence was verified

##### Scenario: Scorer Agent handles timeout gracefully
Given the "Honesty" definition is active
And design-agent produces an observation_creation
When the Scorer Agent LLM call times out after 30 seconds
Then no behavior record is created for this event
And the event is queued for retry (up to 3 attempts)
And design-agent's existing behavior scores are not affected

##### Scenario: No matching definitions for telemetry type
Given the only active definition scores "chat_response" events
When coding-agent-alpha produces a "commit" telemetry event
Then no Scorer Agent evaluation is triggered
And no behavior record is created

##### Scenario: Multiple definitions match same telemetry event
Given "Honesty" and "Evidence-Based Reasoning" are both active for "chat_response"
When coding-agent-alpha produces a chat_response
Then the Scorer Agent evaluates the event against both definitions
And two separate behavior records are created (one per definition)

#### Acceptance Criteria
- [ ] Scorer Agent receives telemetry event and matches to active definitions by telemetry_type
- [ ] Scorer Agent assembles context: definition goal + scoring_logic + telemetry payload + graph evidence for referenced entities
- [ ] Score is a number 0.0-1.0 with human-readable rationale
- [ ] Score is persisted as behavior record with metric_type matching definition title
- [ ] source_telemetry includes rationale, evidence_checked, and definition_version
- [ ] exhibits edge created linking identity to behavior record
- [ ] Timeout/failure: event queued for retry, no score recorded, no side effects
- [ ] Deterministic scorers (TDD_Adherence, Security_First) continue to work via existing code path

#### Technical Notes
- Scorer Agent is a new module in `app/src/server/behavior/` or `app/src/server/agents/scorer/`
- Uses AI SDK ToolLoopAgent pattern (same as PM Agent)
- Needs graph query tools for evidence lookup
- LLM model configurable via env var (e.g., SCORER_MODEL)
- Consider lightweight model (Haiku-class) for cost efficiency

#### Dependencies
- US-DB-001 (behavior_definition table must exist)

---

### US-DB-003: Authorizer Reads Dynamic Behavior Scores

#### Problem
Elena Vasquez has behavior definitions producing scores, but the Authorizer cannot act on them. The existing `enrichBehaviorScores()` function in `behavior/queries.ts` already populates `behavior_scores` in the IntentEvaluationContext, and policy rules can reference `behavior_scores.TDD_Adherence`. However, this only works because the metric types are hardcoded strings. For dynamic definitions, the Authorizer must support arbitrary metric names in the `behavior_scores` map.

#### Who
- System (automated) | Evaluating agent intents | Needs to enforce behavioral thresholds for dynamic definitions

#### Solution
Ensure `getLatestBehaviorScores()` returns scores keyed by dynamic definition titles (not just hardcoded enum values). Verify the policy predicate parser accepts arbitrary string keys in `behavior_scores.*`. Add a policy rule template for behavior threshold enforcement.

#### Domain Examples

##### 1: Authorizer Blocks Agent with Low Honesty Score
Coding-agent-alpha has a latest Honesty score of 0.05 (from the Scorer Agent). A policy rule requires `behavior_scores.Honesty >= 0.50`. When coding-agent-alpha requests scope "write:code," the Authorizer denies the intent with reason: "Honesty score 0.05 below threshold 0.50." Restricted scopes: write:code, create:decision. Retained scopes: read:graph, read:context.

##### 2: Authorizer Allows Agent with Recovered Score
After a learning is applied, coding-agent-alpha's next chat_response scores 0.88 on Honesty. When it requests scope "write:code," the Authorizer evaluates `behavior_scores.Honesty = 0.88 >= 0.50` and allows the intent. A feed item appears: "coding-agent-alpha restrictions lifted."

##### 3: Authorizer Handles Missing Score for New Definition
Elena activates a new definition "Collaboration." No scores exist yet. When coding-agent-alpha requests an intent, `behavior_scores.Collaboration` is undefined. The policy rule `behavior_scores.Collaboration >= 0.50` should not deny the intent when no score exists (absence is not a violation).

#### UAT Scenarios (BDD)

##### Scenario: Deny intent when dynamic behavior score below threshold
Given coding-agent-alpha has a latest behavior score:
  | metric_type | score |
  | Honesty     | 0.05  |
And a policy rule requires behavior_scores.Honesty >= 0.50
When coding-agent-alpha requests intent for scope "write:code"
Then the intent is denied
And the denial reason includes "Honesty score 0.05 below threshold 0.50"

##### Scenario: Allow intent when dynamic behavior score above threshold
Given coding-agent-alpha has a latest behavior score:
  | metric_type | score |
  | Honesty     | 0.88  |
And a policy rule requires behavior_scores.Honesty >= 0.50
When coding-agent-alpha requests intent for scope "write:code"
Then the intent is allowed

##### Scenario: Allow intent when no score exists for a defined metric
Given coding-agent-alpha has no behavior scores for "Collaboration"
And a policy rule requires behavior_scores.Collaboration >= 0.50
When coding-agent-alpha requests intent for scope "write:code"
Then the intent is allowed
And the missing score does not count as a violation

##### Scenario: Multiple behavior scores evaluated together
Given coding-agent-alpha has behavior scores:
  | metric_type          | score |
  | Honesty              | 0.92  |
  | Evidence_Based       | 0.15  |
And policy rules require both >= 0.50
When coding-agent-alpha requests intent for scope "write:code"
Then the intent is denied for Evidence_Based (0.15 < 0.50)
And the denial reason identifies the failing metric

#### Acceptance Criteria
- [ ] `getLatestBehaviorScores()` returns scores keyed by dynamic definition titles
- [ ] Policy predicate parser accepts arbitrary string keys in `behavior_scores.*`
- [ ] Missing scores (no behavior record for a metric) do not trigger denial
- [ ] Denial response includes specific metric name, score value, and threshold
- [ ] Feed item generated for both restriction and recovery events
- [ ] Recovery uses the same threshold as restriction (symmetry)

#### Technical Notes
- `enrichBehaviorScores()` already populates the context; verify it returns dynamic metric names from behavior records
- Policy predicate parser in `policy/` module may need validation that it handles any string key, not just KNOWN_METRIC_TYPES
- No new DB schema changes expected; behavior records already store metric_type as string

#### Dependencies
- US-DB-002 (Scorer Agent must produce behavior records with dynamic metric_type values)

---

### US-DB-004: Observer Proposes Learnings from Dynamic Behavior Scores

#### Problem
Elena Vasquez relies on the Observer to diagnose root causes and propose learnings. The Observer already scans for behavior trends (via `behavior/trends.ts`), but its trend analysis uses the hardcoded metric types. When the Scorer Agent creates behavior records with dynamic metric types like "Honesty," the Observer needs to detect low-score patterns for these new types and propose targeted learnings.

#### Who
- System (automated) | Scanning graph for behavioral patterns | Needs to detect and diagnose dynamic behavior score anomalies

#### Solution
Extend the Observer's graph scan to include behavior records with dynamic metric types. When it detects a critical score (e.g., Honesty: 0.05), it performs root cause analysis using the behavior record's rationale and the definition's goal, then proposes a learning targeting the specific agent.

#### Domain Examples

##### 1: Observer Diagnoses Fabrication
Coding-agent-alpha has a Honesty score of 0.05. The Observer reads the scoring rationale: "Three claims made, zero verifiable." It reads the definition goal: "Agents must not fabricate claims." It proposes learning: "Verify claims against graph before reporting status" targeting coding-agent-alpha, with status "proposed."

##### 2: Observer Detects Drift Pattern
Coding-agent-beta's Evidence-Based Reasoning scores show a drift trend: 0.82, 0.75, 0.68, 0.61 over 4 sessions. The Observer detects this as a "drift" pattern (consecutive below-threshold scores) and proposes a learning: "Strengthen evidence citations in recommendations" before the score becomes critical.

##### 3: Observer Hits Rate Limit
The Observer has proposed 5 learnings in the past 7 days. Coding-agent-alpha scores 0.05 on Honesty. The Observer cannot propose a learning but creates an observation with severity "critical" about the low score, which appears in Elena's feed for manual review.

#### UAT Scenarios (BDD)

##### Scenario: Observer proposes learning from critical dynamic behavior score
Given coding-agent-alpha has a Honesty score of 0.05
And the behavior record's rationale is "Three claims made, zero verifiable"
And the "Honesty" definition's goal is "Agents must not fabricate claims"
And the Observer has proposed fewer than 5 learnings in 7 days
When the Observer performs a graph scan
Then it proposes a learning targeting coding-agent-alpha
And the learning title references verification of claims
And the learning content instructs the agent to check graph evidence

##### Scenario: Observer detects drift in dynamic behavior scores
Given coding-agent-beta has 4 consecutive Evidence-Based Reasoning scores below 0.70
When the Observer performs a graph scan
Then it detects a "drift" trend for Evidence-Based Reasoning
And it proposes a learning about strengthening evidence citations

##### Scenario: Observer creates observation when rate limited
Given the Observer has proposed 5 learnings in the past 7 days
And coding-agent-alpha has a Honesty score of 0.05
When the Observer performs a graph scan
Then it creates an observation with severity "critical"
And the observation references the low Honesty score and the agent
And no learning is proposed

##### Scenario: Observer ignores archived definitions
Given "Conciseness" definition has been archived
And coding-agent-alpha has recent Conciseness scores below threshold
When the Observer performs a graph scan
Then it does not flag Conciseness scores for learning proposals

#### Acceptance Criteria
- [ ] Observer scans behavior records with dynamic metric_type values (not only hardcoded types)
- [ ] Observer uses the behavior record's rationale and the definition's goal for root cause analysis
- [ ] Learning proposals reference the specific behavior definition and triggering score
- [ ] Existing 5-per-7-day rate limit applies to behavior-triggered learnings
- [ ] When rate limited, Observer creates critical observation instead of learning
- [ ] Archived definitions are excluded from Observer analysis

#### Technical Notes
- Observer's graph scan in `observer/graph-scan.ts` needs to query dynamic behavior records
- Observer's learning diagnosis in `observer/learning-diagnosis.ts` needs definition context
- Trend analysis in `behavior/trends.ts` is metric-type-agnostic (works with any string)

#### Dependencies
- US-DB-002 (behavior records with dynamic metric_type must exist)
- US-DB-001 (behavior_definition table for definition context)

---

## Feature 1: Behavior Library UI

### US-DB-005: Behavior Library Page -- Browse and Create

#### Problem
Elena Vasquez can create behavior definitions via the API (US-DB-001), but there is no web UI for this. She wants to browse her existing definitions, see their scores and trends at a glance, find community templates, and create new definitions -- all from a web page similar to the existing Learning Library.

#### Who
- Workspace Admin | Managing behavior standards | Wants a visual dashboard for behavior definitions

#### Solution
A web page at `/behaviors` (or within the workspace view) showing active definitions with score summaries, community templates, and a creation form.

#### Domain Examples

##### 1: Elena Browses Her Definitions
Elena navigates to the Behavior Library. She sees 2 active definitions (TDD Adherence: avg 0.82, trend improving; Security First: avg 0.91, trend stable) and 1 draft (Evidence-Based Reasoning). Each card shows scoring mode, score count, and trend.

##### 2: Elena Uses a Community Template
Elena clicks "Use Template" on the "Honesty" community template. A form opens pre-filled with the template's goal and scoring logic. She customizes the scoring rubric and saves as draft.

##### 3: Elena Views an Empty Library
A new workspace with no definitions. Elena sees: "No behavior definitions yet. Define what good agent behavior looks like." With a "Create Your First Definition" button and community templates below.

#### UAT Scenarios (BDD)

##### Scenario: Browse active definitions with scores
Given Elena's workspace has 2 active behavior definitions
And "TDD Adherence" has an average score of 0.82 across 47 records this week
When Elena navigates to the Behavior Library page
Then she sees 2 definition cards in the "Your Definitions" section
And the "TDD Adherence" card shows: avg 0.82, 47 scores, trend indicator

##### Scenario: Empty state for new workspace
Given Elena's workspace has no behavior definitions
When Elena navigates to the Behavior Library page
Then she sees a message: "No behavior definitions yet"
And she sees a "Create Your First Definition" call to action
And she sees community templates as starting points

##### Scenario: Create definition from template
Given Elena is on the Behavior Library page
When she clicks "Use Template" on the "Honesty" template
Then a creation form opens pre-filled with the template's goal and scoring logic
And Elena can edit all fields before saving

##### Scenario: Validation preview on definition creation
Given Elena is creating a new behavior definition
When she enters a goal and scoring logic with 4 rubric levels
Then the validation preview shows "4 levels detected"
And lists the selected telemetry types

##### Scenario: Filter definitions by status
Given Elena has 2 active, 1 draft, and 1 archived definition
When she filters by status "active"
Then she sees only the 2 active definitions

#### Acceptance Criteria
- [ ] Library page shows workspace definitions grouped by status (active, draft, archived)
- [ ] Each card shows: title, scoring mode badge, average score, trend indicator, score count
- [ ] Community templates section shows pre-built definitions with "Use Template" button
- [ ] Creation form with validation preview
- [ ] Empty state with guidance and call to action
- [ ] Filter by status

#### Technical Notes
- Follow existing Learning Library UI patterns (app/src/client/routes/learnings-page.tsx)
- Use existing card component patterns from learning-card-logic.ts
- New route: /behaviors or /workspaces/:id/behaviors

#### Dependencies
- US-DB-001 (behavior_definition CRUD API)

---

### US-DB-006: Score Dashboard -- View and Inspect Scores

#### Problem
Elena Vasquez has active definitions producing scores, but she cannot see the scores in a meaningful way. The existing GET /api/workspaces/:workspaceId/behaviors endpoint returns raw behavior records. Elena needs a per-definition score dashboard with timeline chart, per-agent breakdown, and rationale inspection.

#### Who
- Workspace Admin | Reviewing agent behavior | Wants to understand score patterns and investigate anomalies

#### Solution
A definition detail page showing score timeline chart, recent scores with rationale, and per-agent breakdown.

#### Domain Examples

##### 1: Elena Reviews Scores for Evidence-Based Reasoning
Elena opens the "Evidence-Based Reasoning" detail page. She sees a timeline chart with 15 data points over 3 days. Average: 0.73. She notices coding-agent-alpha consistently scores below 0.65 while coding-agent-beta averages 0.85.

##### 2: Elena Inspects a Low Score Rationale
Elena clicks "Details" on coding-agent-alpha's score of 0.62. She sees: "Agent recommended tRPC migration but cited only one supporting decision node. Two claims about performance gains lacked specific benchmarks." She now understands the gap.

##### 3: Elena Checks Trend After Definition Edit
Elena edited the "Evidence-Based Reasoning" scoring logic from "every claim" to "key claims." She returns 2 days later. The timeline shows a visible inflection point where scores shifted upward after the edit. A version marker on the chart shows where the edit occurred.

#### UAT Scenarios (BDD)

##### Scenario: View score timeline for a definition
Given "Evidence-Based Reasoning" has 15 scores over 3 days
When Elena opens the definition detail page
Then she sees a timeline chart with 15 data points
And the chart's X-axis shows dates and Y-axis shows 0.0-1.0
And the average score (0.73) is displayed

##### Scenario: Inspect scoring rationale
Given coding-agent-alpha scored 0.62 on "Evidence-Based Reasoning"
When Elena clicks "Details" on that score entry
Then she sees the Scorer Agent's rationale text
And the rationale references specific evidence examined
And the rationale shows which definition version produced the score

##### Scenario: Per-agent score breakdown
Given 3 agents have scores for "Evidence-Based Reasoning"
When Elena views the definition detail page
Then she sees a per-agent breakdown showing each agent's average and trend

#### Acceptance Criteria
- [ ] Definition detail page with score timeline chart
- [ ] Recent scores list with identity, action type, score, timestamp, and "Details" button
- [ ] Rationale display in detail/modal view
- [ ] Per-agent average and trend breakdown
- [ ] Definition version markers on timeline when definition was edited
- [ ] Scores ordered by timestamp descending

#### Technical Notes
- Reuse existing behavior query infrastructure (listWorkspaceBehaviors)
- Need new query: list behaviors filtered by definition (metric_type matching definition title)
- Chart library: use whatever is already in the project frontend stack

#### Dependencies
- US-DB-002 (scores must exist with rationale)
- US-DB-005 (library page provides navigation to detail page)

---

## Feature 6: Graduated Enforcement

### US-DB-007: Warn-Only Mode and Manual Override

#### Problem
Elena Vasquez is anxious about automatic scope restriction based on behavior scores. She worries about false positives disrupting legitimate agent work (e.g., an agent is restricted because the Scorer Agent scored too harshly, or because graph evidence was stale due to eventual consistency). She needs a way to enable behavioral scoring without automatic enforcement, and a way to manually override restrictions when they are wrong.

#### Who
- Workspace Admin | Managing enforcement policy | Wants graduated control over behavioral restrictions

#### Solution
Default enforcement mode is "warn-only" -- low scores generate feed items and observations but do not trigger automatic scope restriction. Automatic restriction is opt-in per definition. Manual override is available via feed item action.

#### Domain Examples

##### 1: Warn-Only Mode (Default)
Elena activates "Evidence-Based Reasoning" with default enforcement: warn-only. Coding-agent-alpha scores 0.35. A feed item appears: "coding-agent-alpha scored 0.35 on Evidence-Based Reasoning (below threshold 0.50)." No scopes are restricted. Elena can investigate at her convenience.

##### 2: Elena Enables Automatic Enforcement
After 2 weeks of warn-only mode, Elena is confident the Honesty definition scores accurately. She enables automatic enforcement for "Honesty" with threshold 0.50. Now low Honesty scores trigger automatic scope restriction.

##### 3: Elena Overrides a False Positive
Coding-agent-beta is restricted because a Honesty score of 0.30 was triggered by an eventual consistency lag -- the agent cited a commit that existed but was not yet visible in the graph. Elena clicks "Override Restriction" in the feed. The agent's scopes are immediately restored. The override is logged.

#### UAT Scenarios (BDD)

##### Scenario: Warn-only mode creates feed item without restriction
Given "Evidence-Based Reasoning" has enforcement mode "warn-only"
And coding-agent-alpha scores 0.35 (below threshold 0.50)
When the score is persisted
Then a feed item appears: "Low score alert: coding-agent-alpha scored 0.35 on Evidence-Based Reasoning"
And coding-agent-alpha's scopes are not restricted

##### Scenario: Automatic enforcement restricts agent
Given "Honesty" has enforcement mode "automatic" with threshold 0.50
And coding-agent-alpha scores 0.05 on Honesty
When coding-agent-alpha requests an intent for scope "write:code"
Then the intent is denied due to Honesty score below threshold

##### Scenario: Manual override restores scopes immediately
Given coding-agent-alpha is restricted due to Honesty score 0.05
When Elena clicks "Override Restriction" in the feed
Then coding-agent-alpha's scopes are immediately restored
And a feed item records: "Elena Vasquez overrode restriction for coding-agent-alpha"
And the override does not change the behavior score

##### Scenario: Enable automatic enforcement on a definition
Given "Honesty" definition has enforcement mode "warn-only"
When Elena updates the enforcement mode to "automatic" with threshold 0.50
Then subsequent low Honesty scores trigger automatic scope restriction

#### Acceptance Criteria
- [ ] Default enforcement mode is "warn-only" for new definitions
- [ ] Warn-only mode: low scores generate feed items but do not restrict scopes
- [ ] Automatic mode: opt-in per definition, requires threshold configuration
- [ ] Manual override: immediately restores scopes, logged in feed
- [ ] Override does not modify behavior scores (append-only preserved)
- [ ] Enforcement mode stored on behavior_definition record

#### Technical Notes
- New field on behavior_definition: enforcement_mode (warn_only | automatic), enforcement_threshold
- Authorizer checks enforcement_mode before applying behavior score policy rule
- Override endpoint: POST /api/workspaces/:id/behaviors/override

#### Dependencies
- US-DB-003 (Authorizer integration must exist)
- US-DB-001 (enforcement_mode field on behavior_definition)
