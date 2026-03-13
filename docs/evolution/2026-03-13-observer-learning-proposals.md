# Evolution: Observer Learning Proposals

**Date:** 2026-03-13
**Feature:** observer-learning-proposals
**Status:** Delivered

## Summary

Observer Learning Proposals adds a diagnostic reasoning layer to the Observer agent, enabling it to escalate recurring observation patterns into actionable learning proposals. Previously, the Observer could only express findings as observations (signals). Now it performs Root Cause Trace analysis -- classifying *why* a gap between intent and reality exists -- and proposes categorized behavioral rules (learnings) with full evidence trails.

**Why:** Observation clusters were accumulating without actionable follow-up. Workspace owners had to manually diagnose patterns and create learnings. This feature closes the loop: the Observer detects the pattern, diagnoses the root cause, and proposes a specific fix for human approval.

## Architecture

### ADR-031: Root Cause Trace

When the Observer detects a pattern (3+ similar observations), it runs an LLM-based Root Cause Trace that classifies the failure into one of three categories:

| Category | Question Answered | Learning Type |
|----------|-------------------|---------------|
| **Policy Failure** | Did the rules allow something they shouldn't? | `constraint` |
| **Context Failure** | Did the agent lack information it needed? | `instruction` |
| **Behavioral Drift** | Did the agent ignore a rule it already had? | `constraint` |

**Key design choices:**
- LLM determines both root cause category AND learning type directly (no hardcoded mapping)
- Dual gate prevents low-quality proposals: `should_propose_learning === false` OR `confidence < 0.70` produces an observation instead of a learning
- Reuses existing `suggestLearning()` gates (rate limiting, dismissed similarity) -- no duplicated infrastructure
- No schema changes required; existing `learning` table supports all categories

### Alternatives Rejected

1. **Frequency-only** -- Suggest learning whenever 3+ observations cluster. Rejected: produces generic learnings without diagnosing why.
2. **Human-triggered only** -- Observer creates "pattern detected" observation, human creates learning manually. Rejected: adds friction, doesn't leverage graph traversal.
3. **Rule-based classification** -- Hardcoded heuristics. Rejected: too brittle for patterns spanning multiple categories.

### Two Trigger Paths

- **Graph scan path** -- Runs as step 6 after pattern synthesis during periodic workspace analysis. Clusters all open observations workspace-wide.
- **Event-driven path** -- After `persistObservation`, checks if entity has 3+ open observer observations. Triggers diagnosis on entity-scoped cluster for faster response.
- **Dedup between paths** -- Queries pending_approval learnings from observer in last 24h; skips if similarity > 0.80 to proposed text.

### Coverage Check

Before proposing, the pipeline checks if an active learning already covers the pattern via KNN (similarity > 0.80). When covered, logs `observer.learning.coverage_skip` -- no observation created for dedup signals.

## Implementation Stats

| Metric | Value |
|--------|-------|
| Total steps | 4 |
| Phases | 2 |
| All steps | PASS |
| Execution window | ~56 minutes (13:49 - 14:45 UTC) |
| Acceptance tests | 23 (21 pass, 2 skip for future work) |
| Production files modified | 4 |

### Phases

1. **Diagnostic Pipeline** (3 steps) -- Observation clustering and coverage check, root cause classifier with LLM structured output, learning proposer and graph scan integration
2. **Event-Driven Integration** (1 step) -- Event-driven escalation in observer agent after observation persistence

### Step Outcomes

| Step | Name | Duration | Outcome |
|------|------|----------|---------|
| 01-01 | Observation clustering and coverage check | ~7 min | PASS |
| 01-02 | Root cause classifier with LLM structured output | ~10 min | PASS |
| 01-03 | Learning proposer and graph scan integration | ~20 min | PASS |
| 02-01 | Event-driven escalation in observer agent | ~8 min | PASS |

## Files Created/Modified

| File | Nature | Change |
|------|--------|--------|
| `app/src/server/observer/learning-diagnosis.ts` | NEW | Observation clustering, root cause classification, learning proposer |
| `app/src/server/observer/schemas.ts` | Extended | Added `rootCauseSchema` Zod schema for LLM structured output |
| `app/src/server/observer/graph-scan.ts` | Extended | Added step 6: diagnostic learning proposals after pattern synthesis |
| `app/src/server/agents/observer/agent.ts` | Extended | After persistObservation, check entity observation count for escalation |

### Test Files

- `tests/acceptance/observer-learning-proposals/milestone-1-clustering-and-coverage.test.ts`
- `tests/acceptance/observer-learning-proposals/milestone-2-root-cause-classification.test.ts`
- `tests/acceptance/observer-learning-proposals/milestone-3-proposer-and-scan.test.ts`
- `tests/acceptance/observer-learning-proposals/milestone-4-event-escalation.test.ts`
- `tests/acceptance/observer-learning-proposals/walking-skeleton.test.ts`
- `tests/acceptance/observer-learning-proposals/observer-learning-proposals-test-kit.ts`

## Review Findings

Peer review completed in 2 iterations. 3 high-severity blockers and 4 medium issues identified and resolved.

### Blockers Fixed

| ID | Issue | Resolution |
|----|-------|------------|
| H2 | Learning type mapping oversimplified -- hardcoded category-to-type loses nuance | Extended rootCauseSchema: LLM now outputs `proposed_learning_type` directly alongside category |
| H3 | Root cause prompt uses confidence-only gate; LLM may output low-confidence proposals | Added `should_propose_learning` boolean to schema. Dual gate: LLM decides + code checks confidence |
| M3 | Event-driven and graph scan paths may produce duplicate proposals for same pattern | Added dedup query: check pending_approval learnings from observer in last 24h with similarity > 0.80 |

### Medium Issues Addressed

| ID | Issue | Resolution |
|----|-------|------------|
| H1 | ADR-031 doesn't acknowledge graceful absence tradeoff | Revised ADR consequences to explicitly acknowledge LLM-dependence |
| M1 | No fallback classification when observer model unavailable | Acknowledged as intentional tradeoff; deferred to future iteration |
| M2 | Coverage checker creates noise observations when pattern is already covered | Changed to log-only (`observer.learning.coverage_skip`) |
| M4 | suggestLearning agentType consistency | Explicit AC: `suggestedBy = 'observer'` matching existing agent naming |

## Quality Gates

| Gate | Result |
|------|--------|
| Acceptance tests | 21/23 PASS (2 skipped -- future work) |
| All steps GREEN | PASS |
| Peer review | Approved (iteration 2) |

## Lessons Learned

1. **Cross-form embedding similarity requires lower thresholds** -- Comparing observation text embeddings against learning text embeddings (different forms: descriptive signal vs prescriptive rule) produces lower cosine similarity scores than same-form comparisons. Coverage check threshold of 0.80 works for learning-to-learning dedup, but observation-to-learning coverage needed 0.50 to avoid false negatives. Future cross-form similarity checks should start with lower thresholds and calibrate upward.

2. **Dual-gate pattern for LLM proposals** -- Letting the LLM output both a boolean (`should_propose_learning`) and a numeric confidence, then gating on both, prevents two failure modes: (a) high-confidence but vague proposals (LLM declines via boolean), and (b) LLM says "yes" but with low conviction (code catches via threshold). This pattern is reusable for any agent-proposed structured output.

3. **Event-driven dedup is essential for dual-path systems** -- When the same pattern can trigger proposals from both periodic scan and event-driven paths, dedup must be explicit. Time-windowed similarity queries against pending proposals prevent duplicate learnings without complex coordination between paths.
