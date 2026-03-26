<!-- markdownlint-disable MD024 -->

## US-01: Evidence Schema and Intent Submission

### Problem

Ravi Patel is a workspace administrator managing 4 autonomous agents across supply chain operations. When the Logistics-Planner agent requests authorization to reroute Southeast Asia orders, the intent contains only free-text `goal` and `reasoning` fields. Ravi finds it impossible to verify whether the agent's justification is grounded in real system state or fabricated, because there is no structured link between the intent and the graph records that supposedly justify it.

### Who

- Autonomous agent | Submitting intents for high-stakes actions | Needs to express evidence for authorization
- Workspace administrator | Reviewing agent intent requests | Needs structured evidence to evaluate legitimacy

### Solution

Add an `evidence_refs` field to the intent schema and creation API, allowing agents to submit typed references to existing graph records (decisions, tasks, observations, policies, etc.) alongside their authorization requests.

### Domain Examples

#### 1: Supply Chain Routing Change -- Logistics-Planner submits intent with decision and task evidence

Logistics-Planner creates intent to reroute Southeast Asia orders through regional warehouse. It includes `evidence_refs` pointing to confirmed decision "Switch to regional warehousing" (decision:abc123) and completed task "Audit fulfillment SLAs" (task:def456). The intent record stores both the free-text reasoning and the typed evidence references.

#### 2: Compliance Escalation -- Compliance-Agent submits intent with observation evidence

Compliance-Agent creates intent to escalate a supplier audit finding. It includes `evidence_refs` pointing to verified observation "Supplier failed ISO 9001 re-certification" (observation:ghi789). The observation has confidence 0.92 and was created by the Observer agent.

#### 3: No Evidence Provided -- Agent submits intent with empty evidence

Logistics-Planner creates intent to update pricing rules but provides no `evidence_refs`. The intent is accepted (the field is optional at this stage) but flagged as having zero evidence references for downstream verification.

### UAT Scenarios (BDD)

#### Scenario: Agent submits intent with evidence references

Given the Logistics-Planner agent wants to reroute Southeast Asia orders
And confirmed decision "Switch to regional warehousing" exists as decision:abc123
And completed task "Audit fulfillment SLAs" exists as task:def456
When the agent creates an intent with evidence_refs [decision:abc123, task:def456]
Then the intent is created with status "draft"
And the intent record contains 2 evidence references
And each evidence reference is a valid RecordId

#### Scenario: Agent submits intent without evidence references

Given the Logistics-Planner agent wants to update pricing rules
When the agent creates an intent with no evidence_refs
Then the intent is created with status "draft"
And the evidence_refs field is omitted from the record

#### Scenario: Agent submits intent with invalid reference format

Given the Logistics-Planner agent creates an intent
And the evidence_refs contain a reference to an unsupported table type "message:xyz"
When the intent creation is attempted
Then the creation fails with a schema validation error
And the error identifies the invalid reference type

### Acceptance Criteria

- [ ] Intent schema in SurrealDB includes `evidence_refs` field typed as `option<array<record<decision | task | feature | project | observation | policy | objective | learning | git_commit>>>`
- [ ] Intent creation API accepts `evidence_refs` as an optional array of RecordId references
- [ ] IntentRecord TypeScript type includes `evidence_refs?: RecordId[]`
- [ ] CreateIntentParams accepts `evidence_refs` parameter
- [ ] Intents without evidence_refs are accepted (field is optional)

### Outcome KPIs

- **Who**: Autonomous agents
- **Does what**: Submit intents with evidence_refs containing valid graph record references
- **By how much**: Field available on 100% of new intents; adoption measured in KPI-1
- **Measured by**: Schema validation + intent creation acceptance tests
- **Baseline**: 0% (field does not exist)

### Technical Notes

- Schema migration: add `evidence_refs` field to intent table in SurrealDB
- The evidence_refs type set should be compatible with (but not identical to) the existing `observation.evidence_refs` type
- RecordId wire format: polymorphic `table:id` references, parsed at HTTP boundary per AGENTS.md convention

---

## US-02: Deterministic Evidence Verification Pipeline

### Problem

Ravi Patel manages autonomous agents that now submit evidence references with their intents. But references alone are not proof -- an agent could cite a non-existent record, a record from a different workspace, or a superseded decision. Ravi finds it alarming that the authorization system would accept these references at face value, because a compromised agent could fabricate evidence IDs without any check.

### Who

- Workspace administrator | Trusting the authorization system | Needs certainty that evidence references point to real, valid records
- Intent authorization pipeline | Evaluating intents | Needs fast, deterministic pre-LLM verification

### Solution

A deterministic verification pipeline that checks each evidence reference before LLM evaluation: existence, workspace scope containment, temporal ordering, and entity status liveness. Results are stored on the intent record.

### Domain Examples

#### 1: All References Valid -- Supply chain intent with 3 verified references

