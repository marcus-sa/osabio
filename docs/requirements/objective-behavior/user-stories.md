# User Stories: Objective & Behavior Nodes

---

## US-OB-01: Create Strategic Objectives

### Problem
Elena Vasquez is an engineering lead managing 4 autonomous coding agents. She finds it impossible to know whether agent work serves business goals because there is no concept of "objectives" in the knowledge graph. She currently trusts agents to stay on-task via project context, but last week Coder-Alpha spent 4 hours refactoring a utility module while the Q2 launch feature was understaffed.

### Who
- Engineering Lead | Managing autonomous agents | Wants strategic alignment and compute waste prevention

### Solution
Enable creating objective nodes in the knowledge graph via chat conversation or direct creation, with title, description, target date, success criteria, priority, and workspace scoping.

### Domain Examples

#### 1: Happy Path -- Elena creates Q2 launch objective via chat
Elena sends: "Our Q2 objective is to launch the MCP marketplace with 10 listed integrations by June 30." Brain extracts an objective node with title "Launch MCP Marketplace", target_date 2026-06-30, success_criteria ["10 listed integrations"], priority 90, status "active". Elena sees confirmation with extracted fields.

#### 2: Edge Case -- Objective without target date
Elena sends: "We need to improve infrastructure reliability this quarter." Brain creates the objective but prompts: "What is the target date for this objective?" The objective is created with status "active" and no target_date until Elena provides one.

#### 3: Error/Boundary -- Duplicate objective detection
Elena sends: "Our goal is to launch the MCP marketplace." Brain detects semantic similarity 0.97 with existing active objective "Launch MCP Marketplace." Instead of creating a duplicate, Brain responds: "An active objective 'Launch MCP Marketplace' already exists. Would you like to update it?"

### UAT Scenarios (BDD)

#### Scenario: Create objective from chat message
Given Elena Vasquez is in a conversation in workspace "BrainOS"
When Elena sends "Our Q2 objective is to launch the MCP marketplace with 10 listed integrations by June 30"
Then an objective node is created with title "Launch MCP Marketplace"
And the objective has target_date 2026-06-30
And the objective has success_criteria containing "10 listed integrations"
And the objective has status "active" and priority 90
And the objective has an embedding generated for semantic matching

#### Scenario: Prompt for missing target date
Given Elena sends "We need to improve infrastructure reliability this quarter"
When the extraction pipeline creates the objective
Then the objective is created without target_date
And the system prompts Elena for a target date

#### Scenario: Detect and prevent duplicate objectives
Given objective "Launch MCP Marketplace" exists with status "active"
When Elena sends "Our goal is to launch the MCP marketplace"
Then no duplicate objective is created
And Elena sees: "An active objective 'Launch MCP Marketplace' already exists"

#### Scenario: Objective created with workspace scope and embedding
Given Elena is in workspace "BrainOS"
When an objective is created
Then the objective has workspace reference to "BrainOS"
And the objective has an embedding for semantic matching
And the objective is only visible within workspace "BrainOS"

### Acceptance Criteria
- [ ] Objective node created from chat with extracted title, target_date, success_criteria, priority
- [ ] Missing target_date prompts user (objective still created)
- [ ] Duplicate detection prevents creating semantically identical objectives (similarity > 0.95)
- [ ] Objective scoped to workspace with embedding generated

### Technical Notes
- New SCHEMAFULL table `objective` in SurrealDB schema
- Extraction pipeline extended to recognize objective-type entities
- Embedding generation reuses existing pipeline (same dimension/model)
- Status enum: active, expired, completed, archived

### Dependencies
- Embedding generation pipeline (existing)
- Extraction pipeline (existing, needs extension)
- Schema migration (new table)

### Job Story Trace
- J1: Strategic Alignment Governance

### Size Estimate
- Effort: 2-3 days
- Scenarios: 4
- Demonstrable: Create objective via chat, see it in graph

---

## US-OB-02: Automatic Intent-Objective Alignment

### Problem
Elena Vasquez cannot tell whether agent intents serve active business objectives. Even with objectives defined, there is no mechanism to connect intents to objectives. She discovers misalignment only through manual review of agent activity, often days after compute is spent.

### Who
- Engineering Lead | Reviewing agent strategic alignment | Wants automatic alignment tracking without manual overhead

