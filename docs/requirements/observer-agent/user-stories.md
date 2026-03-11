# Observer Agent — User Stories

All stories use LeanUX format. Each traces to a job from `jtbd-job-stories.md`.

---

## Story 1: Event-Triggered Task Verification

**Job:** Reality Verification

> As the **Brain system**, when a task status transitions to `completed` or `done`, I want the Observer Agent to automatically verify the claim against external signals, so that the graph reflects verified reality.

### Acceptance Criteria

```gherkin
Given a task linked to a GitHub PR
And the task status transitions to "completed"
When the SurrealDB EVENT fires
Then the Observer endpoint receives the full task record
And queries GitHub CI status for the linked PR
And creates a verified observation if CI passes
Or creates a conflict observation if CI fails
And links the observation to the task via "observes" edge
```

**Size:** M | **Priority:** Must-have

---

## Story 2: Event-Triggered Intent Verification

**Job:** Reality Verification

> As the **Brain system**, when an intent reaches `completed` or `failed`, I want the Observer Agent to verify the action outcome, so that intent results are grounded in reality.

### Acceptance Criteria

```gherkin
Given an intent with action_spec targeting an external provider
When the intent status transitions to "completed"
Then the Observer endpoint receives the full intent record
And verifies the action outcome against the provider
And creates an observation recording the verification result
And links the observation to the intent via "observes" edge
```

**Size:** M | **Priority:** Must-have

---

## Story 3: Graceful Degradation on External Failure

**Job:** Reality Verification

> As the **Brain system**, when external verification sources are unreachable, I want the Observer to create a warning observation and let the entity proceed, so that Observer failures never block work.

### Acceptance Criteria

```gherkin
Given a task transitioning to "completed"
And the external API (GitHub) is unreachable
When the Observer attempts verification
Then it creates an observation with severity "warning" noting the failure
And the task status is NOT reverted or blocked
And the EVENT RETRY mechanism handles transient failures (up to 3 retries)
```

**Size:** S | **Priority:** Must-have

---

## Story 4: Schema Extensions for Verification

**Job:** Reality Verification, Cross-Agent Peer Review

> As a **developer**, I want the observation table to include `verified`, `source`, and `data` fields, so that observations can carry external grounding metadata.

### Acceptance Criteria

```gherkin
Given the observation table schema
When I apply the migration
Then `verified` is a bool field defaulting to false
And `source` is an optional string field
And `data` is an optional object field
And `observation_type` accepts "validation" and "error" in addition to existing values
And the `observes` relation accepts `intent` as an OUT type
```

**Size:** S | **Priority:** Must-have

---

## Story 5: Observer Agent Core

**Job:** Reality Verification, Cross-Agent Peer Review

> As the **Brain system**, I want a dedicated Observer Agent implemented as a ToolLoopAgent, so that verification logic is encapsulated in a specialized agent with appropriate tools and authority.

### Acceptance Criteria

```gherkin
Given the Observer Agent is initialized with workspace context
When it receives a verification request
Then it uses the ToolLoopAgent pattern (like PM Agent)
And has access to: create_observation, get_entity_detail, search_entities
And runs on a cost-efficient model (Haiku-class)
And operates under the "observer" authority scope
And returns structured output: { observations_created, verdict, evidence }
```

**Size:** L | **Priority:** Must-have

---

## Story 6: SurrealDB EVENT Definitions

**Job:** Reality Verification

> As a **developer**, I want SurrealDB EVENTs defined for task and intent terminal transitions, so that the Observer Agent is triggered automatically without polling.

### Acceptance Criteria

```gherkin
Given the schema migration is applied
When a task status changes to "completed" or "done" (and was not previously in that state)
Then an ASYNC EVENT fires POSTing to /api/observe/task/:taskId
And retries up to 3 times on failure

Given the schema migration is applied
When an intent status changes to "completed" or "failed" (and was not previously in that state)
Then an ASYNC EVENT fires POSTing to /api/observe/intent/:intentId
And retries up to 3 times on failure
```

**Size:** S | **Priority:** Must-have

---

## Story 7: Periodic Graph Scan

**Job:** Cross-Agent Peer Review

> As the **Brain system**, I want the Observer Agent to periodically scan the graph for contradictions, stale blockers, and drift, so that cross-agent inconsistencies are caught proactively.

### Acceptance Criteria

```gherkin
Given a workspace with active projects
When the scan endpoint is called (POST /api/observe/scan/:workspaceId)
Then the Observer loads confirmed decisions and completed tasks
And detects contradictions between decisions and implementations
And detects tasks blocked longer than 14 days
And creates observations for each finding with appropriate severity
And links observations to affected entities via "observes" edges
And deduplicates against existing open observations on the same entities
```

**Size:** L | **Priority:** Should-have

---

## Story 8: Observer Endpoint Idempotency

**Job:** Reality Verification

> As a **developer**, I want the Observer endpoint to be idempotent, so that duplicate EVENT deliveries (from RETRY) don't create duplicate observations.

### Acceptance Criteria

```gherkin
Given a task that has already been verified by the Observer
When the EVENT fires again for the same status transition
Then no new observation is created
And the endpoint returns 200 (not an error)
```

**Size:** S | **Priority:** Must-have