Logistics-Planner submits intent with evidence_refs [decision:abc123, task:def456, observation:ghi789]. Pipeline verifies: all 3 exist in workspace "Acme Supply Chain", all created before the intent, decision is confirmed, task is completed, observation is open with confidence 0.85. Result: verified_count=3, failed_refs=[], verification_time_ms=18.

#### 2: Non-Existent Reference -- Agent cites record that does not exist

Logistics-Planner submits intent with evidence_ref observation:fake123. Pipeline queries SurrealDB -- record not found. Result: failed_refs=["observation:fake123"], verified_count=0.

#### 3: Superseded Decision -- Agent cites outdated evidence

Logistics-Planner references decision:old456 which has status "superseded" (replaced by a newer version). Pipeline checks liveness: status not in valid set. Result: failed_refs=["decision:old456"], warnings=["Referenced decision has been superseded"].

### UAT Scenarios (BDD)

#### Scenario: Pipeline verifies all references in a single batched query

Given an intent with evidence_refs [decision:abc123, task:def456, observation:ghi789]
And all 3 records exist in workspace "Acme Supply Chain"
And decision:abc123 has status "confirmed"
And task:def456 has status "completed"
And observation:ghi789 has status "open"
When the verification pipeline runs
Then evidence_verification.verified_count is 3
And evidence_verification.failed_refs is empty
And evidence_verification.verification_time_ms is less than 100

#### Scenario: Pipeline catches non-existent reference

Given an intent with evidence_ref observation:does-not-exist
When the verification pipeline runs
Then evidence_verification.failed_refs contains "observation:does-not-exist"
And evidence_verification.verified_count is 0

#### Scenario: Pipeline catches cross-workspace reference

Given an intent in workspace "Acme Supply Chain"
And evidence_ref decision:xyz789 belongs to workspace "Other Organization"
When the verification pipeline runs
Then evidence_verification.failed_refs contains "decision:xyz789"

#### Scenario: Pipeline catches superseded decision

Given decision:old456 has status "superseded"
And an intent references decision:old456 as evidence
When the verification pipeline runs
Then evidence_verification.failed_refs contains "decision:old456"
And evidence_verification.warnings contains "Referenced decision has been superseded"

#### Scenario: Pipeline catches evidence created after intent

Given an intent created at 2026-03-25T10:00:00Z
And evidence_ref observation:future created at 2026-03-25T10:05:00Z
When the verification pipeline runs
Then evidence_verification.failed_refs contains the future-dated reference

### Acceptance Criteria

- [ ] Verification pipeline checks: existence, workspace scope, temporal ordering, status liveness
- [ ] All checks execute in a single batched SurrealDB query (one round-trip)
- [ ] Verification result stored on intent record as `evidence_verification` object
- [ ] Failed refs individually identified with failure reason
- [ ] Pipeline completes before LLM evaluation begins
- [ ] Valid statuses per entity type: decision=confirmed, task=in_progress/completed, observation=open, policy=active

### Outcome KPIs

- **Who**: Evidence verification pipeline
- **Does what**: Catches 100% of non-existent, cross-workspace, temporally invalid, or status-invalid evidence references
- **By how much**: Zero false negatives on deterministic checks
- **Measured by**: Acceptance test suite covering all check types
- **Baseline**: N/A (pipeline does not exist)

### Technical Notes

- Batch verification query design per research doc: single `SELECT` with workspace WHERE clause
- Cap max evidence_refs at 10 per intent to bound query complexity
- Pipeline must run synchronously in the evaluation flow, before LLM call
- Verification step adds to `evaluateIntent()` in authorizer.ts

---

## US-03: Soft Enforcement in Risk Router

### Problem

Ravi Patel wants evidence-backed authorization but cannot flip a hard switch overnight -- existing agent workflows have no evidence references yet. Ravi finds it risky to either ignore evidence quality entirely (no security improvement) or enforce it strictly (breaks all existing agents). He needs a gradual ramp that incentivizes evidence without blocking legitimate work.

### Who

- Workspace administrator | Adopting evidence requirements gradually | Needs enforcement that ramps from advisory to mandatory
- Autonomous agent | Adapting to evidence requirements | Needs clear feedback on evidence shortfalls without hard rejection

### Solution

Soft enforcement mode where evidence shortfalls add to the intent's risk score rather than causing rejection. Each missing evidence reference (below the tier minimum) adds a configurable penalty (default +20) to the effective risk score. This naturally routes under-evidenced intents to human veto windows without rejecting them outright.

### Domain Examples

#### 1: Evidence Shortfall Elevates Risk -- Logistics-Planner provides 1 ref for medium-risk intent

Logistics-Planner submits intent to update supplier routing with risk score 25 (would normally auto-approve). Intent requires 2 evidence refs for medium risk but provides only 1. Soft enforcement adds +20 penalty. Effective risk score: 45. Routing decision: veto_window instead of auto_approve.

#### 2: Full Evidence Keeps Risk Unchanged -- Agent provides all required refs

Logistics-Planner submits intent with risk score 25 and provides 2 evidence refs (meeting medium-risk requirement). No penalty applied. Effective risk score: 25. Routing decision: auto_approve.