### Solution
Authorizer Agent evaluates intent-objective alignment during authorization by computing semantic similarity between the intent goal and active objective embeddings. Creates `supports` edge when aligned; creates warning observation when unaligned.

### Domain Examples

#### 1: Happy Path -- Intent automatically linked to matching objective
Coder-Alpha submits intent "Implement MCP tool discovery endpoint." Authorizer computes similarity with active objectives, finds "Launch MCP Marketplace" at 0.87. Creates `supports` edge: intent ->supports-> objective. Intent proceeds to authorization.

#### 2: Edge Case -- No matching objective found
Coder-Beta submits intent "Refactor logging subsystem to use structured logs." Best similarity score is 0.31 (with "Improve Infrastructure Reliability"). Authorizer creates observation (severity: warning): "Intent has no supporting objective. Potential organizational waste." Intent proceeds (warning mode). Feed card appears with "Link to Objective", "Dismiss", "Create Objective" actions.

#### 3: Error/Boundary -- Ambiguous match (multiple objectives)
Coder-Alpha submits intent "Add health checks to MCP service endpoints." Two objectives match: "Launch MCP Marketplace" (0.72) and "Improve Infrastructure Reliability" (0.68). System links to highest score, surfaces both in feed card for Elena to confirm or reassign.

### UAT Scenarios (BDD)

#### Scenario: Intent linked to matching objective
Given objective "Launch MCP Marketplace" exists with status "active" and embedding
When Coder-Alpha submits intent with goal "Implement MCP tool discovery endpoint"
Then the Authorizer computes semantic similarity above 0.7
And a supports edge is created: intent ->supports-> objective "Launch MCP Marketplace"
And the intent proceeds to authorization evaluation

#### Scenario: Unaligned intent triggers warning
Given objective "Launch MCP Marketplace" is the only active objective
When Coder-Beta submits intent with goal "Refactor logging subsystem to use structured logs"
Then the Authorizer finds no objective match above 0.5
And an observation is created with severity "warning"
And the intent is NOT blocked (warning mode)
And a feed card appears with link/dismiss/create actions

#### Scenario: Elena manually links unaligned intent from feed card
Given an alignment warning exists for intent "Refactor logging subsystem"
When Elena clicks "Link to Objective" and selects "Improve Infrastructure Reliability"
Then a supports edge is created between intent and selected objective
And the warning observation is resolved

#### Scenario: No objectives exist in workspace
Given no objectives exist in workspace "BrainOS"
When Coder-Alpha submits an intent
Then a feed card appears: "No objectives defined. Agent work is untracked."
And the intent proceeds without alignment check

#### Scenario: Ambiguous match surfaces both options
Given two objectives match with similarity above 0.5
When the intent is evaluated
Then it links to the highest-scoring objective
And a feed card shows both options for human confirmation

### Acceptance Criteria
- [ ] Authorizer computes intent-objective alignment via semantic similarity
- [ ] Supports edge created for similarity >= 0.7
- [ ] Warning observation for similarity < 0.5 across all objectives
- [ ] Manual linking via feed card actions resolves warning
- [ ] No objectives: intent proceeds with informational feed card
- [ ] Alignment evaluation completes within 200ms

### Technical Notes
- Authorizer needs access to active objective embeddings (workspace-scoped KNN query)
- Supports relation table: TYPE RELATION IN intent OUT objective
- Warning observation uses existing observation table with category "engineering"
- Feed card actions require SSE event and API endpoint for manual linking

### Dependencies
- US-OB-01 (Objective nodes must exist)
- Intent authorization pipeline (existing)
- Embedding pipeline (existing)

### Job Story Trace
- J1: Strategic Alignment Governance
- J4: Objective-Driven Cost Governance

### Size Estimate
- Effort: 2-3 days
- Scenarios: 5
- Demonstrable: Submit intent, see supports edge or warning feed card

---

## US-OB-03: Behavioral Telemetry Collection

### Problem
Tomasz Kowalski is a platform engineer who caught Coder-Alpha shipping 0% test coverage on a payment module by accident during manual code review, 3 days after the fact. There is no systematic way to track agent process quality (TDD adherence, security compliance, review responsiveness) across sessions.

### Who
- Platform Engineer | Managing agent quality | Wants systematic behavioral quality tracking

