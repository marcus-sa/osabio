# Outcome KPIs: Intent-Gated MCP Tool Access

## Feature: intent-gated-mcp

### Objective
Coding agents in sandboxes can call governed MCP tools through Brain's dynamic endpoint, with every tool call gated by policy evaluation and auditable in the trace graph, within Q2 2026.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Sandbox coding agents | Complete governed tool calls end-to-end (discover, authorize, execute) | 95% success rate for authorized calls | 0% (no governed MCP access exists) | Trace records: completed / (completed + failed + timeout) | Leading |
| 2 | Sandbox coding agents | Self-escalate for gated tools via create_intent without human guidance | 90% of gated tool attempts result in intent creation (not repeated 403s) | 0% (no escalation mechanism exists) | Intent creation count / 403 intent_required response count | Leading |
| 3 | Human operators | Approve or veto pending intents within the veto window | 80% of pending_veto intents resolved by humans before timeout | N/A (no veto flow exists) | Intent state transitions: (human_approved + human_vetoed) / total pending_veto | Leading |
| 4 | Idle sessions waiting on veto | Resume within 60 seconds of intent authorization | 95% of sessions resume within 60s of intent approval | N/A | Time delta: intent.authorized_at to session.resumed_at | Leading |
| 5 | All governed tool calls | Produce complete trace records in the graph | 100% of tools/call requests have corresponding trace records | N/A | Trace count vs tools/call request count (instrumentation) | Guardrail |

### Metric Hierarchy
- **North Star**: KPI-1 -- Governed tool call success rate. This is the core capability: agents can actually use external tools through Brain.
- **Leading Indicators**: KPI-2 (escalation works), KPI-4 (resume latency)
- **Guardrail Metrics**: KPI-5 (trace completeness -- must NOT degrade; every call must be auditable)

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| KPI-1 | Trace graph (tool_call records) | SurrealDB query: status counts per session | Daily aggregate | Platform team |
| KPI-2 | Intent + MCP request logs | Ratio: create_intent calls / 403 intent_required responses per session | Per-session | Platform team |
| KPI-3 | Intent state transitions | SurrealDB query: pending_veto -> authorized/vetoed with actor=human | Weekly | Platform team |
| KPI-4 | Session + intent timestamps | Time delta query: intent.updated_at (authorized) to session status change (idle -> active) | Per-event | Platform team |
| KPI-5 | Trace graph + MCP request instrumentation | Compare trace record count to OTel span count for tools/call | Daily audit | Platform team |

### Hypothesis
We believe that exposing governed MCP tools through a dynamic per-agent endpoint with intent-based escalation for sandbox coding agents will achieve a 95% tool call success rate for authorized operations. We will know this is true when coding agents complete governed tool calls end-to-end (discover, authorize, execute) at a 95% success rate as measured by trace records.
