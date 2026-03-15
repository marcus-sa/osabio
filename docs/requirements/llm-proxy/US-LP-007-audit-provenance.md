# US-LP-007: Audit Provenance Chain

## Problem
Elena Vasquez is a compliance auditor who needs to verify that every agent LLM call was authorized by an active policy and traceable to a specific task and workspace. Currently, LLM calls have no structured audit trail -- they exist only as ephemeral log entries. She cannot answer "was this LLM call authorized?" or "what policy governed this agent's model access?" without manual log archaeology.

## Who
- Compliance Auditor | Quarterly audit cycles | Needs graph-traversable provenance from intent to LLM call to code change
- Workspace Admin | Incident investigation | Needs to trace back from a suspicious call to its authorization

## Job Story Trace
- JS-4: Auditable Agent Provenance

## Solution
Ensure every llm_trace in the graph has edges forming a complete provenance chain: intent -> authorized_by -> policy; intent -> executed_in -> agent_session -> invoked -> llm_trace -> attributed_to -> task; llm_trace -> scoped_to -> workspace. Provide a query interface and export capability for auditors.

## Domain Examples

### 1: Happy Path -- Elena traces a specific LLM call
Elena queries trace "llm_trace:tr-2026-0315-001" in the audit view. She sees: model=claude-sonnet-4, tokens (in: 12,340, out: 2,100), cache (create: 0, read: 8,200), cost=$0.068, latency=4,200ms, stop_reason=end_turn. The provenance chain shows: intent:deploy-auth -> authorized_by -> policy:model-access-v2 -> executed_in -> agent_session:priya-auth-42 -> invoked -> llm_trace:tr-2026-0315-001 -> attributed_to -> task:implement-oauth -> scoped_to -> workspace:brain-v1. Elena clicks "Export Provenance Chain as JSON" and receives a structured file.

### 2: Happy Path -- Elena queries all calls for a project in March
Elena runs a query: "all LLM traces for project auth-service between 2026-03-01 and 2026-03-15". Results return in 1.8 seconds: 1,247 traces, total cost $234.56, across 42 sessions. Each row shows model, tokens, cost, session reference, and policy reference. She exports as CSV for her audit report.

### 3: Compliance Check -- All calls verified as policy-authorized
Elena runs the authorization compliance check for March. The system traverses every llm_trace in the workspace, checking for a governing policy edge. Report: 4,891 of 4,891 traces have active policy authorization. Compliance: 100%. She exports the summary.

### 4: Error Path -- Traces without policy authorization flagged
Due to a brief configuration gap on March 3 (policies were being migrated), 17 LLM calls were processed without active policies. Elena's compliance check flags these 17 as "unverified". Each flagged trace links to the time period when no policies were active. Marcus reviews and confirms they were legitimate calls during the migration window. Elena documents the exception.

## UAT Scenarios (BDD)

### Scenario: Auditor views full provenance chain for a trace
Given Elena queries trace "llm_trace:tr-2026-0315-001" in the audit view
When the trace detail loads
Then Elena sees model, token counts, cost, latency, and stop reason
And the provenance chain shows linked entities from intent through to workspace
And Elena can export the provenance chain as JSON

### Scenario: Auditor queries traces by project and date range
Given Elena queries traces for project "auth-service" between 2026-03-01 and 2026-03-15
When the query executes
Then results return within 2 seconds
And each result includes model, tokens, cost, session reference, and policy reference
And Elena can export the results as CSV

### Scenario: Authorization compliance check passes
Given all LLM traces in March have an associated policy authorization
When Elena runs the compliance check
Then the report shows 100% compliance
And each trace is verified to have an active policy edge at the time of the call

### Scenario: Traces without authorization flagged as unverified
Given 17 LLM traces were processed during a policy migration gap
When Elena runs the compliance check
Then those 17 traces are flagged as "unverified"
And each flagged trace shows the time period and reason for missing authorization
And the compliance summary shows "4,874 authorized, 17 unverified"

## Acceptance Criteria
- [ ] Every llm_trace has edges forming provenance chain (session, workspace required; task, policy optional)
- [ ] Trace detail view shows all usage data plus visual provenance chain
- [ ] Provenance chain exportable as JSON
- [ ] Project + date range query returns results in under 2 seconds
- [ ] Query results exportable as CSV
- [ ] Authorization compliance check verifies policy edges on all traces
- [ ] Traces without policy authorization flagged as "unverified" with explanation

## Technical Notes
- Provenance chain query: `SELECT *, <-invoked<-agent_session AS sessions, ->attributed_to->task AS tasks, ->scoped_to->workspace AS workspaces FROM llm_trace WHERE id = $traceId`
- Date range query: `SELECT * FROM llm_trace WHERE ->scoped_to->workspace = $ws AND created_at >= $start AND created_at <= $end`
- Compliance check: batch query all traces in period, LEFT JOIN to policy authorization edges, flag nulls
- CSV export: server-side generation to handle large result sets; streaming response for >1000 rows
- JSON export: single trace with all edges expanded inline

## Dependencies
- US-LP-003 (graph trace capture -- audit reads trace data)
- US-LP-005 (policy enforcement -- policy edges created during authorization)
- Brain policy engine (existing -- policies with lifecycle and versioning)