### Solution
Observer Agent collects behavioral telemetry from agent sessions and writes behavior nodes with metric_type, score, and source_telemetry. Each behavior record is linked to the agent identity via an `exhibits` relation edge.

### Domain Examples

#### 1: Happy Path -- Observer writes TDD_Adherence behavior after Coder-Alpha session
Coder-Alpha completes a session changing 12 files with only 2 test files. Observer Agent evaluates: TDD_Adherence score = 0.42. Creates behavior record with source_telemetry {files_changed: 12, test_files_changed: 2, coverage_delta: -8%}. Creates exhibits edge: identity:coder-alpha ->exhibits-> behavior:new-record.

#### 2: Edge Case -- New agent with no behavior history
Coder-New was just added to the workspace. Dashboard shows "--" for all metrics. After first session, Observer writes initial behavior record. Dashboard updates to show first score.

#### 3: Error/Boundary -- Telemetry source unavailable
Coder-Alpha completes a session but the telemetry source (session data) is partially unavailable. Observer Agent skips writing a behavior record for this session and retries on next cycle. Dashboard shows "Last updated: 2 hours ago."

### UAT Scenarios (BDD)

#### Scenario: Observer writes TDD_Adherence behavior node
Given metric type "TDD_Adherence" is registered
And Coder-Alpha completes a session changing 12 files with 2 test files
When the Observer Agent evaluates session telemetry
Then a behavior record is created with metric_type "TDD_Adherence" and score 0.42
And source_telemetry contains files_changed: 12, test_files_changed: 2
And an exhibits edge links identity:coder-alpha to the behavior record

#### Scenario: Observer writes Security_First behavior node
Given metric type "Security_First" is registered
And Coder-Beta completes a session with 2 CVE advisories in context, 1 addressed
When the Observer Agent evaluates session telemetry
Then a behavior record is created with metric_type "Security_First" and score 0.65
And source_telemetry includes cve_advisories_in_context: 2, cve_advisories_addressed: 1

#### Scenario: New agent has no behavior data
Given agent identity "Coder-New" has completed no sessions
When Tomasz views the behavior dashboard
Then "Coder-New" appears with "--" for all metric scores

#### Scenario: Telemetry unavailable does not block agent session
Given Coder-Alpha completes a session
And the telemetry source is unavailable
When the Observer Agent attempts evaluation
Then no behavior record is written
And the agent session was not blocked or delayed

### Acceptance Criteria
- [ ] Behavior records created with metric_type, score (0.0-1.0), source_telemetry
- [ ] Exhibits edge created linking identity to behavior record
- [ ] Behavior records are append-only (not retroactively modifiable)
- [ ] Telemetry failure does not block agent sessions
- [ ] New agents show no data until first session

### Technical Notes
- New SCHEMAFULL table `behavior` + `exhibits` TYPE RELATION table
- Observer Agent extended with session evaluation logic
- Score normalization is metric-type-specific (Observer Agent responsibility)
- Behavior records scoped to workspace

### Dependencies
- Observer Agent (existing, needs extension)
- Agent session data (existing, in agent_session + trace tables)
- Schema migration (new tables)

### Job Story Trace
- J2: Behavioral Quality Governance

### Size Estimate
- Effort: 2-3 days
- Scenarios: 4
- Demonstrable: Complete agent session, see behavior record in graph

---

## US-OB-04: Behavior-Based Policy Enforcement

### Problem
Tomasz Kowalski can see behavior scores (from US-OB-03) but has no way to automatically enforce minimum quality standards. Coder-Beta's Security_First score is 0.65 -- below what Tomasz considers safe for production deployment -- but nothing prevents Coder-Beta from deploying to production.

### Who
- Platform Engineer | Enforcing agent quality standards | Wants automatic scope revocation based on behavioral metrics

### Solution
Policy rules extended to reference behavior metrics. Authorizer queries latest behavior scores during policy evaluation. Policy "testing" mode allows observation without enforcement for threshold calibration.

### Domain Examples

#### 1: Happy Path -- Intent vetoed by behavior policy
Tomasz created policy "Security Behavior Gate": if Security_First < 0.8, deny production_deploy. Coder-Beta (score: 0.65) submits intent to deploy auth-service v2.3 to production. Authorizer queries behavior score, finds 0.65 < 0.80, vetoes intent. Feed card shows veto with reasoning and override option.

