# Walking Skeleton: The Reflex Circuit

## Strategy

The walking skeleton proves the complete governance loop in a single test:

1. **Admin creates behavior definition** -- plain language goal and scoring logic
2. **Scorer evaluates telemetry** -- matches definition, produces score with rationale
3. **Behavior record persisted** -- score, rationale, definition reference, exhibits edge
4. **Authorizer restricts agent** -- policy gate denies intent when score below threshold
5. **Observer proposes learning** -- detects drift pattern, creates learning with evidence

## Test File

`tests/acceptance/dynamic-behaviors/walking-skeleton.test.ts`

## What It Proves

- A non-technical admin can define behavioral standards without code changes
- Agent actions are automatically scored against those standards
- Low scores trigger real enforcement via the existing policy gate
- The existing Observer and learning pipeline work with dynamic metrics
- The complete "Reflex Circuit" closes end-to-end

## What It Does NOT Prove

- LLM scoring accuracy (requires real LLM calls; tested via evals)
- Feed item rendering (frontend; US-DB-005 scope)
- Retry/timeout mechanics (tested in focused scorer-agent.test.ts scenarios)
- Observer rate limiting (tested in focused observer-integration.test.ts)

## Implementation Sequence

The walking skeleton test is NOT skipped. It drives the first implementation slice:

1. Enable walking-skeleton.test.ts (already enabled)
2. Create `behavior_definition` table + migration
3. Implement `createBehaviorDefinition()` in queries.ts
4. Extend `createBehavior()` to accept `definition` and `definition_version`
5. Verify `enrichBehaviorScores()` returns dynamic metric names
6. Verify policy gate evaluates `behavior_scores.Honesty` via existing `resolveDotPath()`
7. Walking skeleton passes -- commit

Then enable focused scenarios one at a time from the other test files.