#### 3: Zero Evidence on Low-Risk Intent -- Minimal impact

Logistics-Planner submits low-risk intent (score 10) to read supplier data with 0 evidence refs. Low-risk tier requires 1 ref. Penalty +20. Effective score: 30. Still auto-approves at threshold boundary.

### UAT Scenarios (BDD)

#### Scenario: Evidence shortfall adds penalty to risk score

Given the workspace evidence enforcement is "soft"
And an intent with LLM risk score 25
And the intent requires 2 evidence refs for medium risk but provides 1
When the risk router evaluates the intent
Then the effective risk score is 45
And the routing decision is "veto_window"

#### Scenario: Full evidence keeps risk score unchanged

Given the workspace evidence enforcement is "soft"
And an intent with LLM risk score 25
And the intent provides 2 verified evidence refs (meeting medium-risk requirement)
When the risk router evaluates the intent
Then the effective risk score is 25
And the routing decision is "auto_approve"

#### Scenario: Workspace enforcement mode is read from workspace record

Given workspace "Acme Supply Chain" has evidence_enforcement set to "soft"
When an intent in this workspace is evaluated
Then the verification pipeline applies soft enforcement rules
And the risk router applies evidence penalty logic

### Acceptance Criteria

- [ ] Workspace schema includes `evidence_enforcement` field with values "bootstrap", "soft", "hard"
- [ ] Default evidence_enforcement for existing workspaces is "soft"
- [ ] Soft enforcement adds +20 risk score per missing evidence ref below tier minimum
- [ ] Evidence shortfall penalty is configurable per workspace
- [ ] Risk router reads enforcement mode from workspace record at evaluation time
- [ ] Effective risk score is visible in evaluation result

### Outcome KPIs

- **Who**: Autonomous agents under soft enforcement
- **Does what**: Receive risk score adjustments that incentivize evidence without hard rejection
- **By how much**: Under-evidenced intents route to veto window instead of auto-approve
- **Measured by**: Query: intents where effective_risk_score > evaluation.risk_score (evidence penalty applied)
- **Baseline**: N/A

### Technical Notes

- New field on workspace table: `evidence_enforcement` with default "soft"
- Risk-tiered evidence requirements as constants: low=1, medium=2, high=3
- Penalty per shortfall: configurable, default 20 points
- The penalty is applied after LLM evaluation, before risk routing decision

---

## US-04: Verification Result Storage and LLM Context Enrichment

### Problem

Ravi Patel reviews intents in the governance feed but currently has no way to see whether evidence references were verified or not. The verification pipeline runs but its results vanish after routing. Ravi finds it frustrating that evidence quality information exists during evaluation but is not persisted for human review or audit.

### Who

- Workspace administrator | Reviewing pending intents | Needs verification results visible on intent records
- LLM evaluator | Assessing intent risk | Needs verified evidence context for better risk assessment

### Solution

Store the verification result as `evidence_verification` on the intent record in SurrealDB. Pass the verification summary to the LLM evaluator as additional context, improving the quality of risk assessment.

### Domain Examples

#### 1: Full Verification Stored -- 3/3 verified

Intent for supply chain routing change has 3 evidence refs, all verified. evidence_verification stored: `{ verified_count: 3, failed_refs: [], verification_time_ms: 18, warnings: [] }`. LLM receives "3 evidence references verified: 1 confirmed decision, 1 completed task, 1 verified observation."

#### 2: Partial Verification Stored -- 2/3 verified

Intent has 3 evidence refs but 1 is superseded. evidence_verification stored: `{ verified_count: 2, failed_refs: ["decision:old456"], verification_time_ms: 22, warnings: ["Referenced decision has been superseded"] }`. LLM receives warning about weak evidence.

#### 3: Audit Trail Query -- Ravi searches for intents with evidence failures

Ravi queries: "Show me all intents in the last 7 days where evidence verification had failures." Result: 3 intents with failed_refs, all from the same agent. Pattern suggests the agent's evidence logic needs updating.

### UAT Scenarios (BDD)

#### Scenario: Verification result persisted on intent record

Given an intent with 3 evidence refs that all pass verification
When the verification pipeline completes
Then the intent record in SurrealDB contains evidence_verification.verified_count = 3
And evidence_verification.verification_time_ms is populated
And evidence_verification is queryable via SurrealQL

#### Scenario: LLM evaluator receives evidence context

Given an intent with 2 verified evidence refs and 1 failed ref
When the LLM evaluator is called
Then the evaluator prompt includes a summary of evidence verification results
And the summary identifies the verified and failed references

#### Scenario: Failed refs are individually identified

Given an intent where evidence_ref decision:old456 fails liveness check
When the verification result is stored
Then evidence_verification.failed_refs contains "decision:old456"
And evidence_verification.warnings describes the failure reason

### Acceptance Criteria

