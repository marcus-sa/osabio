# Outcome KPIs: Evidence-Backed Intent Authorization

## Feature: intent-evidence

### Objective

Within 30 days of Release 2 deployment, autonomous agent intents are grounded in verifiable system state, eliminating fabricated justification as an attack vector while maintaining agent operational velocity.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Autonomous agents | Submit intents with valid evidence references | 90%+ of medium/high-risk intents include evidence_refs | 0% (no evidence field exists today) | Query: `SELECT count() FROM intent WHERE evidence_refs IS NOT NONE AND evaluation.risk_score > 30 GROUP ALL` | Leading |
| 2 | Evidence verification pipeline | Catches non-existent, cross-workspace, or invalid-status evidence refs | 100% catch rate (zero false negatives on deterministic checks) | N/A (pipeline does not exist) | Acceptance tests + `evidence_verification.failed_refs` analysis | Leading |
| 3 | Workspace administrators | Review evidence chains in governance feed before approving high-risk intents | 80%+ of veto-window intents reviewed with evidence context | 0% (no evidence display in feed) | Query: intents where status transitioned from pending_veto AND evidence_verification exists | Leading |
| 4 | Evidence verification pipeline | Completes verification within latency budget | p95 < 100ms, p99 < 500ms | N/A | Span attribute `evidence.verification_time_ms` on intent evaluation traces | Guardrail |
| 5 | Agents under soft/hard enforcement | Achieve authorization without evidence-related false rejections | <2% false rejection rate (legitimate intents rejected for evidence reasons) | N/A | Manual audit of rejected intents with `error_reason` containing "evidence" | Guardrail |

### Metric Hierarchy

- **North Star**: KPI-1 -- Evidence adoption rate on medium/high-risk intents (measures whether agents are actually providing evidence)
- **Leading Indicators**: KPI-2 (verification catch rate), KPI-3 (human review with evidence context)
- **Guardrail Metrics**: KPI-4 (verification latency), KPI-5 (false rejection rate)

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| KPI-1 | SurrealDB intent table | Aggregate query on evidence_refs presence | Weekly | Intent system |
| KPI-2 | Acceptance test suite + production evidence_verification records | Automated tests (deterministic) + production query | Per-release (tests) + weekly (production) | Intent system |
| KPI-3 | SurrealDB intent status transitions + evidence_verification | Join query: pending_veto intents with evidence_verification | Weekly | Feed/governance |
| KPI-4 | OpenTelemetry spans | `evidence.verification_time_ms` attribute on `brain.intent.evaluate` spans | Continuous (dashboard) | Platform |
| KPI-5 | SurrealDB intent table | Query: intents with status=failed AND error_reason LIKE '%evidence%' | Weekly (audit) | Intent system |

### Hypothesis

We believe that adding verifiable evidence requirements to the intent authorization pipeline for autonomous agents will achieve grounded, trustworthy authorization decisions.

We will know this is true when 90%+ of medium/high-risk intents include valid evidence references (KPI-1), the deterministic pipeline catches 100% of fabricated references (KPI-2), and workspace administrators review evidence chains for 80%+ of veto-window intents (KPI-3) -- all without exceeding 100ms p95 verification latency (KPI-4) or causing more than 2% false rejections (KPI-5).
