# Acceptance Criteria: Objective & Behavior Nodes

All acceptance criteria derived from UAT scenarios in user stories. Organized by story with Given/When/Then format.

---

## US-OB-01: Create Strategic Objectives

### AC-01.1: Objective creation from chat
```gherkin
Given Elena Vasquez is in a conversation in workspace "BrainOS"
When Elena sends "Our Q2 objective is to launch the MCP marketplace with 10 listed integrations by June 30"
Then an objective node is created with:
  | field             | value                        |
  | title             | Launch MCP Marketplace       |
  | target_date       | 2026-06-30                   |
  | success_criteria  | ["10 listed integrations"]   |
  | priority          | 90                           |
  | status            | active                       |
And the objective is scoped to workspace "BrainOS"
And an embedding is generated for semantic matching
```

### AC-01.2: Missing target date prompts user
```gherkin
Given Elena sends "We need to improve infrastructure reliability this quarter"
When the extraction pipeline processes the message
Then an objective node is created without target_date
And the system prompts Elena: "What is the target date for this objective?"
```

### AC-01.3: Duplicate objective detection
```gherkin
Given objective "Launch MCP Marketplace" exists with status "active" in workspace "BrainOS"
When Elena sends "Our goal is to launch the MCP marketplace"
Then the extraction pipeline computes semantic similarity above 0.95
And no new objective is created
And Elena sees: "An active objective 'Launch MCP Marketplace' already exists. Would you like to update it?"
```

### AC-01.4: Objective workspace scoping
```gherkin
Given Elena is in workspace "BrainOS"
When an objective is created
Then the objective has workspace reference to "BrainOS"
And the objective is not visible from workspace "OtherCorp"
```

---

## US-OB-02: Automatic Intent-Objective Alignment

### AC-02.1: Automatic alignment with supports edge
```gherkin
Given objective "Launch MCP Marketplace" exists with status "active" and embedding
When Coder-Alpha submits intent with goal "Implement MCP tool discovery endpoint"
Then the Authorizer computes semantic similarity between intent goal and active objectives
And the similarity with "Launch MCP Marketplace" exceeds 0.7
And a supports edge is created: intent ->supports-> objective
And the intent proceeds to authorization evaluation
```

### AC-02.2: Unaligned intent warning
```gherkin
Given objective "Launch MCP Marketplace" is the only active objective
When Coder-Beta submits intent with goal "Refactor logging subsystem to use structured logs"
Then the Authorizer finds no objective match above 0.5
And an observation is created with severity "warning" and text containing "organizational waste"
And the intent is NOT blocked
And a feed card appears with actions "Link to Objective", "Dismiss", "Create Objective"
```

### AC-02.3: Manual linking from feed card
```gherkin
Given an alignment warning observation exists for intent "Refactor logging subsystem"
When Elena clicks "Link to Objective" and selects "Improve Infrastructure Reliability"
Then a supports edge is created between the intent and selected objective
And the warning observation status transitions to "resolved"
```

### AC-02.4: No objectives in workspace
```gherkin
Given no objectives exist in workspace "BrainOS"
When Coder-Alpha submits an intent
Then a feed card appears: "No objectives defined. Agent work is untracked."
And the intent proceeds without alignment check
```

### AC-02.5: Alignment evaluation performance
```gherkin
@property
Given the intent authorization pipeline processes intents
Then objective alignment evaluation completes within 200ms
And alignment evaluation never blocks intent execution in warning mode
```

---

## US-OB-03: Behavioral Telemetry Collection

### AC-03.1: TDD_Adherence behavior record
```gherkin
Given metric type "TDD_Adherence" is registered
And Coder-Alpha completes a session changing 12 files with 2 test files
When the Observer Agent evaluates session telemetry
Then a behavior record is created with metric_type "TDD_Adherence" and score 0.42
And source_telemetry contains files_changed: 12 and test_files_changed: 2
And an exhibits edge links identity:coder-alpha to the behavior record
```