- [ ] Intent schema includes `evidence_verification` object with verified_count, failed_refs, verification_time_ms, warnings
- [ ] Verification result is stored on intent record after pipeline completes
- [ ] LLM evaluator prompt includes evidence verification summary
- [ ] Failed refs and warnings are individually identifiable
- [ ] evidence_verification is queryable via SurrealQL for audit purposes

### Outcome KPIs

- **Who**: LLM evaluator
- **Does what**: Receives evidence context and factors it into risk assessment
- **By how much**: All evaluated intents include evidence context in evaluator prompt
- **Measured by**: Evaluator prompt content in trace records
- **Baseline**: 0% (no evidence context in evaluator today)

### Technical Notes

- Schema: `evidence_verification` object with nested fields on intent table
- LLM evaluator prompt enrichment in `createLlmEvaluator()` or in the prompt assembly in `authorizer.ts`
- Verification result must be written to the intent record before LLM evaluation call

---

## US-05: Authorship Independence Check

### Problem

Ravi Patel has learned that the Logistics-Planner agent can create observations in the graph. This means a compromised agent could create an observation, then immediately reference it as "evidence" in an intent -- fabricating its own justification. Ravi finds it deeply concerning that an agent can be both the author of evidence and the consumer of that evidence for high-stakes authorization.

### Who

- Workspace administrator | Preventing self-referencing evidence loops | Needs assurance that evidence has independent provenance
- Security auditor | Reviewing authorization integrity | Needs verifiable authorship independence in evidence chains

### Solution

For medium and high-risk intents, the verification pipeline checks that a minimum number of evidence references are authored by identities other than the intent requester. The constraint is independence of authorship -- the requester cannot be the sole source of its own evidence.

### Domain Examples

#### 1: Independent Evidence Passes -- Mixed authorship on compliance escalation

Compliance-Agent submits high-risk intent with 3 evidence refs. Ref 1: decision confirmed by Ravi Patel (human). Ref 2: task completed by Compliance-Agent itself. Ref 3: observation created by Observer agent. Required: 2 independent refs for high risk. Result: 2 refs (Ravi + Observer) are independent. Check passes.

#### 2: Self-Referencing Fails -- All evidence authored by requester

Logistics-Planner submits high-risk intent with 3 evidence refs. All 3 are observations created by Logistics-Planner itself. Required: 2 independent refs. Result: 0 independent refs. Authorship independence fails. Warning: "Insufficient independent evidence: 0 of 2 required."

#### 3: Agent-Confirmed Evidence Counts -- Non-requester agent confirms decision

Architect agent confirms decision "Migrate to microservices architecture." Logistics-Planner references this decision in its intent. Even though confirmation was by an agent (not a human), it counts as independent because the confirmer is a different identity than the requester.

### UAT Scenarios (BDD)

#### Scenario: High-risk intent with sufficient independent evidence

Given a high-risk intent requiring 2 independent evidence refs
And the intent requester is "logistics-planner-001"
And evidence_refs include:
  | ref             | author         |
  | decision:abc123 | ravi-patel     |
  | task:def456     | logistics-001  |
  | observation:ghi | observer-agent |
When the verification pipeline checks authorship independence
Then 2 refs are authored by identities other than the requester
And the authorship independence requirement is satisfied

#### Scenario: Self-referencing evidence fails for high-risk intent

Given a high-risk intent requiring 2 independent evidence refs
And the intent requester is "logistics-planner-001"
And all 3 evidence refs are authored by "logistics-planner-001"
When the verification pipeline checks authorship independence
Then 0 refs are from independent identities
And the authorship independence requirement fails
And evidence_verification.warnings contains "Insufficient independent evidence: 0 of 2 required"

#### Scenario: Agent-confirmed evidence counts as independent

Given decision:abc123 confirmed by "architect-agent" (not the requester)
And the intent requester is "logistics-planner-001"
When the verification pipeline checks authorship for decision:abc123
Then the decision counts as independently authored evidence

#### Scenario: Low-risk intent has no authorship requirement

Given a low-risk intent (risk score 15)
And the intent requester authored all evidence refs
When the verification pipeline runs
Then authorship independence is not checked
And no warning is generated

### Acceptance Criteria

- [ ] Verification pipeline resolves the author/source_agent of each evidence reference
- [ ] For medium-risk intents: at least 1 evidence ref must be authored by a different identity than the requester
- [ ] For high-risk intents: at least 2 evidence refs must be authored by different identities than the requester
- [ ] Low-risk intents have no authorship requirement
- [ ] Agent-confirmed entities count as independent (the constraint is requester != author, not human-only)
- [ ] Authorship failure adds to evidence_verification.warnings

### Outcome KPIs

- **Who**: High-risk intents
- **Does what**: Include independently-authored evidence references
- **By how much**: 100% of high-risk intents under hard enforcement have 2+ independent refs
- **Measured by**: Query on evidence_verification for high-risk intents
- **Baseline**: N/A

### Technical Notes

- Author resolution: decisions have confirmer, tasks have assignee/completer, observations have source_agent
- The authorship check requires an additional field in the verification query: the author/source identity for each evidence ref
- This may require a slightly more complex batch query or a post-processing step on the verification results

