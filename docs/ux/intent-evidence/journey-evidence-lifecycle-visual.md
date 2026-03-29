# Journey: Evidence-Backed Intent Authorization

## Persona

**Ravi Patel** -- Workspace administrator for a supply chain management organization. Manages 4 autonomous agents (Architect, Strategist, Management, Coding) coordinating across procurement, logistics, and compliance projects. Has been using Osabio for 3 months with 30+ confirmed decisions and 50+ completed tasks in the workspace.

**Secondary: Agent "Logistics-Planner"** -- An autonomous coding agent responsible for supply chain optimization. Creates intents when it needs to take high-stakes actions like modifying supplier routing rules or escalating compliance alerts.

## Goal

Ensure that when an agent requests authorization for a high-stakes action, the request is grounded in verifiable system state -- not fabricated justification. The workspace administrator should feel confident that no agent can trick the authorization system with invented reasoning.

## Emotional Arc

```
Start: CAUTIOUS            Middle: METHODICAL           End: CONFIDENT
"Can I trust agents        "Evidence checks are          "The system catches
 with real authority?"      catching real problems"        fabrication attempts"
```

## Journey Flow

```
EVIDENCE CREATION           INTENT SUBMISSION           EVIDENCE VERIFICATION         AUTHORIZATION
(organic graph work)        (agent requests action)     (deterministic pipeline)      (risk-based routing)
      |                           |                           |                           |
      v                           v                           v                           v
+------------------+    +-------------------+    +------------------------+    +-------------------+
| Agents work      |    | Agent creates     |    | Pipeline verifies      |    | Risk router       |
| normally:        |    | intent with       |    | each evidence ref:     |    | factors evidence   |
| - decisions get  |--->| evidence_refs     |--->| 1. Exists?             |--->| quality into       |
|   confirmed      |    | pointing to real  |    | 2. Same workspace?     |    | routing decision   |
| - tasks complete |    | graph records     |    | 3. Not stale?          |    |                   |
| - observations   |    |                   |    | 4. Valid status?       |    | Low risk + good    |
|   accumulate     |    | goal + reasoning  |    | 5. Independent author? |    | evidence = approve |
|                  |    | + evidence_refs   |    | 6. Min count met?      |    |                   |
+------------------+    +-------------------+    +------------------------+    +-------------------+
                                                          |                           |
                                                          v                           v
                                                 +------------------+    +-------------------+
                                                 | Verification     |    | Feed shows intent |
                                                 | result stored    |    | with evidence     |
                                                 | on intent record |    | quality summary   |
                                                 +------------------+    +-------------------+
```

## Step-by-Step Detail

### Step 1: Evidence Accumulates Organically

As agents and humans work in the workspace, graph entities accumulate naturally: decisions get confirmed, tasks get completed, observations get verified. These become the evidence pool.

```
Emotional state: NEUTRAL (business as usual)

Example: Ravi confirms decision "Switch to regional warehousing for Southeast Asia"
         Logistics-Planner completes task "Audit current fulfillment SLAs"
         Observer creates verified observation "Supplier lead times increased 40% in Q2"
```

### Step 2: Agent Submits Intent with Evidence References

When Logistics-Planner wants to take a high-stakes action, it includes `evidence_refs` pointing to real graph records that justify the request.

```
Emotional state: CAUTIOUS -> METHODICAL
Design lever: Evidence requirements are transparent -- the agent knows what is needed

Example intent:
  goal: "Reroute Southeast Asia orders through regional warehouse"
  reasoning: "Lead time analysis shows 40% increase; regional routing reduces fulfillment SLA breach risk"
  action_spec: { provider: "fulfillment", action: "update_routing_rules", params: { region: "SEA" } }
  evidence_refs: [
    decision:abc123   -- "Switch to regional warehousing" (confirmed by Ravi)
    task:def456        -- "Audit current fulfillment SLAs" (completed)
    observation:ghi789 -- "Lead times increased 40% in Q2" (verified, confidence 0.85)
  ]
```

### Step 3: Deterministic Verification Pipeline

Before the LLM evaluator runs, a fast deterministic pipeline checks every evidence reference.

```
Emotional state: METHODICAL
Design lever: Verification is fast (10-30ms), auditable, and deterministic

Pipeline checks (per ref):
  +--- Exists? ---------> record found in DB
  +--- Same workspace? -> record.workspace = intent.workspace
  +--- Temporal order? -> record.created_at <= intent.created_at
  +--- Valid status? ---> decision=confirmed, task=completed/in_progress, observation=open
  +--- Min age met? ----> record.created_at + min_age <= intent.created_at
  +--- Independent? ----> at least N refs NOT authored by requester (risk-tier dependent)

Result stored on intent:
  evidence_verification: {
    verified_count: 3,
    failed_refs: [],
    verification_time_ms: 18,
    warnings: []
  }
```

