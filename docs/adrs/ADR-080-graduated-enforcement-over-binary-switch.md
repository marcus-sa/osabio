# ADR-080: Graduated Enforcement Over Binary Switch

## Status
Proposed

## Context

Evidence-backed intent authorization introduces a new requirement for agents: provide verifiable graph references alongside their authorization requests. Enforcing this requirement immediately on existing workspaces would break all current agent workflows (0% of existing intents have evidence_refs today). New workspaces have zero graph state and cannot provide evidence at all.

The system needs a mechanism to introduce evidence requirements without disrupting existing operations, while providing a clear path to full enforcement.

Quality attribute priorities: security (evidence must eventually be mandatory for high-risk actions), reliability (< 2% false rejection rate during transition), operational simplicity (no manual intervention required for normal progression).

## Decision

Implement a three-stage graduated enforcement model stored as a workspace-level setting:

1. **bootstrap**: Evidence is accepted but never required. Evidence shortfall has no effect on risk score. Used for new workspaces with insufficient graph state.
2. **soft**: Evidence shortfall adds +20 risk score per missing ref below tier requirement. Intents are never rejected for evidence alone -- they route to veto window for human review. Used during adoption period.
3. **hard**: Intents with insufficient evidence for their risk tier are rejected before the LLM evaluator runs. The cheapest possible rejection path.

Transitions are evaluated lazily at intent evaluation time:
- bootstrap -> soft: When workspace has >= `min_decisions` confirmed decisions AND >= `min_tasks` completed tasks (defaults: 10 decisions, 5 tasks)
- soft -> hard: Requires explicit admin action (no auto-transition to hard enforcement)

The enforcement mode is stored on the `workspace` table as `evidence_enforcement` with default `"soft"` for existing workspaces.

## Alternatives Considered

### Binary on/off switch
- **Rejected**: No graduation path. Turning on evidence requirements would immediately reject all intents from agents that haven't been updated to provide evidence. False rejection rate would spike to nearly 100%.

### Global feature flag
- **Rejected**: All workspaces would be forced to the same enforcement level. A new workspace with zero graph state would be held to the same standard as a mature workspace with hundreds of decisions and tasks.

### Time-based graduation (e.g. soft for 30 days, then hard)
- **Rejected**: Time is a poor proxy for readiness. A workspace with high agent activity might be ready in 3 days; an inactive workspace might not be ready in 90 days. Maturity thresholds (decision/task counts) are a better signal.

## Consequences

### Positive
- Zero disruption to existing workspaces (default: soft enforcement)
- New workspaces can operate normally during bootstrap (no evidence required until graph state exists)
- Smooth adoption curve: agents get risk score feedback (veto windows) before hard rejections
- Admin retains control over hard enforcement activation
- Lazy evaluation avoids background job complexity

### Negative
- Three enforcement modes add conditional logic to the verification pipeline
- Lazy maturity checks add a small overhead to each intent evaluation (~1 additional query for workspace state)
- No automatic transition to hard enforcement means some workspaces may remain in soft mode indefinitely (acceptable: admin decision)
