# Trace Migration: User Stories

Epic: trace-migration (GitHub Issue #126)
Job Story: When an agent, developer, or frontend consumer needs to inspect the execution history of a subagent invocation, I want to query trace data as independent graph-native records, so I can traverse execution trees and correlate traces without parsing embedded arrays.

---

## US-TM01: Schema -- Define spawns relation and remove embedded trace fields

### Problem
The Osabio platform stores subagent execution traces in two disconnected systems: embedded `subagent_traces` arrays on `message` records (migration 0013) and a graph-native `trace` table (migration 0023). Elena Vasquez, a developer debugging a PM agent invocation, finds it impossible to correlate message traces with intent traces because embedded arrays are invisible to graph traversal. She has to manually inspect raw message records instead of running a single graph query.

### Who
- Developer | Debugging subagent execution | Wants graph-traversable trace data
- System (chat pipeline) | Writing trace data | Needs a single canonical storage location
- System (API consumers) | Reading trace data | Needs consistent data source

### Solution
Create migration 0024 that defines a `spawns` relation table (`TYPE RELATION IN message OUT trace`) and removes all `subagent_traces` fields from the `message` table.

### Domain Examples
#### 1: Happy Path -- Clean migration on fresh database
Elena runs `bun migrate` on a database with migration 0023 already applied. Migration 0024 creates the `spawns` relation table and removes 11 `subagent_traces` field definitions from `message`. `INFO FOR TABLE spawns` shows `TYPE RELATION IN message OUT trace`. `INFO FOR TABLE message` shows no `subagent_traces` fields.

#### 2: Edge Case -- Migration on database with existing embedded traces
Marcus runs `bun migrate` on a database that has messages with existing `subagent_traces` data. The migration removes the field definitions. Old embedded data becomes inaccessible (acceptable per project policy: no backward compatibility, no data migration scripts).

#### 3: Boundary -- Trace type enum already includes subagent_spawn
Aisha checks the trace table ASSERT after migration. The `subagent_spawn` type was already included in migration 0023. No ASSERT change needed. The existing enum `["tool_call", "message", "subagent_spawn", "intent_submission", "bridge_exchange"]` already supports all needed types.

### UAT Scenarios (BDD)

#### Scenario: spawns relation table created
```gherkin
Given migration 0024 has been applied to the database
When querying INFO FOR TABLE spawns
Then the result shows TYPE RELATION IN message OUT trace
```

#### Scenario: Embedded subagent_traces fields removed from message
```gherkin
Given migration 0024 has been applied to the database
When querying INFO FOR TABLE message
Then no field definition for subagent_traces exists
And no field definition for subagent_traces[*].agentId exists
And no field definition for subagent_traces[*].steps exists
And no field definition for subagent_traces[*].steps[*].type exists
```

#### Scenario: Trace table schema unchanged
```gherkin
Given migration 0024 has been applied to the database
When querying INFO FOR TABLE trace
Then the trace table fields match the 0023 migration definition
And the type ASSERT includes "subagent_spawn"
```

### Acceptance Criteria
- [ ] Migration 0024 creates `spawns` as `TYPE RELATION IN message OUT trace`
- [ ] Migration 0024 removes all `subagent_traces` field definitions from `message`
- [ ] `surreal-schema.surql` master schema reflects both changes
- [ ] Existing `trace` table schema is not modified

### Technical Notes
- Migration must use `DEFINE TABLE OVERWRITE spawns TYPE RELATION IN message OUT trace SCHEMAFULL`
- Use `REMOVE FIELD subagent_traces ON message` to drop the embedded field and all nested sub-fields
- Wrap in `BEGIN TRANSACTION; ... COMMIT TRANSACTION;`
- Next migration number: 0024

### Dependencies
- Migration 0023 (trace table) must be applied first -- already merged

---

## US-TM02: Write Path -- Persist subagent traces as graph-native records

### Problem
Elena Vasquez, a developer inspecting PM agent behavior, cannot use graph queries to traverse subagent call trees because `chat-route.ts` persists traces as embedded JSON arrays on message records. The data exists but is trapped in a denormalized blob, invisible to `SELECT ->spawns->trace` queries that would make forensic analysis straightforward.

### Who
- Developer | Debugging subagent execution via graph queries | Wants trace records linked by parent_trace
- System (chat pipeline) | Processing subagent tool output | Needs to persist trace hierarchy atomically

### Solution
Modify the `onFinish` callback in `chat-route.ts` to create `trace` records with parent-child hierarchy and a `spawns` relation edge from the assistant message to the root trace, instead of embedding `subagent_traces` on the message record.

### Domain Examples
#### 1: Happy Path -- PM agent invocation with 3 tool calls
Elena sends "Plan work for Riverside Bakery: menu display, cart, checkout." The PM agent runs `search_entities`, `suggest_work_items`, and `create_observation` in 3200ms. The `onFinish` callback creates: (1) root trace with `type: "subagent_spawn"`, `tool_name: "invoke_pm_agent"`, `duration_ms: 3200`; (2) three child traces with `parent_trace` pointing to root; (3) `RELATE message:msg1 ->spawns-> trace:root1`.

#### 2: Edge Case -- PM agent invoked but returns zero tool calls
Marcus sends "What is the status of the CI project?" The PM agent responds with text only, no tool calls. The `onFinish` callback creates: (1) root trace with `type: "subagent_spawn"`, `duration_ms: 800`, zero children; (2) spawns edge from message to root. The root trace alone documents that the subagent was invoked.

#### 3: Error/Boundary -- Trace persistence fails
Aisha's message triggers the PM agent, but the database connection drops momentarily during trace creation. The assistant message text is already persisted (it was created first). The trace creation fails and logs an error. The message exists without a spawns edge -- graceful degradation. No data corruption.

#### 4: Multiple subagents on one message
Tomoko sends a complex message that triggers both PM agent and analytics agent. The `onFinish` callback creates two separate root traces (one per subagent), each with their own child hierarchies, and two spawns edges from the same message.

### UAT Scenarios (BDD)

#### Scenario: Subagent trace creates root and child records
```gherkin
Given Elena Vasquez has an onboarded workspace "Riverside Bakery"
And Elena sends "Plan the online ordering feature"
When the PM agent executes search_entities, suggest_work_items, and create_observation
And the assistant response is persisted
Then a trace record exists with type "subagent_spawn" and tool_name "invoke_pm_agent"
And 3 child trace records exist with parent_trace pointing to the root
And a spawns edge connects the assistant message to the root trace
And the assistant message record has no subagent_traces field
```

#### Scenario: Empty subagent trace creates root with no children
```gherkin
Given Marcus Henriksson has an onboarded workspace "DevOps Hub"
And Marcus sends "Check project status"
When the PM agent returns with no tool calls
Then a root trace record exists with type "subagent_spawn" and duration_ms > 0
And zero child trace records exist for this root
And a spawns edge connects the assistant message to the root trace
```

#### Scenario: Trace persistence failure does not block message
```gherkin
Given Aisha Patel has an onboarded workspace "HealthTrack"
When trace record creation fails due to a transient database error
Then the assistant message is still persisted with text content
And an error is logged for the trace persistence failure
```

#### Scenario: Multiple subagent traces on one message
```gherkin
Given Tomoko Nakamura has an onboarded workspace "Sushi Express"
And Tomoko sends a message that triggers PM agent and analytics agent
When both subagents complete
Then 2 root trace records exist with type "subagent_spawn"
And 2 spawns edges connect the assistant message to each root trace
```

### Acceptance Criteria
- [ ] onFinish creates root `trace` record with `type: "subagent_spawn"` for each subagent invocation
- [ ] onFinish creates child `trace` records with `parent_trace` for each step (tool_call or text)
- [ ] onFinish creates `spawns` edge from assistant message to root trace
- [ ] `actor` and `workspace` fields populated on all trace records
- [ ] Message record contains no embedded `subagent_traces`
- [ ] Trace persistence failure is caught, logged, and does not block message persistence

### Technical Notes
- Trace records need `actor` (identity) and `workspace` -- both available in the `onFinish` closure context
- Use `RELATE` for spawns edge (not `CREATE` -- per SurrealDB relation convention)
- Consider wrapping trace creation + RELATE in a transaction for atomicity
- The PM agent `SubagentTrace` output type stays unchanged -- only the persistence mapping changes
- `input` and `output` fields on trace are `option<object> FLEXIBLE` -- can store argsJson/resultJson as parsed objects rather than strings

### Dependencies
- US-TM01 (schema migration) must be applied first

---

## US-TM03: Read Paths -- Reconstruct traces from graph for API and branch inheritance

### Problem
Carlos Rodriguez, a developer loading a conversation in the Osabio UI, sees no trace data because the workspace-routes and branch-chain code still queries `subagent_traces` from message records -- a field that no longer exists after the migration. The frontend renders empty trace blocks. Similarly, when Priya Sharma branches a conversation, inherited messages lose their trace context because `branch-chain.ts` no longer finds the embedded field.

### Who
- Frontend consumer | Loading conversation via API | Needs subagentTraces in response
- System (branch-chain) | Loading inherited messages | Needs traces available on ancestor messages
- Developer | Debugging via API | Expects trace data in conversation endpoint

### Solution
Update `workspace-routes.ts` (both conversation load paths) and `branch-chain.ts` to load traces via `spawns` edge traversal and reconstruct the `SubagentTrace` wire format from `trace` records. The API response shape stays identical -- only the data source changes.

### Domain Examples
#### 1: Happy Path -- Conversation load with traces
Carlos loads a conversation for "Riverside Bakery" containing 5 messages, one of which has PM agent traces (3 tool call steps). The GET endpoint queries `SELECT ->spawns->trace FROM message WHERE conversation = $c`, then for each root trace queries children. The response includes `subagentTraces` on the relevant message with `agentId: "pm_agent"`, `intent: "plan_work"`, 3 steps, and `totalDurationMs: 3200`.

#### 2: Edge Case -- Message with no traces
Priya loads a conversation where all messages are direct chat responses (no subagent invocation). No spawns edges exist. The response has no `subagentTraces` field on any message -- same behavior as before.

#### 3: Boundary -- Branch inheritance with traces on ancestor
Aisha has a 10-message conversation. She branches from message #5, which has PM agent traces. `loadMessagesWithInheritance` loads messages #1-5 as inherited. The trace for message #5 is loaded via its spawns edge and included in the inherited message. Aisha's branch shows the trace context from the parent conversation.

### UAT Scenarios (BDD)

#### Scenario: Conversation load returns traces from graph traversal
```gherkin
Given Carlos Rodriguez has a conversation in workspace "Riverside Bakery"
And the 2nd assistant message has a spawns edge to a trace tree with 3 tool call steps
When Carlos loads the conversation via GET /api/workspaces/:wsId/conversations/:convId
Then the 2nd assistant message includes subagentTraces with 1 entry
And the entry has agentId "pm_agent" and totalDurationMs 3200
And the entry has 3 steps with type "tool_call" and populated toolName and argsJson
```

#### Scenario: Messages without traces omit subagentTraces field
```gherkin
Given Priya Sharma has a conversation with only direct chat responses
When loading the conversation via API
Then no message in the response includes a subagentTraces field
```

#### Scenario: Branch inheritance includes traces from ancestor
```gherkin
Given Aisha Patel has a conversation with PM agent traces on message #5
And Aisha branches a new conversation from message #5
When loading messages with inheritance for the branched conversation
Then inherited message #5 includes subagent_traces from trace records
And the trace agentId is "pm_agent" and steps match the original
```

#### Scenario: Wire format backward compatibility
```gherkin
Given a message with trace records exists
When the conversation is loaded via API
Then the subagentTraces array entries contain:
  | field          | type   |
  | agentId        | string |
  | intent         | string |
  | totalDurationMs| number |
  | steps          | array  |
And each step contains type, toolName, argsJson, resultJson, durationMs, and text fields
```

### Acceptance Criteria
- [ ] Conversation load endpoint returns `subagentTraces` from graph traversal (not embedded field)
- [ ] API wire format is identical to previous format (SubagentTrace shape preserved)
- [ ] Messages without traces return no `subagentTraces` field
- [ ] Branch inheritance loads traces via spawns edges for inherited messages
- [ ] `subagent_traces` field removed from all SQL queries in `branch-chain.ts`
- [ ] Both workspace-routes conversation load paths updated (bootstrap + conversation detail)

### Technical Notes
- Batch trace loading: for a conversation with N messages, avoid N+1 queries. Consider loading all spawns edges for the message batch in one query, then loading all child traces in a second query.
- The `input` and `output` fields on trace records are `FLEXIBLE` objects -- may need to re-serialize to JSON strings for `argsJson`/`resultJson` in the wire format.
- The `SubagentTrace` type in contracts.ts and the `InheritableMessage` type in branch-chain.ts should continue using the same type -- the reconstruction logic maps from trace records back to this type.

### Dependencies
- US-TM01 (schema migration)
- US-TM02 (write path -- traces must exist to be read)

---

## US-TM04: Acceptance Test -- Validate normalized trace end-to-end

### Problem
The existing acceptance test (`subagent-traces.test.ts`) validates the old embedded structure by querying `SELECT subagent_traces FROM message`. After the migration, this test will fail because the field no longer exists. Marcus Henriksson, maintaining the test suite, needs the test to validate the new normalized structure while covering the same functional requirement: subagent traces are persisted and loadable.

### Who
- Developer (test maintainer) | Running acceptance tests | Needs tests to validate new structure
- CI pipeline | Automated test execution | Needs all tests green

### Solution
Rewrite `subagent-traces.test.ts` to validate trace records in the `trace` table via spawns edge traversal and verify the conversation load endpoint returns the reconstructed `subagentTraces` wire format.

### Domain Examples
#### 1: Happy Path -- Test validates trace records via graph
Marcus runs `bun test tests/acceptance/chat/subagent-traces.test.ts`. The test sends a planning message, waits for completion, then queries `SELECT ->spawns->trace FROM message:xyz`. It finds a root trace with `type: "subagent_spawn"`, queries children via `parent_trace`, and validates the hierarchy. Then it loads the conversation via API and validates the `subagentTraces` wire format.

#### 2: Edge Case -- PM agent not invoked (LLM non-determinism)
The test sends a planning message but the LLM decides not to invoke the PM agent. The test queries spawns edges and finds none. It logs a warning and skips trace structure assertions -- same pattern as the existing test.

#### 3: Boundary -- Validate no embedded field remains
The test explicitly queries `SELECT subagent_traces FROM message:xyz` and asserts the field is undefined/absent, confirming no embedded data leaked through.

### UAT Scenarios (BDD)

#### Scenario: Acceptance test validates trace hierarchy
```gherkin
Given a user sends "Plan work for DabDash: dashboard with order count, revenue, and alerts"
And the PM agent is invoked and completes
When the test queries SELECT ->spawns->trace FROM the assistant message
Then a root trace record is found with type "subagent_spawn"
And child trace records are found via parent_trace query
And each child has a valid type ("tool_call" or "message")
```

#### Scenario: Acceptance test validates API wire format
```gherkin
Given trace records exist for an assistant message
When the test loads the conversation via GET /api/workspaces/:wsId/conversations/:convId
Then the assistant message includes subagentTraces array
And the trace entry has agentId "pm_agent"
And the trace entry steps match the child trace records
```

#### Scenario: Acceptance test confirms no embedded traces
```gherkin
Given an assistant message with spawned trace records
When the test queries SELECT subagent_traces FROM the message record
Then the result field is undefined (field does not exist in schema)
```

### Acceptance Criteria
- [ ] Test validates trace records exist in `trace` table via spawns edge
- [ ] Test validates parent-child hierarchy (root + children via parent_trace)
- [ ] Test validates conversation load endpoint returns `subagentTraces` in wire format
- [ ] Test confirms `subagent_traces` field is absent from message record
- [ ] Test handles LLM non-determinism (PM agent not invoked) gracefully

### Technical Notes
- The test still uses the `collectSseEvents` pattern to wait for streaming completion
- Replace direct `SELECT subagent_traces FROM message` with `SELECT ->spawns->trace FROM message` for validation
- Keep the 180_000ms timeout -- PM agent invocation latency is unchanged

### Dependencies
- US-TM01, US-TM02, US-TM03 must all be complete (test validates the full pipeline)

---

## DoR Validation Summary

| DoR Item | US-TM01 | US-TM02 | US-TM03 | US-TM04 |
|----------|---------|---------|---------|---------|
| 1. Problem statement clear | PASS | PASS | PASS | PASS |
| 2. User/persona identified | PASS | PASS | PASS | PASS |
| 3. 3+ domain examples | PASS (3) | PASS (4) | PASS (3) | PASS (3) |
| 4. UAT scenarios (3-7) | PASS (3) | PASS (4) | PASS (4) | PASS (3) |
| 5. AC derived from UAT | PASS | PASS | PASS | PASS |
| 6. Right-sized (1-3 days) | PASS (~0.5d) | PASS (~1.5d) | PASS (~1.5d) | PASS (~0.5d) |
| 7. Technical notes | PASS | PASS | PASS | PASS |
| 8. Dependencies tracked | PASS | PASS | PASS | PASS |

**All stories pass DoR. Ready for DESIGN wave handoff.**

## Story Dependency Graph

```
US-TM01 (Schema)
    |
    +---> US-TM02 (Write Path)
    |         |
    |         +---> US-TM04 (Acceptance Test)
    |         |
    +---> US-TM03 (Read Paths)
              |
              +---> US-TM04 (Acceptance Test)
```

## MoSCoW Prioritization

| Story | Priority | Rationale |
|-------|----------|-----------|
| US-TM01 | Must Have | Foundation -- all other stories depend on schema |
| US-TM02 | Must Have | Without write path, no data flows to new structure |
| US-TM03 | Must Have | Without read paths, frontend and branches break |
| US-TM04 | Must Have | Validates the migration works end-to-end |

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| N+1 query on conversation load (reading traces per message) | Medium | Medium | Batch load all spawns edges + child traces in 2 queries |
| `FLEXIBLE` object fields cause type mismatches on read | Low | Medium | Explicit field mapping in reconstruction logic |
| Frontend breaks due to wire format mismatch | Low | High | API contract type unchanged; acceptance test validates shape |
| Trace creation in onFinish adds latency to response | Low | Low | Trace creation is after message persistence; user already received streamed response |