### Step 4: Risk Router Factors Evidence Quality

The risk router considers evidence verification alongside the LLM risk score. Missing or weak evidence increases the effective risk score.

```
Emotional state: METHODICAL -> CONFIDENT
Design lever: Evidence quality is visible in the governance feed

Routing logic:
  - All evidence verified + low risk score = auto_approve
  - Partial evidence + medium risk = veto_window (human review)
  - Failed evidence + any risk = reject or elevated veto_window
  - Soft enforcement: missing evidence adds +20 to risk score per shortfall
  - Hard enforcement: insufficient evidence = reject before LLM runs
```

### Step 5: Governance Feed Shows Evidence Chain

Ravi sees the intent in the governance feed with full evidence provenance -- which records were cited, verification status, and any warnings.

```
Emotional state: CONFIDENT
Design lever: Transparency builds trust; evidence chain is always visible

Feed card:
  +---------------------------------------------------------------+
  | INTENT: Reroute Southeast Asia orders                         |
  | Agent: Logistics-Planner | Risk: 42 | Status: pending_veto    |
  |                                                                |
  | Evidence (3/3 verified):                                       |
  |   [check] Decision: Switch to regional warehousing (confirmed) |
  |   [check] Task: Audit fulfillment SLAs (completed)            |
  |   [check] Observation: Lead times +40% Q2 (verified, 0.85)    |
  |                                                                |
  | [Approve]  [Veto]  [View Details]                              |
  +---------------------------------------------------------------+
```

## Error Paths

### E1: Agent Submits Intent with Non-Existent Evidence

```
Agent references observation:fake123 that does not exist.
-> Verification pipeline: failed_refs: ["observation:fake123"]
-> Soft enforcement: +20 risk score per failed ref
-> Hard enforcement: intent rejected before LLM evaluation
-> Feed shows: "1 evidence reference could not be verified"
```

### E2: Agent References Cross-Workspace Evidence

```
Agent references decision:abc from a different workspace.
-> Verification: record.workspace != intent.workspace -> scope violation
-> Intent rejected: "Evidence ref decision:abc belongs to different workspace"
```

### E3: Agent Self-References (Fabrication Attempt)

```
Logistics-Planner creates observation O, then immediately references O in intent I.
-> Authorship check: O.source_agent = I.requester (same identity)
-> Minimum age check: O.created_at is 2 seconds before I.created_at (below 5-min threshold)
-> High-risk intent requires 2+ independent refs -> shortfall detected
-> Result: risk score elevated, routed to human veto window
```

### E4: Bootstrap Workspace (No Evidence Available)

```
New workspace with 0 confirmed decisions.
-> Workspace evidence_enforcement = "bootstrap"
-> Intent proceeds without evidence requirements
-> Logged with bootstrap_exemption flag for audit trail
-> Once first confirmed decision exists, transitions to "soft" enforcement
```

### E5: Agent Cites Superseded Decision

```
Agent references decision:old123 which has status "superseded".
-> Liveness check: status not in valid set [confirmed, active, completed, open]
-> failed_refs includes decision:old123
-> Warning: "Referenced decision has been superseded"
```

## Integration Points

| From | To | Data Flow |
|------|----|-----------|
| Graph entities (decisions, tasks, etc.) | Evidence pool | Organic accumulation through normal work |
| Intent creation (agent) | Evidence verification | evidence_refs array on intent record |
| Evidence verification pipeline | Intent evaluator | evidence_verification result on intent |
| Evidence verification pipeline | Risk router | Evidence shortfall adds to risk score |
| Policy system | Evidence requirements | Policy rules define per-action evidence needs |
| Observer | Evidence anomaly detection | Monitors for fabrication patterns |
| Governance feed | Human review | Shows evidence chain for veto window intents |
| Workspace settings | Enforcement mode | bootstrap / soft / hard enforcement level |

## Shared Artifacts

| Artifact | Source of Truth | Consumers |
|----------|----------------|-----------|
| `evidence_refs` | Intent record (SurrealDB) | Verification pipeline, LLM evaluator, Feed UI |
| `evidence_verification` | Intent record (SurrealDB) | Risk router, Feed UI, Audit trail |
| `evidence_enforcement` | Workspace record (SurrealDB) | Verification pipeline, Intent creation |
| Risk tier thresholds | Policy graph + risk-router defaults | Verification pipeline, Evidence requirements |
| Valid entity statuses | Verification pipeline constants | Status liveness checks |
