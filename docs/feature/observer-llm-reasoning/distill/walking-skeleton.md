# Observer LLM Reasoning: Walking Skeleton

## Purpose

The walking skeleton proves the thinnest possible E2E path through the LLM reasoning system. It validates that:

1. A task completion triggers LLM semantic analysis against related decisions
2. The LLM produces a structured verdict with meaningful text
3. The system handles the case where no decisions exist (no contradiction possible)

## Skeleton 1: Semantic Contradiction Detection

```
Given: workspace -> project -> confirmed decision (minimize dependencies)
       workspace -> project -> task (add Redis + Kafka) [in_progress]

When:  task status transitions to "completed"

Then:  SurrealDB EVENT task_completed fires
       Observer route receives POST /api/observe/task/:id
       Context loader loads related decisions for task's project
       LLM reasoning evaluates task against decisions
       Observation created with:
         - source_agent = "observer_agent"
         - text describing the semantic finding
         - severity in ["info", "warning", "conflict"]
         - observes edge links observation to task
```

### What This Proves

- SurrealDB EVENTs trigger the observer route (existing infra)
- Context loader successfully queries project decisions
- LLM generates structured output via Vercel AI SDK `generateObject`
- Observation writer persists the verdict with correct fields
- The full pipeline completes within 120s timeout

## Skeleton 2: No Decisions (Graceful Handling)

```
Given: workspace -> project (no decisions)
       workspace -> project -> task [in_progress]

When:  task status transitions to "completed"

Then:  Observer receives event
       Context loader returns empty decisions list
       Observer creates informational observation (no contradiction possible)
       Observation has severity = "info"
```

### What This Proves

- Pipeline handles zero-decision case without errors
- LLM or deterministic path produces valid observation regardless
- System never blocks or crashes on empty context

## Environment Requirements

```bash
# Required for LLM reasoning tests
OBSERVER_MODEL=anthropic/claude-haiku-4-5-20251001  # or any Haiku-class model

# Standard acceptance test env
SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_USERNAME=root
SURREAL_PASSWORD=root
OPENROUTER_API_KEY=<key>
```

## Run Command

```bash
bun test --env-file=.env tests/acceptance/observer-llm-reasoning/walking-skeleton.test.ts
```

## Relationship to Observer-Agent Walking Skeleton

The observer-agent walking skeleton (`tests/acceptance/observer-agent/walking-skeleton.test.ts`) validates the deterministic verification pipeline — task completion -> observation with verdict, graceful degradation without external signals.

This LLM reasoning walking skeleton builds on that foundation by adding:
- **Semantic analysis**: LLM evaluates alignment between task and decision text
- **Project-scoped context**: Decisions loaded from the task's project
- **Structured LLM output**: Confidence scores, evidence refs, reasoning text

The observer-agent skeleton must pass before this one can succeed, as it relies on the same event wiring and observation infrastructure.