### AC-03.2: Security_First behavior record
```gherkin
Given metric type "Security_First" is registered
And Coder-Beta completes a session with 2 CVE advisories in context, 1 addressed
When the Observer Agent evaluates session telemetry
Then a behavior record is created with metric_type "Security_First" and score 0.65
And source_telemetry includes cve_advisories_in_context: 2 and cve_advisories_addressed: 1
```

### AC-03.3: New agent with no data
```gherkin
Given agent identity "Coder-New" has completed no sessions
When Tomasz views the behavior dashboard
Then "Coder-New" appears with "--" for all metric scores
And a note reads "No behavior data yet"
```

### AC-03.4: Telemetry failure resilience
```gherkin
Given Coder-Alpha completes a session
And the telemetry source is unavailable
When the Observer Agent attempts evaluation
Then no behavior record is written for this session
And the agent session was not blocked or delayed
And the Observer Agent retries on next evaluation cycle
```

---

## US-OB-04: Behavior-Based Policy Enforcement

### AC-04.1: Intent vetoed by behavior policy
```gherkin
Given policy "Security Behavior Gate" has status "active" with rule:
  | condition         | effect | priority |
  | Security_First<0.8 | deny  | 100      |
And Coder-Beta's latest Security_First score is 0.65
When Coder-Beta submits intent to deploy to production
Then the Authorizer queries Coder-Beta's latest Security_First score
And the score 0.65 is below threshold 0.80
And the intent evaluation is set to decision "REJECT"
And the intent status transitions to "vetoed"
And a feed card shows the veto with policy name, score, threshold, and override option
```

### AC-04.2: Human override of behavior veto
```gherkin
Given Coder-Beta's deploy intent was vetoed by "Security Behavior Gate"
When Tomasz clicks "Override (human)" on the feed card
Then the intent status transitions from "vetoed" to "authorized"
And an observation is created with severity "info" logging the override
And the override includes Tomasz's identity for audit trail
```

### AC-04.3: Testing mode observes without blocking
```gherkin
Given policy "TDD Quality Gate" has status "testing"
And Coder-Alpha's TDD_Adherence is 0.42 (below policy threshold 0.70)
When Coder-Alpha submits an intent
Then the intent proceeds without being blocked
And the system logs that the intent would have been vetoed
And the testing analysis records the would-be-vetoed intent
```

### AC-04.4: Intent passes when score above threshold
```gherkin
Given policy "Security Behavior Gate" has status "active"
And Coder-Gamma's latest Security_First score is 0.93
When Coder-Gamma submits intent to deploy to production
Then the Authorizer finds score 0.93 passes threshold 0.80
And the intent proceeds to normal authorization flow
And no feed card is generated for this evaluation
```

### AC-04.5: High veto rate detection
```gherkin
Given policy "TDD Quality Gate" has status "active" with threshold 0.95
And 5 of 6 coding agents have TDD_Adherence below 0.95
When multiple intents are vetoed in a short period
Then the system creates an observation with severity "warning"
And text includes "Policy vetoing 83% of agents. Consider threshold adjustment."
```

---

## US-OB-05: Objective Progress Visibility

### AC-05.1: Active objective progress display
```gherkin
Given objective "Launch MCP Marketplace" has 14 supporting intents this week
And 3 of 10 target integrations are completed
When Elena navigates to the objective progress view
Then she sees title "Launch MCP Marketplace"
And target date "June 30, 2026"
And progress bar showing 34%
And key result "10 listed integrations: 3/10 (30%)"
And supporting intent count: 14
And unaligned intents flagged: 2
```

### AC-05.2: Inactive objective warning
```gherkin
Given objective "Improve Infrastructure Reliability" has 0 supporting intents in 14 days
When Elena views the objective list
Then the objective shows a warning badge "No activity in 14 days"
```

### AC-05.3: Expired objective prompt
```gherkin
Given objective "Q1 Launch" has target_date 2026-03-01 (in the past)
When the view renders
Then the objective shows status "expired" with amber indicator
And a prompt reads "Target date passed. Retire or extend?"
```

---

## US-OB-06: Coherence Auditor

