# Outcome KPIs: Sandbox Agent Integration

## Feature: Sandbox Agent Integration

### Objective
Developers iterate naturally with governed coding agents in isolated sandboxes, with sessions that survive failures and provide full observability.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Developers using coding agents | Send follow-up prompts without session respawn | 0% prompt rejection (down from 100%) | 100% rejection (409 on every follow-up) | HTTP status codes on POST .../prompt | Leading |
| 2 | Developers with long sessions | Continue work after transient failures | > 95% session restoration success | 0% (sessions lost on any disconnect) | Restoration attempts vs successes in trace graph | Leading |
| 3 | Developers monitoring agents | See real-time agent events in governance feed | < 500ms event delivery latency | Partial (Claude SDK events only) | Timestamp diff: SandboxAgent event vs SSE delivery | Leading |
| 4 | Brain orchestrator | Enforce per-agent tool filtering for sandbox agents | 100% MCP tool calls through policy evaluation | MCP governance via stdio CLI (not cloud-capable) | Trace records with policy evaluation results | Leading |
| 5 | Developers iterating on code | Complete coding tasks with fewer session restarts | 60% reduction in session restarts per task | ~3 restarts per complex task (single-shot limitation) | Session count per task in trace graph | Lagging |

### Metric Hierarchy

- **North Star**: Follow-up prompt success rate (KPI #1) -- directly measures the core capability gap
- **Leading Indicators**: Session restoration rate (KPI #2), event delivery latency (KPI #3), policy evaluation coverage (KPI #4)
- **Guardrail Metrics**:
  - Session spawn latency must not exceed 5 seconds (local) / 15 seconds (Docker)
  - MCP tool call latency must not exceed 500ms
  - Event persistence completeness must remain 100% (no silent drops)
  - No regression in Brain-native agent functionality

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| Prompt success rate | HTTP response codes | Trace graph query on prompt endpoint | Per session | Orchestrator |
| Restoration success | Trace graph restoration records | COUNT restoration_attempt WHERE success = true | Weekly | Platform |
| Event latency | Timestamp comparison | Span attribute on event bridge | Per event | Observability |
| Policy coverage | Trace graph tool call records | COUNT tool_calls WHERE has_policy_eval = true | Daily | Governance |
| Session restarts per task | Session-to-task relations | GROUP sessions BY task, COUNT | Weekly | Product |

### Hypothesis

We believe that replacing Claude Agent SDK with SandboxAgent SDK for coding agent execution will enable multi-turn sessions and session restoration for developers using Brain's governed coding agents.

We will know this is true when developers send follow-up prompts with 0% rejection rate (down from 100%) and sessions restore after failures with > 95% success rate (up from 0%).