---

## US-06: Minimum Evidence Age and Hard Enforcement

### Problem

Ravi Patel has discovered that even with authorship checks, a compromised agent could coordinate with another agent to create evidence moments before submitting an intent -- a timing exploit. Additionally, the current soft enforcement is advisory-only; Ravi wants the option to make evidence requirements mandatory once the workspace has enough graph state. He finds it unsettling that there is no "hard stop" for intents with clearly insufficient evidence.

### Who

- Workspace administrator | Preventing timing exploits and enforcing evidence requirements | Needs configurable minimum age and hard enforcement mode
- Autonomous agent | Operating under strict evidence requirements | Needs clear rejection messages when evidence is insufficient

### Solution

Add minimum evidence age enforcement (evidence must be at least N minutes old) and hard enforcement mode where insufficient evidence causes rejection before LLM evaluation.

### Domain Examples

#### 1: Timing Attack Blocked -- Evidence created 30 seconds ago

Logistics-Planner creates observation at 10:00:00, then submits intent at 10:00:30 referencing that observation. Workspace min_age is 5 minutes. Pipeline: observation is 30 seconds old, below 5-minute threshold. Warning: "Evidence observation:recent is newer than minimum age threshold."

#### 2: Hard Enforcement Rejects -- Insufficient evidence count

Workspace in "hard" enforcement. Logistics-Planner submits medium-risk intent with 0 evidence refs. Required: 2 refs. Pipeline rejects intent before LLM: "Insufficient evidence: 0 refs provided, minimum 2 required for medium risk tier."

#### 3: Mature Workspace Transitions to Hard -- Automatic enforcement upgrade

Workspace "Acme Supply Chain" in "soft" enforcement with 10 confirmed decisions and 5 completed tasks. Maturity threshold reached. Enforcement auto-transitions to "hard". Next intent without evidence is rejected.

### UAT Scenarios (BDD)

#### Scenario: Evidence below minimum age triggers warning

Given workspace minimum evidence age is 5 minutes
And an intent references observation:recent created 30 seconds ago
When the verification pipeline runs
Then evidence_verification.warnings contains "Evidence observation:recent is newer than minimum age threshold"
And the reference is counted as a failed ref under hard enforcement

#### Scenario: Hard enforcement rejects insufficient evidence before LLM

Given workspace evidence enforcement is "hard"
And an intent requiring 2 evidence refs provides 0
When the intent transitions to "pending_auth"
Then the intent is rejected with status "failed"
And the error_reason explains the evidence shortfall
And the LLM evaluator is NOT called

#### Scenario: Workspace auto-transitions from soft to hard at maturity threshold

Given workspace "Acme Supply Chain" in "soft" enforcement
And evidence_enforcement_threshold is { min_decisions: 10, min_tasks: 5 }
And the workspace has 10 confirmed decisions and 5 completed tasks
When the maturity check runs
Then workspace evidence_enforcement transitions to "hard"

### Acceptance Criteria

- [ ] Minimum evidence age is configurable per workspace (default 5 minutes)
- [ ] Evidence refs below minimum age are flagged in warnings and count as failed under hard enforcement
- [ ] Hard enforcement rejects intents before LLM evaluation when evidence is insufficient
- [ ] Rejection includes specific error_reason explaining the shortfall
- [ ] Workspace schema includes evidence_enforcement_threshold with min_decisions and min_tasks
- [ ] Auto-transition from soft to hard when maturity threshold reached
- [ ] Maturity check runs at intent evaluation time (lazy evaluation)

### Outcome KPIs

- **Who**: Intents under hard enforcement
- **Does what**: Are rejected when evidence is insufficient (zero false passes)
- **By how much**: 100% of intents below tier minimum are rejected pre-LLM
- **Measured by**: Query: intents with status=failed AND error_reason LIKE '%evidence%' under hard enforcement
- **Baseline**: N/A

### Technical Notes

- Minimum age check: `evidence.created_at + min_age_minutes <= intent.created_at`
- Hard enforcement check runs in verification pipeline, before `llmEvaluator` call
- Maturity threshold check: lazy evaluation at intent evaluation time (query confirmed decisions and completed tasks counts)
- Auto-transition: update workspace.evidence_enforcement when threshold met

---

## US-07: Risk-Tiered Evidence Requirements

### Problem

Ravi Patel finds it unreasonable to require the same evidence for an agent reading supplier data (low risk) as for an agent modifying fulfillment routing rules (high risk). A one-size-fits-all evidence policy either over-burdens low-risk actions or under-protects high-risk ones. He needs evidence requirements that scale with the stakes.

### Who

- Workspace administrator | Balancing security with operational efficiency | Needs proportionate evidence requirements
- Autonomous agent | Operating across different risk levels | Needs clear, predictable evidence expectations per risk tier

### Solution

Define evidence requirements that scale with the intent's risk tier: low-risk needs 1 reference of any type, medium-risk needs 2 including a decision or task with 1 independent author, high-risk needs 3+ including a decision AND task/observation with 2 independent authors.

