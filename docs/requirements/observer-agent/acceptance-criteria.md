# Observer Agent — Acceptance Criteria (Consolidated)

## AC-1: EVENT-triggered verification flow (Stories 1, 2, 6)

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

## AC-4: Idempotency (Story 8)

```gherkin
Scenario: Duplicate EVENT delivery
  Given a task transitions to "completed"
  And the Observer has already created an observation for this transition
  When the EVENT fires again (retry)
  Then no new observation is created
  And the endpoint returns HTTP 200

Scenario: Different transitions are not deduplicated
  Given a task transitions to "completed" and Observer creates an observation
  When the task is later reopened and transitions to "completed" again
  Then a new observation IS created (different transition instance)
```

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