### AC-06.1: Orphaned decision detection
```gherkin
Given decision "Standardize on tRPC" was created 27 days ago in workspace "BrainOS"
And no task references this decision via belongs_to or depends_on edges
When the coherence auditor runs
Then an observation is created with severity "warning"
And text includes "no implementing task after 27 days"
And a feed card appears in the governance feed
```

### AC-06.2: Stale objective detection
```gherkin
Given objective "Improve Infrastructure Reliability" has 0 supporting intents in 14 days
When the coherence auditor runs
Then an observation is created with text "Objective has no supporting intents in 14 days"
```

### AC-06.3: Info observations excluded from orphan detection
```gherkin
Given observation "Interesting market trend" exists with severity "info"
And the observation has no follow-up task
When the coherence auditor runs
Then no coherence warning is created for this observation
```

### AC-06.4: Coherence score computation
```gherkin
Given workspace "BrainOS" has 100 graph nodes
And 12 nodes are flagged as disconnected by the auditor
When the coherence score is computed
Then the score is 0.88
```

---

## US-OB-07: Observer Behavior Learning Loop

### AC-07.1: Observer proposes learning for sustained underperformance
```gherkin
Given Coder-Beta's Security_First has been below 0.80 for 3 consecutive sessions
And source telemetry shows 2 CVE advisories ignored across sessions
When the Observer Agent clusters behavior records and classifies root cause as "behavioral_drift"
Then the Observer proposes a learning via POST /api/workspaces/:workspaceId/learnings with:
  | field           | value              |
  | learning_type   | instruction        |
  | status          | pending_approval   |
  | source          | agent              |
  | suggested_by    | observer           |
  | target_agents   | ["coder-beta"]     |
  | priority        | high               |
And the learning passes three-layer collision detection (learning 0.90, policy 0.40, decision 0.55)
And the learning passes dual-gate safety (rate limit 5/agent/7 days + dismissed similarity 0.85)
And a learning_evidence edge links the learning to the triggering behavior records
And a feed card notifies Tomasz about the proposed learning
```

### AC-07.2: Learning approved and injected via JIT prompt injection
```gherkin
Given a learning exists for Coder-Beta with status "pending_approval"
When Tomasz approves the learning via POST /api/workspaces/:workspaceId/learnings/:id/actions with action "approve"
Then the learning status transitions to "active"
And when Coder-Beta starts a new agent session
Then the learning is loaded via JIT prompt injection within the 500-token budget
And instructions are loaded by priority (high before medium/low)
```

### AC-07.3: Effective learning detected by Observer
```gherkin
Given Coder-Beta received learning "Security Advisory Compliance" 5 sessions ago
And Security_First scores since: [0.70, 0.75, 0.82, 0.85, 0.88]
When the Observer evaluates behavior trends
Then an observation is created noting the score improvement (0.65 to 0.88)
And a feed card reports the improvement
```

### AC-07.4: Ineffective learning escalation
```gherkin
Given Coder-Delta received learning "Write tests before implementation" 5 sessions ago
And TDD_Adherence scores since: [0.44, 0.45, 0.43, 0.46, 0.45]
When the Observer evaluates behavior trends
Then an observation is created with severity "warning" noting no improvement
And a feed card surfaces the learning for human review
And Tomasz can deactivate via POST /api/workspaces/:workspaceId/learnings/:id/actions with action "deactivate"
```

### AC-07.5: Observer rate-limited by dual-gate safety
```gherkin
Given the Observer has proposed 5 learnings for Coder-Alpha in the last 7 days
When the Observer detects another behavioral_drift pattern for Coder-Alpha
Then no new learning is proposed
And the Observer creates an observation noting the pattern for human review
```

### AC-07.6: Learning blocked by policy collision
```gherkin
Given an active policy exists that contradicts the proposed learning
And the collision score exceeds the policy threshold of 0.40
When the Observer attempts to propose the learning
Then the learning is blocked by three-layer collision detection
And the Observer creates an observation noting the policy-learning conflict
```
