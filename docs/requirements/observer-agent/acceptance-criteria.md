# Observer Agent — Acceptance Criteria (Consolidated)

## AC-1: EVENT-triggered verification flow (Stories 1, 2, 2b, 6, 9, 10)

```gherkin
Scenario: Task completion triggers Observer via SurrealDB EVENT
  Given a task with status "in_progress" linked to source_commit
  When the task status is updated to "completed"
  Then within 5 seconds, the Observer endpoint receives a POST with the full task record
  And the Observer creates exactly one observation linked to the task

Scenario: Intent completion triggers Observer via SurrealDB EVENT
  Given an intent with status "executing" and action_spec { provider: "github", action: "merge_pr" }
  When the intent status is updated to "completed"
  Then the Observer endpoint receives a POST with the full intent record
  And the Observer creates exactly one observation linked to the intent

Scenario: Commit creation triggers Observer via SurrealDB EVENT
  Given a new git_commit record is created with a SHA
  Then within 5 seconds, the Observer endpoint receives a POST with the full commit record
  And the Observer queries GitHub commit status API for the SHA
  And creates an observation linked to the commit's associated task (if any)

Scenario: Decision confirmation triggers Observer via SurrealDB EVENT
  Given a decision with status "proposed"
  When the decision status is updated to "confirmed"
  Then the Observer endpoint receives a POST with the full decision record
  And the Observer checks related implementations for alignment

Scenario: Other agent's observation triggers peer review via SurrealDB EVENT
  Given the PM agent creates an observation with source_agent "pm_agent"
  Then the Observer endpoint receives a POST with the full observation record
  And the Observer cross-checks the claim against graph state

Scenario: Observer's own observation does NOT trigger peer review
  Given the Observer agent creates an observation with source_agent "observer_agent"
  Then no observation_peer_review EVENT fires

Scenario: Non-terminal transitions do NOT trigger Observer
  Given a task with status "open"
  When the task status is updated to "in_progress"
  Then no Observer EVENT fires
```

## AC-2: Verification verdicts (Story 1, 3)

```gherkin
Scenario: Verified match
  Given the Observer receives a task completion event
  And the linked GitHub PR has passing CI
  When the Observer evaluates
  Then it creates an observation with severity "info", observation_type "validation", verified true

Scenario: Verified mismatch
  Given the Observer receives a task completion event
  And the linked GitHub PR has failing CI
  When the Observer evaluates
  Then it creates an observation with severity "conflict", observation_type "contradiction", verified false

Scenario: No signal source available
  Given the Observer receives a task completion event
  And the task has no linked PR or external integration
  When the Observer evaluates
  Then it creates an observation with severity "info", observation_type "missing"
  And the task status is not affected

Scenario: External API failure
  Given the Observer receives a task completion event
  And the GitHub API returns 503
  When the Observer evaluates
  Then it creates an observation with severity "warning", observation_type "error"
  And the task status is not affected
```

## AC-3: Schema extensions (Story 4)

```gherkin
Scenario: New observation fields persist correctly
  Given the migration is applied
  When an observation is created with verified: true, source: "GitHub CI", data: { status: "passing" }
  Then all three fields are persisted and queryable

Scenario: Extended observation_type enum
  Given the migration is applied
  When an observation is created with observation_type "validation"
  Then it is accepted by the schema
  When an observation is created with observation_type "error"
  Then it is accepted by the schema

Scenario: Observes edge accepts intent
  Given the migration is applied
  When an observes edge is created from observation to intent
  Then the relation is accepted by the schema
```

## AC-4: Idempotency (Story 8) — Deferred

Tracked in [#134](https://github.com/marcus-sa/brain/issues/134)

## AC-5: Graph scan (Story 7)

```gherkin
Scenario: Detect decision-implementation contradiction
  Given a confirmed decision "Use tRPC for all APIs"
  And a completed task whose description mentions REST API implementation
  When the Observer scan runs for the workspace
  Then it creates an observation with severity "conflict", observation_type "contradiction"
  And the observation is linked to both the decision and the task

Scenario: Detect stale blocked task
  Given a task in "blocked" status with updated_at older than 14 days
  When the Observer scan runs for the workspace
  Then it creates an observation with severity "warning", observation_type "anomaly"

Scenario: Scan deduplicates existing observations
  Given an existing open observation about a stale blocked task
  When the Observer scan runs again
  Then no duplicate observation is created for the same task
```

## AC-7: Decision verification (Story 9)

```gherkin
Scenario: Decision confirmed — implementations align
  Given a decision "Use tRPC for all APIs" transitions to "confirmed"
  When the Observer EVENT fires
  Then the Observer checks related tasks and commits
  And creates an observation with severity "info", verified true

Scenario: Decision confirmed — implementation drift detected
  Given a decision "Use tRPC for all APIs" transitions to "confirmed"
  And a completed task implements REST endpoints in the same project
  When the Observer EVENT fires
  Then it creates an observation with severity "conflict", observation_type "contradiction"
  And the observation is linked to both the decision and the drifting task

Scenario: Decision superseded — stale implementations flagged
  Given a decision transitions to "superseded"
  And 3 tasks still reference the old decision
  When the Observer EVENT fires
  Then it creates warning observations for each affected task
```

## AC-8: Cross-agent observation peer review (Story 10)

```gherkin
Scenario: PM agent observation verified by Observer
  Given the PM agent creates an observation "Task X is blocked"
  When the Observer EVENT fires
  Then the Observer loads task X and checks its status and dependencies
  And creates a peer-review observation linked to the original via "observes" edge
  With verified: true if the claim matches graph state

Scenario: PM agent observation contradicted by Observer
  Given the PM agent creates an observation "Deploy succeeded"
  And the linked deployment actually failed
  When the Observer EVENT fires
  Then the Observer creates an observation with severity "conflict"
  And links it to the original observation via "observes" edge

Scenario: Observer's own observations do NOT trigger peer review
  Given the Observer agent creates an observation
  Then no observation_peer_review EVENT fires
  And no infinite loop occurs
```

## AC-6: Observer Agent structure (Story 5)

```gherkin
Scenario: Observer Agent uses ToolLoopAgent pattern
  Given the Observer Agent is invoked with a verification request
  Then it initializes as a ToolLoopAgent with observer authority scope
  And has access to create_observation, get_entity_detail, search_entities tools
  And returns structured output with observations_created count and verdict

Scenario: Observer Agent context loading
  Given the Observer Agent is invoked for a workspace
  Then its system prompt includes workspace summary and open observations
  And it runs on a Haiku-class model for cost efficiency
```
