# Observer Agent — Opportunity Scoring

Scoring: Importance (1-10) x Satisfaction Gap (1-10). Higher = stronger opportunity.

| Job | Importance | Current Satisfaction | Gap | Opportunity Score |
|-----|-----------|---------------------|-----|-------------------|
| **Reality Verification** | 9 | 2 | 7 | **63** |
| **Cross-Agent Peer Review** | 8 | 3 | 5 | **40** |

## Priority Rationale

**Reality Verification scores highest** because:
- Without it, every other graph capability degrades (decisions based on false state, tasks incorrectly closed, intents authorized against stale reality)
- The existing intent EVENT pattern (`DEFINE EVENT ... ASYNC RETRY 3`) proves the architecture; extending it to task/observation triggers is incremental
- External verification (GitHub CI, test results) provides hard boolean signals — low ambiguity in what "verified" means

**Cross-Agent Peer Review scores second** because:
- The observation table and `observes` relation already support this pattern
- Current agents (chat, PM) already write observations — extending to an autonomous Observer agent is a tool/prompt change, not an architectural one
- Value compounds with number of agents — becomes critical as more specialized agents are added

## Implementation Order

1. Reality Verification (event triggers + external signal checks)
2. Cross-Agent Peer Review (Observer agent autonomous scan loop)
