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

## Story 2b: Event-Triggered Commit Verification

**Job:** Reality Verification

> As the **Brain system**, when a new commit is recorded, I want the Observer Agent to verify CI/check status for that commit SHA, so that commit quality is grounded in external signals before downstream tasks rely on it.

### Acceptance Criteria

```gherkin
Given a git_commit record is created with a SHA linked to a GitHub repo
When the SurrealDB EVENT fires
Then the Observer endpoint receives the full commit record
And queries the GitHub commit status API for the SHA
And creates a verified observation if all checks pass
Or creates a conflict observation if checks fail
And links the observation to the commit's linked task (if any) via "observes" edge
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
And the `observes` relation accepts `intent`, `git_commit`, and `observation` as OUT types
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

> As a **developer**, I want SurrealDB EVENTs defined for all observable state changes, so that the Observer Agent is triggered automatically without polling.

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

Given the schema migration is applied
When a new git_commit record is created
Then an ASYNC EVENT fires POSTing to /api/observe/git_commit/:commitId
And retries up to 3 times on failure

Given the schema migration is applied
When a decision status changes to "confirmed" or "superseded"
Then an ASYNC EVENT fires POSTing to /api/observe/decision/:decisionId
And retries up to 3 times on failure

Given the schema migration is applied
When an observation is created with source_agent != "observer_agent"
Then an ASYNC EVENT fires POSTing to /api/observe/observation/:observationId
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

## Story 9: Decision Confirmation Verification

**Job:** Cross-Agent Peer Review

> As the **Brain system**, when a decision is confirmed or superseded, I want the Observer Agent to verify that existing implementations align with the decision, so that decision-implementation drift is caught immediately.

### Acceptance Criteria

```gherkin
Given a decision "Standardize on tRPC" transitions to "confirmed"
When the Observer EVENT fires
Then the Observer loads tasks and commits related to the decision's project
And checks whether implementations contradict the decision
And creates a conflict observation if drift is detected
And creates an info observation if implementations align

Given a decision transitions to "superseded"
When the Observer EVENT fires
Then the Observer identifies tasks still implementing the old decision
And creates warning observations for each affected task
```

**Size:** M | **Priority:** Should-have

---

## Story 10: Cross-Agent Observation Peer Review

**Job:** Cross-Agent Peer Review

> As the **Brain system**, when any non-Observer agent creates an observation, I want the Observer Agent to cross-check that claim against graph state and external signals, so that agent observations are independently verified.

### Acceptance Criteria

```gherkin
Given the PM agent creates an observation "Task X is blocked by missing API key"
When the Observer EVENT fires (source_agent != "observer_agent")
Then the Observer loads the referenced task and its dependencies
And verifies whether the blocking claim matches graph state
And creates a peer-review observation linked to the original observation via "observes" edge
With verified: true if the claim checks out, or severity: "conflict" if it doesn't

Given the Observer agent creates an observation
Then no peer-review EVENT fires (prevents infinite loops)
```

**Size:** M | **Priority:** Should-have

---

## Deferred

- **Story 8: Observer Endpoint Idempotency** — tracked in [#134](https://github.com/marcus-sa/brain/issues/134)