### Domain Examples

#### 1: Low-Risk Intent -- Minimal evidence sufficient

Logistics-Planner submits intent to read current fulfillment metrics (risk score 10). Provides 1 evidence ref: task:metrics-task (in_progress). Low-risk tier requires 1 ref of any type. Requirement met.

#### 2: Medium-Risk Intent -- Decision or task required

Logistics-Planner submits intent to adjust warehouse allocation percentages (risk score 50). Provides 2 refs: confirmed decision "Optimize regional allocation" and observation "Current allocation inefficient." Medium-risk tier requires decision OR task. Decision present. 1 independent author (decision confirmed by Ravi). Requirement met.

#### 3: High-Risk Intent -- Multiple types and independence required

Logistics-Planner submits intent to reroute all Southeast Asia orders (risk score 85). Provides 3 refs: confirmed decision, completed task, verified observation. High-risk tier requires decision AND (task OR observation), plus 2 independent authors. Decision by Ravi, observation by Observer -- 2 independent. Requirement met.

### UAT Scenarios (BDD)

#### Scenario: Low-risk intent meets tier requirement with 1 ref

Given an intent with risk score 15
And the intent has 1 verified evidence ref of type "task"
When the risk router evaluates evidence sufficiency
Then the low-risk tier requirement (1 ref, any type) is met

#### Scenario: Medium-risk intent requires decision or task

Given an intent with risk score 50
And the intent has 2 refs: 1 confirmed decision, 1 observation
And 1 ref is authored by a different identity
When the risk router evaluates evidence sufficiency
Then the medium-risk tier requirement is met

#### Scenario: High-risk intent fails when missing required types

Given an intent with risk score 85
And the intent has 3 refs but all are observations (no decision, no task)
When the risk router evaluates evidence sufficiency
Then the high-risk tier type requirement fails
And evidence_verification.warnings contains "High risk requires decision AND (task OR observation)"

### Acceptance Criteria

- [ ] Risk tiers defined: low (0-30), medium (31-70), high (71-100)
- [ ] Low tier: 1 ref, any type, no authorship requirement
- [ ] Medium tier: 2 refs, must include decision OR task, 1 independent author
- [ ] High tier: 3+ refs, must include decision AND (task OR observation), 2 independent authors
- [ ] Tier requirements are configurable defaults, overridable by policy rules
- [ ] Tier evaluation uses the LLM risk score (not the effective/penalized score)

### Outcome KPIs

- **Who**: Intents across all risk tiers
- **Does what**: Meet proportionate evidence requirements without over- or under-specification
- **By how much**: Tier compliance rate >95% (legitimate intents meet their tier requirements)
- **Measured by**: Query: verified intents grouped by risk tier with evidence compliance flag
- **Baseline**: N/A

### Technical Notes

- Tier thresholds match existing risk router thresholds (auto_approve <= 30, veto_window > 30)
- Type requirements need the verification query to return entity types alongside other fields
- Requirements stored as constants initially, overridable by policy rules in US-10

---

## US-08: Governance Feed Evidence Chain Display

### Problem

Ravi Patel reviews pending intents in the governance feed during veto windows but currently sees only the agent's free-text goal and reasoning. He finds it difficult to make informed veto decisions because he cannot see what system state the agent is citing as justification. Evidence verification happens behind the scenes but is invisible to the human reviewer.

### Who

- Workspace administrator | Making veto decisions on agent intents | Needs to see evidence chain with verification status in the feed

### Solution

Display the evidence chain (referenced entities, their types, titles, and verification status) on intent cards in the governance feed. Allow navigation from feed to referenced entities.

### Domain Examples

#### 1: All Evidence Verified -- Ravi reviews supply chain routing intent

Ravi sees intent card: "Reroute Southeast Asia orders." Evidence section shows 3 refs, all verified: decision "Switch to regional warehousing" (confirmed), task "Audit fulfillment SLAs" (completed), observation "Lead times +40% Q2" (verified). Ravi clicks on the decision to review its reasoning before approving.

#### 2: Partial Evidence Failure -- Ravi sees warning on intent card

Ravi sees intent card with 3 refs: 2 verified, 1 failed (superseded decision). Failed ref is highlighted with reason. Ravi investigates the superseded decision and decides to veto the intent.

#### 3: No Evidence -- Ravi sees zero-evidence warning

Ravi sees intent card with 0 evidence refs under soft enforcement. Feed displays: "No evidence provided. Risk score elevated by +20." Ravi pays extra attention to the reasoning.

### UAT Scenarios (BDD)

#### Scenario: Feed displays verified evidence chain

Given an intent in "pending_veto" status with 3 verified evidence refs
When Ravi Patel views the intent in the governance feed
Then each evidence reference shows entity type, title, and verification status
And the evidence summary shows "3/3 verified"

#### Scenario: Feed highlights failed evidence references