#### 2: Edge Case -- Human overrides veto for critical hotfix
Coder-Beta's deploy intent was vetoed. Tomasz determines it is a critical hotfix. He clicks "Override (human)" on the feed card. Intent transitions from "vetoed" to "authorized." Override logged with Tomasz's identity for audit trail.

#### 3: Edge Case -- Policy in testing mode observes but does not block
Policy "TDD Quality Gate" has status "testing." Coder-Alpha (TDD_Adherence: 0.42) submits intent. Authorizer logs "would have vetoed" but allows intent to proceed. After 2 weeks, Tomasz reviews testing results (3 would-have-been-vetoed intents) and decides whether to activate.

#### 4: Error/Boundary -- Agent passes behavior threshold
Coder-Gamma (Security_First: 0.93) submits deploy intent. Authorizer queries score, finds 0.93 >= 0.80, intent proceeds normally. No feed card generated.

### UAT Scenarios (BDD)

#### Scenario: Intent vetoed by behavior policy
Given policy "Security Behavior Gate" has status "active"
And Coder-Beta's latest Security_First score is 0.65
When Coder-Beta submits intent to deploy to production
Then the Authorizer evaluates behavior score against policy threshold
And the intent is vetoed with reason "Security_First 0.65 < threshold 0.80"
And a feed card shows the veto with override option

#### Scenario: Human override of behavior veto
Given Coder-Beta's deploy intent was vetoed by behavior policy
When Tomasz clicks "Override (human)" on the feed card
Then the intent transitions to "authorized"
And an observation logs the override with Tomasz's identity

#### Scenario: Policy in testing mode observes without blocking
Given policy "TDD Quality Gate" has status "testing"
And Coder-Alpha's TDD_Adherence is 0.42
When Coder-Alpha submits an intent
Then the intent proceeds without being blocked
And the system logs "would have vetoed" for testing analysis

#### Scenario: Intent proceeds when score passes threshold
Given policy "Security Behavior Gate" has status "active"
And Coder-Gamma's Security_First score is 0.93
When Coder-Gamma submits intent to deploy to production
Then the intent proceeds to normal authorization flow

#### Scenario: Multiple agents fail threshold after policy change
Given Tomasz changes TDD_Adherence threshold to 0.95
And 5 of 6 agents have scores below 0.95
When intents are submitted
Then the system creates an observation: "Policy vetoing 83% of agents. Consider threshold adjustment."

### Acceptance Criteria
- [ ] Policy rules can reference behavior metric_type and threshold
- [ ] Authorizer queries latest behavior score during policy evaluation
- [ ] Policy "testing" mode logs without blocking
- [ ] Human override available on all behavior vetos, logged with identity
- [ ] High veto rate triggers system observation

### Technical Notes
- Policy condition schema extended for behavior metric references
- Authorizer needs behavior score query (latest per identity+metric_type)
- Override endpoint creates observation with severity "info"
- Follows existing policy.rules[*].condition schema pattern

### Dependencies
- US-OB-03 (Behavior records must exist)
- Policy system (existing)
- Authorizer Agent (existing, needs extension)

### Job Story Trace
- J2: Behavioral Quality Governance

### Size Estimate
- Effort: 2-3 days
- Scenarios: 5
- Demonstrable: Submit intent, see veto or pass based on behavior score

---

## US-OB-05: Objective Progress Visibility

### Problem
Elena Vasquez created objectives (US-OB-01) and intents are being linked (US-OB-02), but she has no way to see progress toward objectives without running manual graph queries. She needs a view showing how each objective is advancing.

### Who
- Engineering Lead | Monitoring strategic progress | Wants at-a-glance objective status

### Solution
Web UI view showing objective progress: title, target date, progress bar, key results tracking, supporting intent count, unaligned intent count, related features and tasks.

### Domain Examples

#### 1: Happy Path -- Elena views objective progress
Elena opens the objective progress view for "Launch MCP Marketplace." She sees: target June 30, progress 34%, key result "10 integrations: 3/10 (30%)", 14 supporting intents this week, 2 unaligned intents flagged.

