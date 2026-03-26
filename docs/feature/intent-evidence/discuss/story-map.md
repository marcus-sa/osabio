# Story Map: Evidence-Backed Intent Authorization

## User: Ravi Patel (workspace admin) + Autonomous Agents (intent requesters)
## Goal: Ensure agent authorization requests are grounded in verifiable system state

## Backbone

| Submit Evidence | Verify Evidence | Route with Evidence | Configure Evidence | Monitor Evidence |
|-----------------|-----------------|--------------------|--------------------|------------------|
| Add evidence_refs to intent schema | Deterministic verification pipeline (existence, scope, temporal, liveness) | Evidence shortfall adjusts risk score | Workspace enforcement mode (bootstrap/soft/hard) | Observer detects evidence anomalies |
| Accept evidence_refs on intent creation API | Authorship independence check | Hard enforcement rejects before LLM | Maturity threshold auto-transition | Evidence fabrication pattern detection |
| Agent tooling provides evidence_refs | Minimum evidence age check | Evidence quality in LLM evaluator context | Policy rules for per-action evidence requirements | Anomaly observation type for evidence_anomaly |
| | Batch verification query (single round-trip) | | Manual enforcement override | |
| | Verification result stored on intent | | | |

---

### Walking Skeleton

The thinnest end-to-end slice that connects all activities:

1. **Submit**: `evidence_refs` field on intent schema + accepted on creation API
2. **Verify**: Basic verification pipeline (existence + workspace scope only)
3. **Route**: Soft enforcement -- evidence shortfall adds to risk score
4. **Configure**: Single workspace-level enforcement mode field (default: "soft")
5. **Monitor**: (deferred -- not in skeleton, existing Observer covers base case)

This skeleton delivers: an agent can submit evidence, the system checks it exists in the right workspace, and missing evidence raises the risk score. No authorship checks, no minimum age, no hard enforcement, no anomaly detection yet.

### Release 1: Core Evidence Verification (Outcome: agents cannot cite fabricated records)

| Submit Evidence | Verify Evidence | Route with Evidence | Configure Evidence |
|-----------------|-----------------|--------------------|--------------------|
| evidence_refs field + creation API | Existence + workspace scope + temporal ordering + status liveness | Soft enforcement: shortfall adds to risk score | Workspace enforcement mode field |
| | Verification result stored on intent record | Evidence verification in LLM evaluator context | |
| | Batch verification query | | |

**Target outcome**: 100% of intents with non-existent or cross-workspace evidence refs are caught before LLM evaluation.

### Release 2: Fabrication Resistance (Outcome: self-referencing and timing attacks are blocked)

| Submit Evidence | Verify Evidence | Route with Evidence | Configure Evidence |
|-----------------|-----------------|--------------------|--------------------|
| | Authorship independence check | Hard enforcement: reject before LLM when insufficient | Risk-tiered evidence requirements |
| | Minimum evidence age check | | Maturity threshold auto-transition |

**Target outcome**: High-risk intents require independent evidence; timing exploits blocked by minimum age.

### Release 3: Policy-Driven Evidence + Monitoring (Outcome: workspace admins control evidence rules per action type)

| | | | Configure Evidence | Monitor Evidence |
|-|-|-|--------------------|------------------|
| | | | Policy rule type for evidence requirements | Observer evidence anomaly detection |
| | | | Per-action evidence configuration | Evidence spam pattern detection |
| | | | Manual enforcement override | evidence_anomaly observation type |

**Target outcome**: Admins define custom evidence rules via policies; Observer catches systematic fabrication patterns.

### Release 4: Feed UX + Bootstrapping (Outcome: humans review evidence chains with confidence)

| Submit Evidence | | Route with Evidence | Configure Evidence |
|-----------------|--|--------------------|--------------------|
| | | Feed shows evidence chain with verification status | Bootstrap enforcement mode |
| | | Navigate to referenced entities from feed | Auto-transition from bootstrap to soft |

**Target outcome**: Ravi can see and evaluate evidence chains directly in the governance feed; new workspaces onboard gracefully.

## Scope Assessment: PASS -- 10 stories, 3 contexts (intent, policy, observer), estimated 10-12 days

The feature is at the upper bound of right-sized. The 4-release slicing keeps each release to 2-3 stories (2-4 days each). If any release exceeds estimates, it can ship independently without blocking others.