Given an intent with 2 verified and 1 failed evidence ref
When Ravi Patel views the intent in the governance feed
Then verified references show a success indicator
And the failed reference shows a failure indicator with reason
And the evidence summary shows "2/3 verified"

#### Scenario: Feed allows navigation to referenced entities

Given an intent with evidence_ref decision:abc123
When Ravi Patel clicks on the decision reference in the feed
Then the application navigates to the decision detail view

#### Scenario: Feed shows zero-evidence warning

Given an intent with no evidence_refs under soft enforcement
When Ravi Patel views the intent in the governance feed
Then the feed shows "No evidence provided"
And the risk score elevation is visible

### Acceptance Criteria

- [ ] Intent feed cards display evidence_refs with entity type, title, and verification status
- [ ] Verified refs show success indicator; failed refs show failure indicator with reason
- [ ] Evidence summary shows "N/M verified" count
- [ ] Each evidence reference is navigable to the entity detail view
- [ ] Zero-evidence intents display a warning message
- [ ] Evidence section loads without blocking the feed card rendering

### Outcome KPIs

- **Who**: Workspace administrators
- **Does what**: Review evidence chains in the governance feed before making veto decisions
- **By how much**: 80%+ of veto-window intents are reviewed with evidence context visible
- **Measured by**: Query: pending_veto intents with evidence_verification present + feed view events
- **Baseline**: 0% (no evidence display in feed)

### Technical Notes

- Feed evidence display requires joining intent.evidence_refs with entity titles (lightweight query or denormalized on verification result)
- Navigation: use existing entity detail routes
- Consider loading evidence details lazily (expand on click) to keep feed responsive

---

## US-09: Workspace Bootstrapping and Enforcement Transitions

### Problem

Ravi Patel creates a new workspace "LATAM Expansion" for a supply chain initiative. The workspace has zero confirmed decisions and zero completed tasks. Ravi finds it frustrating that evidence requirements would immediately block all agent actions in a brand-new workspace where there are no graph records to reference yet. He needs a grace period that allows initial work while building toward full evidence enforcement.

### Who

- Workspace administrator | Setting up a new workspace | Needs a bootstrap period where evidence requirements are relaxed
- Autonomous agents | Operating in a new workspace | Need to work before evidence pool exists

### Solution

Three-phase graduated enforcement: bootstrap (no evidence required, logged for audit), soft (evidence shortfalls penalize risk score), hard (insufficient evidence rejects). Automatic transitions based on workspace maturity thresholds.

### Domain Examples

#### 1: New Workspace in Bootstrap Mode -- First intents proceed freely

Ravi creates workspace "LATAM Expansion." First agent submits intent to create initial project structure. No evidence refs needed. Intent proceeds with bootstrap_exemption flag logged.

#### 2: First Decision Triggers Soft Enforcement -- Grace period ends

Ravi confirms the first decision in "LATAM Expansion": "Focus on Brazil and Mexico markets." Workspace transitions from bootstrap to soft enforcement. Next intent without evidence gets risk score penalty but is not rejected.

#### 3: Maturity Threshold Triggers Hard Enforcement -- Workspace is established

After 10 confirmed decisions and 5 completed tasks, "LATAM Expansion" auto-transitions to hard enforcement. Agents now must provide sufficient evidence or face rejection.

### UAT Scenarios (BDD)

#### Scenario: New workspace starts in bootstrap enforcement mode

Given Ravi Patel creates a new workspace "LATAM Expansion"
When the workspace is initialized
Then workspace.evidence_enforcement is "bootstrap"
And workspace.evidence_enforcement_threshold has default values

#### Scenario: First confirmed decision transitions workspace to soft enforcement

Given workspace "LATAM Expansion" in "bootstrap" enforcement
And a decision is confirmed in the workspace
When the enforcement transition check runs
Then workspace.evidence_enforcement transitions to "soft"

#### Scenario: Maturity threshold transitions workspace to hard enforcement

Given workspace "LATAM Expansion" in "soft" enforcement
And the workspace has 10 confirmed decisions and 5 completed tasks
When the enforcement transition check runs
Then workspace.evidence_enforcement transitions to "hard"

#### Scenario: Bootstrap intents are logged with exemption flag

Given workspace "LATAM Expansion" in "bootstrap" enforcement
When an agent submits an intent without evidence_refs
Then the intent proceeds to LLM evaluation
And the intent evaluation records a bootstrap_exemption note in warnings

#### Scenario: Admin can manually set enforcement mode

Given workspace "Acme Supply Chain" in "soft" enforcement
When Ravi Patel sets evidence_enforcement to "hard" via workspace settings
Then the workspace enforcement mode is updated to "hard"
And subsequent intents are subject to hard enforcement

### Acceptance Criteria

- [ ] New workspaces default to "bootstrap" evidence enforcement
- [ ] Bootstrap-to-soft transition triggers when first decision is confirmed
- [ ] Soft-to-hard transition triggers when maturity threshold is met (default: 10 decisions, 5 tasks)
- [ ] Bootstrap intents are logged with exemption flag for audit
- [ ] Workspace administrator can manually override enforcement mode
- [ ] Maturity threshold is configurable per workspace
- [ ] Transition checks are lazy (evaluated at intent evaluation time)