#### 2: Edge Case -- Objective with no activity
"Improve Infrastructure Reliability" has 0 supporting intents in 14 days. The view shows 0% progress with a warning badge: "No activity in 14 days."

#### 3: Error/Boundary -- Expired objective
"Q1 Launch" target date was March 1 (now past). View shows status "expired" with amber indicator and prompt: "Target date passed. Retire or extend?"

### UAT Scenarios (BDD)

#### Scenario: View active objective with progress
Given objective "Launch MCP Marketplace" has 14 supporting intents this week
And 3 of 10 target integrations completed
When Elena navigates to the objective progress view
Then she sees title "Launch MCP Marketplace", target June 30
And progress bar at 34%
And key result "10 integrations: 3/10"
And supporting intent count: 14

#### Scenario: Objective with no recent activity shows warning
Given objective "Improve Infrastructure Reliability" has 0 supporting intents in 14 days
When Elena views the objective list
Then the objective shows a warning badge "No activity in 14 days"

#### Scenario: Expired objective prompts action
Given objective "Q1 Launch" has target_date 2026-03-01 (past)
When the view renders
Then the objective shows status "expired" with amber indicator
And a prompt reads "Target date passed. Retire or extend?"

### Acceptance Criteria
- [ ] Objective view shows title, target_date, progress, key results, supporting intent count
- [ ] Inactive objectives flagged with warning badge
- [ ] Expired objectives show action prompt
- [ ] View loads within 2 seconds for up to 50 objectives

### Technical Notes
- Progress computed from supporting intents, related task completion, key result metrics
- Workspace-scoped query with objective + supports edge aggregation
- Key result tracking is string-match heuristic (not structured KPI system in v1)

### Dependencies
- US-OB-01 (Objectives exist)
- US-OB-02 (Supports edges exist)

### Job Story Trace
- J1: Strategic Alignment Governance

### Size Estimate
- Effort: 2 days
- Scenarios: 3
- Demonstrable: Navigate to objectives, see progress dashboard

---

## US-OB-06: Coherence Auditor

### Problem
Elena's knowledge graph has 847 nodes. She discovered 12 orphaned decisions (decisions with no implementing tasks) by accident during a graph visualization session. There is no systematic way to detect disconnected patterns that indicate organizational debt.

### Who
- Engineering Lead | Maintaining graph coherence | Wants automatic detection of disconnected patterns

### Solution
Observer Agent (or dedicated X-Ray Agent) runs periodic graph queries detecting disconnected patterns: objectives with no supporting intents (14-day threshold), decisions with no implementing tasks (14-day threshold), tasks with no outcome observations. Creates observations with appropriate severity.

### Domain Examples

#### 1: Happy Path -- Auditor detects orphaned decision
Decision "Standardize on tRPC" was created Feb 12 but has no implementing task after 27 days. Auditor creates observation (severity: warning): "Decision 'Standardize on tRPC' has no implementing task after 27 days." Feed card appears in governance feed.

#### 2: Edge Case -- Stale objective detected
Objective "Improve Infrastructure Reliability" has 0 supporting intents in 14 days. Auditor creates observation: "Objective has no supporting intents in 14 days. May be stale."

#### 3: Error/Boundary -- False positive for standalone observation
Observation "Interesting market trend" (severity: info) has no follow-up task. Auditor recognizes info-severity observations as expected standalone nodes and does NOT flag them.

### UAT Scenarios (BDD)

#### Scenario: Detect decision with no implementing task
Given decision "Standardize on tRPC" was created 27 days ago
And no task references this decision
When the coherence auditor runs
Then an observation is created with severity "warning"
And text includes "no implementing task after 27 days"

#### Scenario: Detect stale objective
Given objective "Improve Infrastructure Reliability" has 0 supporting intents in 14 days
When the coherence auditor runs
Then an observation is created flagging the objective as potentially stale

#### Scenario: Info-severity observations not flagged as orphans
Given observation "Market trend" exists with severity "info" and no follow-up task
When the coherence auditor runs
Then no coherence warning is created for this observation

#### Scenario: Coherence score computed
Given the workspace has 100 nodes
And 12 are flagged as disconnected
When the coherence auditor computes the coherence score
Then the score is 0.88 (88 of 100 properly connected)

