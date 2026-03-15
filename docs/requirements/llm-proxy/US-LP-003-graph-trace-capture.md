# US-LP-003: Graph-Native Trace Capture

## Problem
Marcus Olsson is a workspace admin who has zero visibility into what his coding agents are doing with the LLM. LLM calls are logged to stdout but not connected to the knowledge graph. He cannot query "show me all LLM calls for task X" or "which agent session consumed the most tokens." Every trace is isolated text in a log file, not a queryable graph entity.

## Who
- Workspace Admin | Manages agent workloads and costs | Needs queryable trace data in the graph
- Compliance Auditor | Quarterly audit cycles | Needs graph-traversable provenance chains

## Job Story Trace
- JS-4: Auditable Agent Provenance
- JS-1: Transparent Cost Visibility (traces are the data source for cost attribution)

## Solution
After each LLM call completes, asynchronously create an `trace` node in SurrealDB with usage data, cost, and latency. Create `RELATE` edges linking the trace to its agent session, workspace, and optionally task. All graph writes are non-blocking -- they must not add latency to the response delivery.

## Domain Examples

### 1: Happy Path -- Full trace with all edges
Priya's Claude Code completes a streaming request for "claude-sonnet-4" with 12,340 input tokens (8,200 cache read) and 2,100 output tokens. Cost: $0.068. The proxy creates `trace:tr-001` with all usage fields, then creates edges: `agent_session:6ba7b810 -> invoked -> trace:tr-001`, `trace:tr-001 -> attributed_to -> task:implement-oauth`, `trace:tr-001 -> scoped_to -> workspace:brain-v1`. Marcus later queries `SELECT ->invoked->trace FROM agent_session:6ba7b810` and sees all 8 traces from Priya's session.

### 2: Edge Case -- Trace without task attribution
Priya's request had no X-Brain-Task header. The trace is created with workspace and session edges but no `attributed_to` edge. The trace still appears in workspace-level cost queries but not in task-level queries.

### 3: Error Path -- Graph write fails (SurrealDB temporarily unavailable)
The LLM call succeeds and the response is delivered to Priya. The async trace write fails because SurrealDB is briefly unreachable. The proxy retries the write 3 times with exponential backoff. If all retries fail, the trace data is logged to stderr as structured JSON (recovery fallback) and a warning observation is created when SurrealDB reconnects.

### 4: Edge Case -- Non-streaming response trace
A non-streaming request completes with a JSON response containing `usage: {input_tokens: 500, output_tokens: 100}`. The proxy extracts usage from the response body (not SSE events) and creates the same trace structure.

## UAT Scenarios (BDD)

### Scenario: Trace created with full usage data after streaming call
Given Priya's streaming request completes with model "claude-sonnet-4"
And the response included input_tokens=12340, output_tokens=2100, cache_read=8200
When the async trace capture runs
Then an trace node exists with model="claude-sonnet-4", input_tokens=12340, output_tokens=2100, cache_read_input_tokens=8200
And cost_usd is computed from Sonnet 4 pricing
And latency_ms records the total request duration
And stop_reason records the value from message_delta

### Scenario: Trace edges link to session, workspace, and task
Given the identity resolution produced session="6ba7b810", workspace="brain-v1", task="implement-oauth"
When the trace is captured
Then edge "agent_session:6ba7b810 -> invoked -> trace:{id}" exists
And edge "trace:{id} -> attributed_to -> task:implement-oauth" exists
And edge "trace:{id} -> scoped_to -> workspace:brain-v1" exists

### Scenario: Trace without task has workspace and session edges only
Given no X-Brain-Task header was present
When the trace is captured
Then edge "trace:{id} -> scoped_to -> workspace:brain-v1" exists
And edge "agent_session:{id} -> invoked -> trace:{id}" exists
And no attributed_to edge is created

### Scenario: Trace capture does not block response
Given a streaming response is being relayed to Claude Code
When the stream completes and the client connection closes
Then trace capture begins asynchronously
And the response delivery time is not affected by graph write duration

### Scenario: Graph write failure triggers retry and fallback
Given SurrealDB is temporarily unreachable after a call completes
When the trace capture attempts to write
Then the proxy retries 3 times with exponential backoff
And if all retries fail, trace data is logged to stderr as structured JSON
And a warning observation is created when SurrealDB reconnects

## Acceptance Criteria
- [ ] trace node created for every successfully forwarded LLM call
- [ ] Trace includes: model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, latency_ms, stop_reason, request_id, created_at
- [ ] RELATE edges created: session -> invoked -> trace, trace -> scoped_to -> workspace
- [ ] Optional RELATE edge: trace -> attributed_to -> task (when task identity resolved)
- [ ] All graph writes are async and non-blocking (tracked via inflight tracker)
- [ ] Graph write failure retried 3x with exponential backoff; fallback to stderr JSON log

## Technical Notes
- trace table must be SCHEMAFULL with all fields defined
- RELATE edges: `invoked` (TYPE RELATION IN agent_session OUT trace), `attributed_to` (TYPE RELATION IN trace OUT task|feature|project), `scoped_to` (TYPE RELATION IN trace OUT workspace)
- Use `deps.inflight.track()` for async trace writes (consistent with Brain's existing pattern)
- Cost calculation uses local pricing table (model -> input/output/cache_write/cache_read rates per million tokens)
- Schema migration required: new tables `trace`, `invoked`, `attributed_to` (reuse existing if compatible), `scoped_to`

## Dependencies
- US-LP-001 (proxy passthrough -- trace capture reads usage from the same SSE events)
- US-LP-002 (identity resolution -- trace edges depend on resolved identity)