### Outcome KPIs

- **Who**: New workspaces
- **Does what**: Successfully bootstrap and transition through enforcement phases without blocking legitimate agent work
- **By how much**: 100% of new workspaces reach "soft" enforcement within 48 hours of active use
- **Measured by**: Query: workspace enforcement mode transitions over time
- **Baseline**: N/A (enforcement does not exist)

### Technical Notes

- Bootstrap-to-soft: triggered by SurrealDB event on decision confirmation, or lazy check at intent evaluation
- Soft-to-hard: lazy check at intent evaluation time (count confirmed decisions and completed tasks)
- Manual override: workspace settings API endpoint
- Default maturity threshold: configurable via workspace.evidence_enforcement_threshold

---

## US-10: Policy Evidence Rules and Observer Anomaly Detection

### Problem

Ravi Patel manages workspaces with different risk profiles. The default risk-tiered evidence requirements work for most cases, but certain action types (e.g., deploying infrastructure changes, approving customer refunds above a threshold) need custom evidence rules. Additionally, Ravi has no way to detect if an agent is systematically creating low-quality observations to build an evidence pool for future intents.

### Who

- Workspace administrator | Defining custom evidence rules for specific action types | Needs policy-based evidence configuration
- Observer agent | Detecting evidence manipulation patterns | Needs anomaly detection for evidence fabrication

### Solution

Extend the policy rule system with an "evidence_requirement" rule type that lets workspace admins define per-action evidence requirements. Add Observer scan patterns for evidence anomalies (high-volume entity creation, self-referencing patterns).

### Domain Examples

#### 1: Custom Policy for Customer Refunds -- Stricter evidence required

Ravi creates policy: "Customer refunds above $5,000 require 3 evidence refs including a confirmed decision and a completed audit task, with 2 independent authors and minimum 30-minute evidence age." The Logistics-Planner agent submitting a refund intent must meet these stricter requirements.

#### 2: Observer Detects Evidence Spam -- Anomalous observation creation

Observer scan detects that the Logistics-Planner agent created 15 observations in 10 minutes (normally creates 2-3 per hour). Observer generates observation of type "evidence_anomaly" referencing the pattern. Ravi sees the anomaly in the governance feed.

#### 3: Policy Overrides Default Tier -- Deployment needs extra evidence

Ravi creates policy: "All intents with action 'deploy' require minimum 4 evidence refs regardless of risk score." An agent submitting a low-risk deploy intent (risk 15, normally 1 ref required) must now provide 4 refs.

### UAT Scenarios (BDD)

#### Scenario: Policy defines custom evidence requirement for action type

Given Ravi creates an active policy with rule:
  | type                 | min_count | required_types       | min_age_minutes | require_independent |
  | evidence_requirement | 3         | ["decision", "task"] | 30              | true                |
And the policy selector matches action "approve_refund" above $5,000
When the Logistics-Planner agent submits a refund intent for $8,000
Then the evidence requirement uses the policy-defined rules instead of default tier

#### Scenario: Policy evidence rule overrides default tier (more restrictive)

Given a low-risk intent (risk score 15) with default requirement of 1 ref
And a matching active policy requiring 4 refs
When the verification pipeline evaluates evidence sufficiency
Then the policy requirement (4 refs) applies instead of the default tier (1 ref)

#### Scenario: Observer detects evidence creation anomaly

Given the Logistics-Planner agent creates 15 observations in 10 minutes
And the normal rate is 2-3 observations per hour
When the Observer runs its periodic scan
Then the Observer creates an observation of type "evidence_anomaly"
And the anomaly observation references the suspicious creation pattern
And the anomaly is visible in the governance feed

### Acceptance Criteria

- [ ] Policy rule type "evidence_requirement" is supported with fields: min_count, required_types, min_age_minutes, require_independent_author
- [ ] Policy selector can match on action_spec.provider, action_spec.action, and budget_limit
- [ ] Policy evidence rules override default tier requirements (more restrictive wins)
- [ ] Observer has scan pattern for anomalous entity creation rates per agent
- [ ] Observer generates "evidence_anomaly" observation type when pattern detected
- [ ] observation_type ASSERT includes "evidence_anomaly" value

### Outcome KPIs

- **Who**: Workspace administrators
- **Does what**: Create custom evidence policies for action types and receive anomaly alerts
- **By how much**: At least 1 custom evidence policy per workspace with high-risk action types
- **Measured by**: Query: active policies with evidence_requirement rules
- **Baseline**: 0 (policy rule type does not exist)

### Technical Notes

- Extend PolicyRule type with "evidence_requirement" variant
- Policy gate already runs before LLM evaluation -- evidence rules integrate naturally
- Observer anomaly detection: new scan pattern measuring entity creation rate per agent per time window
- Add "evidence_anomaly" to observation_type ASSERT list in schema migration