### Acceptance Criteria
- [ ] Detects decisions with no implementing task after 14 days
- [ ] Detects objectives with no supporting intents after 14 days
- [ ] Info-severity observations excluded from orphan detection
- [ ] Coherence score computed per workspace
- [ ] Auditor completes within 30 seconds for up to 5,000 nodes

### Technical Notes
- Graph queries against decision, task, objective, observation tables
- Staleness threshold configurable (default 14 days)
- Coherence score = properly-connected nodes / total nodes
- Creates observations via existing observation system

### Dependencies
- US-OB-01 (Objectives) and US-OB-02 (Supports edges) for objective coherence checks
- Existing observation system
- Existing decision, task tables

### Job Story Trace
- J3: Organizational Coherence Auditing

### Size Estimate
- Effort: 2 days
- Scenarios: 4
- Demonstrable: Run auditor, see coherence observations in feed

---

## US-OB-07: Observer Behavior Learning Loop

### Problem
Tomasz can see behavior scores and enforce policy gates (US-OB-04), but underperforming agents keep making the same mistakes. There is no mechanism to teach agents to improve based on behavioral telemetry -- only to block them. Coder-Beta keeps ignoring CVE advisories because nothing in its prompt tells it to prioritize them. The Observer Agent already proposes learnings from observation clusters (PR #145), but it cannot consume behavior records as input signals -- it only sees graph-level contradictions, not craftsmanship degradation.

### Who
- Platform Engineer | Improving agent quality over time | Wants agents that learn from behavioral feedback

### Solution
Observer Agent extended to consume behavior records as input signals for its existing learning proposal pipeline. When the Observer detects `behavioral_drift` patterns from behavior telemetry (3+ consecutive below-threshold sessions), it proposes targeted learnings via the existing learning API. Learnings pass three-layer collision detection and dual-gate safety, require human approval, and are injected into agent prompts via JIT prompt injection.

### Domain Examples

#### 1: Happy Path -- Observer proposes learning for Coder-Beta
Coder-Beta's Security_First has been below 0.80 for 3 consecutive sessions. Observer Agent clusters behavior records, classifies root cause as `behavioral_drift`, and proposes a learning via `POST /api/workspaces/:workspaceId/learnings`: text "Always address CVE advisories present in your context window before proceeding with feature work", learning_type "instruction", target_agents ["coder-beta"], priority "high", source "agent", suggested_by "observer". The learning passes collision detection (no duplicate at 0.90, no policy contradiction at 0.40, no decision conflict at 0.55) and dual-gate safety (3/5 rate limit used, no dismissed match at 0.85). Tomasz approves in the Learning Library. Next session, this instruction appears in Coder-Beta's system prompt via JIT injection.

#### 2: Edge Case -- Learning proves effective
After 5 sessions with the learning active, Coder-Beta's Security_First improved from 0.65 to 0.88. Observer detects the improvement trend and creates an observation: "Coder-Beta's Security_First improved from 0.65 to 0.88 after learning injection." Feed card appears in governance feed.

#### 3: Error/Boundary -- Learning proves ineffective
After 5 sessions, Coder-Delta's TDD_Adherence did not improve (still 0.45). Observer detects no improvement and creates an observation with severity "warning": "Learning 'Write tests before implementation' has not improved Coder-Delta's TDD_Adherence after 5 sessions. Human review needed." Tomasz can deactivate the learning via `POST /api/workspaces/:workspaceId/learnings/:id/actions` with action "deactivate".

#### 4: Error/Boundary -- Observer rate-limited
Observer has already proposed 5 learnings for Coder-Alpha in the past 7 days. When it detects another behavioral_drift pattern, the dual-gate rate limit blocks the proposal. Observer creates an observation noting the pattern for human review instead.

#### 5: Error/Boundary -- Learning collides with existing policy
Observer proposes a learning for Coder-Gamma that contradicts an active policy (collision score 0.45 > 0.40 threshold). Three-layer collision detection blocks the learning with a hard policy contradiction. Observer is notified; Tomasz reviews the conflict in the Learning Library.

### UAT Scenarios (BDD)

#### Scenario: Observer proposes learning for underperforming agent
Given Coder-Beta's Security_First has been below 0.80 for 3 consecutive sessions
And source telemetry shows 2 CVE advisories ignored
When the Observer Agent clusters behavior records and classifies root cause as "behavioral_drift"
Then a learning is proposed via POST /api/workspaces/:workspaceId/learnings with:
  | field         | value                    |
  | learning_type | instruction              |
  | status        | pending_approval         |
  | source        | agent                    |
  | suggested_by  | observer                 |
  | target_agents | ["coder-beta"]           |
  | priority      | high                     |
And the learning passes three-layer collision detection
And the learning passes dual-gate safety checks
And a learning_evidence edge links to the triggering behavior records

#### Scenario: Learning approved and injected into agent session
Given a learning exists for Coder-Beta with status "pending_approval"
When Tomasz approves the learning via the Learning Library
Then the learning status transitions to "active"
And when Coder-Beta starts a new agent session
Then the learning is loaded via JIT prompt injection (500-token budget)

#### Scenario: Effective learning detected by Observer
Given Coder-Beta received a learning 5 sessions ago
And Security_First scores since: [0.70, 0.75, 0.82, 0.85, 0.88]
When the Observer evaluates behavior trends
Then an observation is created noting the improvement
And a feed card reports the score improvement

#### Scenario: Ineffective learning surfaced for human review
Given Coder-Delta received a learning 5 sessions ago
And TDD_Adherence scores since: [0.44, 0.45, 0.43, 0.46, 0.45]
When the Observer evaluates behavior trends
Then an observation is created with severity "warning" noting no improvement
And a feed card surfaces the learning for human review
And Tomasz can deactivate the learning via the Learning Library

#### Scenario: Observer rate-limited by dual-gate safety
Given the Observer has proposed 5 learnings for Coder-Alpha in the last 7 days
When the Observer detects another behavioral_drift pattern for Coder-Alpha
Then no new learning is proposed
And an observation is created noting the pattern for human review

#### Scenario: Learning blocked by policy collision
Given an active policy contradicts the proposed learning (collision score > 0.40)
When the Observer attempts to propose the learning
Then the learning is blocked by three-layer collision detection
And the Observer creates an observation noting the policy-learning conflict

### Acceptance Criteria
- [ ] Observer extended to consume behavior records as input signals for root cause analysis
- [ ] Learning proposed only for 3+ consecutive below-threshold sessions (trend, not snapshot)
- [ ] Learning proposed via existing API (POST /api/workspaces/:workspaceId/learnings) with source "agent", suggested_by "observer"
- [ ] Three-layer collision detection prevents duplicate/contradictory learnings
- [ ] Dual-gate safety enforced (rate limit 5/agent/7 days + dismissed similarity 0.85)
- [ ] Learning requires human approval (pending_approval -> active) before JIT injection
- [ ] Active learning injected via JIT prompt injection (500-token budget)
- [ ] Learning effectiveness tracked by comparing behavior scores before/after via learning_evidence edges
- [ ] Ineffective learnings surfaced for human review via observations
- [ ] Learning references triggering behavior records via learning_evidence relation

### Technical Notes
- Observer Agent extended with behavior record clustering (new input signal type alongside observations)
- Uses existing learning API endpoints: POST/GET/PUT `/api/workspaces/:workspaceId/learnings`, actions endpoint
- Uses existing three-layer collision detection (learning vs learning 0.90, vs policy 0.40, vs decision 0.55)
- Uses existing dual-gate safety (rate limit 5/agent/7 days + dismissed similarity check 0.85)
- Uses existing JIT prompt injection (500-token budget, constraints always, instructions by priority)
- Uses existing Learning Library UI for human approval workflow
- Uses existing learning_evidence relation for provenance tracking
- Learning types: "instruction" for behavioral guidance, "constraint" for hard safety rules
- Root cause classification: behavioral_drift (from behavior records) vs policy_failure, context_failure (from observations)

### Dependencies
- US-OB-03 (Behavior records must exist for Observer to consume)
- Learning system (PR #145 -- IMPLEMENTED): learning table, learning CRUD API, collision detection, JIT injection, Learning Library UI
- Observer Agent (existing, needs extension to consume behavior records as input signals)

### Job Story Trace
- J2: Behavioral Quality Governance
- J3: Organizational Coherence Auditing

### Size Estimate
- Effort: 2 days
- Scenarios: 6
- Demonstrable: Trigger behavior pattern, see Observer propose learning, approve in Learning Library, verify JIT injection
