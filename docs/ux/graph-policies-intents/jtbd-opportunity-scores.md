# Opportunity Scoring: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11

## Scoring Method

- Importance: team estimate (% rating 4+ on 5-point scale)
- Satisfaction: team estimate (% rating 4+ with current solution on 5-point scale)
- Score: Importance + max(0, Importance - Satisfaction)
- Data quality: team estimates, not user survey data. Treat as directional ranking.

## Outcome Statements

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the time to determine which policies govern a given identity | 85 | 10 | 16.0 | Extremely Underserved |
| 2 | Minimize the likelihood of missing an intent stuck in a non-terminal state | 80 | 15 | 14.5 | Extremely Underserved |
| 3 | Minimize the time to discover recently vetoed intents | 75 | 10 | 14.0 | Underserved |
| 4 | Minimize the likelihood of policy coverage gaps going unnoticed | 80 | 20 | 13.6 | Underserved |
| 5 | Minimize the time to trace intent -> triggering task -> agent session | 70 | 15 | 12.5 | Underserved |
| 6 | Minimize the likelihood of missing a vetoed intent within 24 hours | 70 | 20 | 12.0 | Underserved |
| 7 | Minimize the time to understand the policy supersession chain | 60 | 15 | 10.5 | Appropriately Served |
| 8 | Maximize the likelihood that intent status is visually distinguishable in the graph | 65 | 25 | 10.5 | Appropriately Served |

## Top Opportunities (Score >= 12)

1. Policy-identity governance visibility (16.0) -- J1: Add policy nodes to graph with `governing` edges to identity nodes
2. Intent lifecycle monitoring (14.5) -- J2: Add intent nodes to graph with status-based coloring and `triggered_by`/`gates` edges
3. Vetoed intent feed surfacing (14.0) -- J3: Show recently-vetoed intents in awareness tier
4. Policy coverage gap detection (13.6) -- J1: Policy -> workspace `protects` edges reveal coverage
5. Intent authorization flow tracing (12.5) -- J2: Visual path from task through intent to agent session
6. Vetoed intent 24h window (12.0) -- J3: Time-bounded awareness feed items

## Overserved Areas (Score < 10)

None identified -- all outcomes are currently underserved or appropriately served.

## Data Quality Notes

- Source: team estimates based on codebase analysis and user context provided
- Sample size: internal team assessment
- Confidence: Medium (team estimates, not user interviews)
- Recommendation: re-score after initial release with actual user feedback
