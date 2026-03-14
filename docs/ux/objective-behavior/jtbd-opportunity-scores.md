# Opportunity Scoring: Objective & Behavior Nodes

## Scoring Method
- Importance: team estimate (% rating 4+ on 5-point scale, N=4 internal stakeholders)
- Satisfaction: team estimate with current solution (% rating 4+ on 5-point scale)
- Score: Importance + max(0, Importance - Satisfaction)
- Priority: Extremely Underserved (15+), Underserved (12-15), Appropriately Served (10-12), Overserved (<10)
- Data Quality: team estimates, not user interviews. Confidence: Medium.

## Outcome Statements & Scores

### Job 1: Strategic Alignment Governance

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1.1 | Minimize the likelihood of agent compute spent on work unaligned to business objectives | 95 | 10 | 18.0 | Extremely Underserved |
| 1.2 | Minimize the time to determine whether an agent intent serves an active objective | 90 | 5 | 17.5 | Extremely Underserved |
| 1.3 | Minimize the likelihood of blocking legitimate exploratory work during alignment checks | 75 | 50 | 10.0 | Appropriately Served |
| 1.4 | Minimize the time to create and maintain strategic objectives in the graph | 70 | 15 | 12.5 | Underserved |
| 1.5 | Maximize the likelihood that objective progress is visible without manual graph queries | 85 | 10 | 16.0 | Extremely Underserved |
| 1.6 | Minimize the number of steps to link an intent to an objective | 80 | 5 | 15.5 | Extremely Underserved |

### Job 2: Behavioral Quality Governance

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 2.1 | Minimize the likelihood of agent quality degradation going undetected | 95 | 15 | 17.5 | Extremely Underserved |
| 2.2 | Minimize the time to identify which agent exhibits poor craftsmanship | 90 | 10 | 17.0 | Extremely Underserved |
| 2.7 | Minimize the time for underperforming agents to receive corrective guidance | 85 | 45 | 11.5 | Appropriately Served |
| 2.3 | Minimize the likelihood of false positives in behavioral quality alerts | 80 | 40 | 12.0 | Appropriately Served |
| 2.4 | Maximize the likelihood that policy enforcement responds to behavioral trends, not snapshots | 85 | 5 | 16.5 | Extremely Underserved |
| 2.5 | Minimize the time to calibrate behavior thresholds per agent role | 70 | 5 | 13.5 | Underserved |
| 2.6 | Minimize the likelihood of penalizing legitimate trade-offs (hotfix mode) | 75 | 30 | 12.0 | Appropriately Served |

### Job 3: Organizational Coherence Auditing

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 3.1 | Minimize the likelihood of decisions rotting in the graph without implementing tasks | 90 | 10 | 17.0 | Extremely Underserved |
| 3.2 | Minimize the time to discover disconnected graph patterns (orphaned nodes) | 85 | 10 | 16.0 | Extremely Underserved |
| 3.3 | Minimize the likelihood of alert fatigue from false coherence warnings | 80 | 40 | 12.0 | Appropriately Served |
| 3.4 | Maximize the likelihood that coherence auditing runs without manual intervention | 75 | 5 | 14.5 | Underserved |
| 3.5 | Minimize the time to resolve a flagged disconnection (create missing edge/node) | 70 | 20 | 12.0 | Appropriately Served |

### Job 4: Cost-to-Value Governance

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 4.1 | Minimize the time to answer "what percentage of agent compute served objective X" | 85 | 5 | 16.5 | Extremely Underserved |
| 4.2 | Minimize the likelihood of spending in categories with no active objective | 80 | 10 | 15.0 | Extremely Underserved |
| 4.3 | Minimize the time to produce a strategic alignment report for stakeholders | 75 | 5 | 14.5 | Underserved |
| 4.4 | Minimize the likelihood of cost tracking adding latency to intent authorization | 70 | 60 | 8.0 | Overserved |

---

## Top Opportunities (Score >= 15)

| Rank | # | Outcome | Score | Story Mapping |
|------|---|---------|-------|---------------|
| 1 | 1.1 | Minimize unaligned agent compute | 18.0 | US-OB-01: Objective Node CRUD + supports edge |
| 2 | 1.2 | Minimize time to check intent-objective alignment | 17.5 | US-OB-02: Authorizer integration |
| 3 | 2.1 | Minimize undetected quality degradation | 17.5 | US-OB-03: Behavior Node + telemetry writing |
| 4 | 2.2 | Minimize time to identify poor craftsmanship | 17.0 | US-OB-03: Behavior Node per identity |
| 5 | 3.1 | Minimize rotting decisions | 17.0 | US-OB-06: Coherence auditor |
| 6 | 2.4 | Policy responds to behavioral trends | 16.5 | US-OB-04: Policy-behavior integration |
| 7 | 4.1 | Answer "what % served objective X" | 16.5 | Future: Cost-to-value reporting |
| 8 | 1.5 | Objective progress visible | 16.0 | US-OB-05: Objective progress view |
| 9 | 3.2 | Discover disconnected graph patterns | 16.0 | US-OB-06: Coherence auditor |
| 10 | 1.6 | Minimize steps to link intent-objective | 15.5 | US-OB-02: Authorizer integration |
| 11 | 4.2 | Prevent spending without active objective | 15.0 | Future: Cost-to-value reporting |

## Underserved (Score 12-15)

| Rank | # | Outcome | Score | Story Mapping |
|------|---|---------|-------|---------------|
| 12 | 1.4 | Minimize objective maintenance time | 12.5 | US-OB-01: Objective Node CRUD |
| 13 | 2.5 | Calibrate thresholds per agent role | 13.5 | US-OB-04: Policy-behavior integration |
| 14 | 3.4 | Coherence auditing runs automatically | 14.5 | US-OB-06: Coherence auditor |
| 15 | 4.3 | Strategic alignment report for stakeholders | 14.5 | Future: Cost-to-value reporting |

## Appropriately Served (Partially by Existing Infrastructure)

| # | Outcome | Score | Note |
|---|---------|-------|------|
| 2.7 | Corrective guidance for underperforming agents | 11.5 | Learning system (PR #145) provides learning CRUD, JIT prompt injection, collision detection, and Observer learning proposal pipeline. Satisfaction raised from 5% to 45% because the infrastructure exists -- what is missing is behavior telemetry as an input signal to the Observer's root cause analysis. US-OB-07 extends Observer to consume behavior records, not build a new Coach Agent. |

## Overserved (Score < 10)

| # | Outcome | Score | Note |
|---|---------|-------|------|
| 4.4 | Cost tracking latency | 8.0 | Current intent auth pipeline is fast; cost metadata is write-only, no gate. Simplification candidate -- do not over-engineer cost lookup. |

## Data Quality Notes
- Source: team estimates (Marcus + 3 internal stakeholders)
- Sample size: N=4
- Confidence: Medium (directional, not statistically significant)
- Recommendation: re-score after initial rollout with real usage data
- Note: Learning system (PR #145) shipped. Outcomes related to agent corrective guidance (2.7) re-scored with Satisfaction raised to 45% (infrastructure exists; behavior telemetry input is missing). US-OB-07 re-scoped from "Coach Agent" to "Observer behavior extension."
