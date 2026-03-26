# Prioritization: Evidence-Backed Intent Authorization

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|----------|---------|---------------|-----|-----------|
| 1 | Walking Skeleton | End-to-end flow works: evidence submitted, checked, factored into routing | Evidence refs accepted and verified on intent records | Validates core assumption: graph-grounded verification is feasible at <100ms |
| 2 | Release 1: Core Verification | Agents cannot cite fabricated or invalid records as justification | 100% catch rate for non-existent/cross-workspace refs | Addresses the primary security gap (free-text fabrication) |
| 3 | Release 2: Fabrication Resistance | Self-referencing and timing attacks are blocked | Zero self-authored-only evidence on high-risk intents | Riskiest assumption: can we enforce authorship independence without breaking legitimate workflows? |
| 4 | Release 4: Feed UX + Bootstrapping | Humans review evidence chains with confidence; new workspaces onboard | Evidence chain visible in feed for 100% of veto-window intents | Highest user-facing value for Ravi (the human in the loop) |
| 5 | Release 3: Policy-Driven Evidence + Monitoring | Admins control evidence rules per action type; anomalies detected | Custom evidence policies created by workspace admins | Incremental: extends existing policy system; monitoring is defense-in-depth |

## Rationale for Ordering

1. **Walking Skeleton first**: Validates the integration assumption -- can we add evidence_refs to the intent schema, verify them in a single batched query, and feed results to the risk router without exceeding latency budget? This is the fundamental technical risk.

2. **Core Verification second**: Closes the primary security gap. After this release, no agent can cite non-existent records, records from other workspaces, stale records, or records with invalid statuses. This is the highest-value outcome.

3. **Fabrication Resistance third**: Addresses the riskiest assumption -- can authorship independence checks work without creating false rejections for legitimate agent workflows? This is the most likely place where design meets reality friction.

4. **Feed UX + Bootstrapping fourth (promoted over Policy)**: Ravi seeing evidence chains in the feed is the highest human-facing value. Without this, evidence verification is invisible infrastructure. Bootstrapping ensures new workspaces are not broken by hard enforcement.

5. **Policy-Driven Evidence + Monitoring last**: Extends the existing policy system (incremental complexity) and adds defense-in-depth monitoring. Important but not blocking -- the tiered defaults from Release 2 cover most cases without per-action policies.

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|-------|---------|----------|-------------|--------------|
| US-01: Evidence Schema and Submission | WS | P1 | KPI-1: Evidence acceptance rate | None |
| US-02: Basic Evidence Verification Pipeline | WS/R1 | P1 | KPI-2: Fabrication catch rate | US-01 |
| US-03: Soft Enforcement in Risk Router | WS/R1 | P1 | KPI-2: Fabrication catch rate | US-02 |
| US-04: Verification Result Storage | R1 | P1 | KPI-2: Fabrication catch rate | US-02 |
| US-05: Authorship Independence Check | R2 | P2 | KPI-3: Self-reference block rate | US-02 |
| US-06: Minimum Evidence Age + Hard Enforcement | R2 | P2 | KPI-3: Timing attack block rate | US-02, US-03 |
| US-07: Risk-Tiered Evidence Requirements | R2 | P2 | KPI-3: Tiered compliance rate | US-03 |
| US-08: Feed Evidence Chain Display | R4 | P3 | KPI-4: Human review confidence | US-04 |
| US-09: Workspace Bootstrapping + Enforcement Transitions | R4 | P3 | KPI-5: New workspace success rate | US-03 |
| US-10: Policy Evidence Rules + Observer Anomaly Detection | R3 | P4 | KPI-6: Custom policy adoption | US-07 |

> **Note**: Story IDs (US-01 through US-10) are assigned in Phase 4 (Requirements). This table will be updated after user stories are fully crafted.
