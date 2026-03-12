# Component Boundaries: Observer LLM Reasoning

## Module Structure

All new code lives within existing modules. No new top-level directories.

```
app/src/server/
  observer/
    observer-route.ts          # MODIFY — pass observer model to handlers
    verification-pipeline.ts   # MODIFY — add LLM verdict types + pure skip/threshold logic
    graph-scan.ts              # MODIFY — add LLM synthesis dispatch + pure filter/dedup logic
    external-signals.ts        # NO CHANGE
    llm-reasoning.ts           # NEW — effect boundary: generateObject for verification
    llm-synthesis.ts           # NEW — effect boundary: generateObject for pattern synthesis
    context-loader.ts          # NEW — effect boundary: graph queries for LLM context
    evidence-validator.ts      # NEW — pure core: validate/strip entity refs from LLM output
    schemas.ts                 # NEW — Zod schemas for LLM structured output
  agents/observer/
    agent.ts                   # MODIFY — accept optional LLM model, wire LLM reasoning
    prompt.ts                  # MODIFY — extend prompt for LLM-enhanced context
    tools.ts                   # NO CHANGE
  runtime/
    config.ts                  # MODIFY — add OBSERVER_MODEL
    dependencies.ts            # MODIFY — create observer model client
    types.ts                   # MODIFY — add observerModel to ServerDependencies
  observation/
    queries.ts                 # MODIFY — add observes edges for multiple targets
schema/
  migrations/                  # NEW migration for confidence + evidence_refs fields
```

## Dependency-Inversion Compliance

### Pure Core (no IO, no imports from effect boundary)

| Component | Responsibility | Purity |
|-----------|---------------|--------|
| `verification-pipeline.ts` (existing + extensions) | Skip optimization logic, confidence threshold evaluation, verdict selection | Pure functions: input signals -> verdict decision |
| `evidence-validator.ts` (new) | Strip invalid entity refs from LLM output | Pure: takes LLM output + valid entity set -> cleaned output |
| `schemas.ts` (new) | Zod schema definitions for LLM structured output | Pure: type definitions only |
| Synthesis filtering in `graph-scan.ts` | Min-signal filter, partition logic, dedup matching | Pure functions on anomaly/pattern data |

### Effect Boundary (IO operations)

| Component | Responsibility | Effects |
|-----------|---------------|---------|
| `observer-route.ts` | HTTP handler, dispatches to pipelines | HTTP request parsing, calls effect + pure functions |
| `context-loader.ts` (new) | Loads decisions, constraints, tasks from graph | SurrealDB queries |
| `llm-reasoning.ts` (new) | Calls `generateObject` for semantic verification | LLM API call, timeout handling |
| `llm-synthesis.ts` (new) | Calls `generateObject` for pattern synthesis | LLM API call, timeout handling |
| `observation/queries.ts` | Creates observations + observes edges | SurrealDB writes |

### Dependency Direction

```
observer-route.ts (effect shell)
  |
  |-- context-loader.ts (effect boundary)
  |     |-- SurrealDB
  |
  |-- verification-pipeline.ts (pure core)
  |     |-- NO external imports
  |
  |-- llm-reasoning.ts (effect boundary)
  |     |-- Vercel AI SDK (generateObject)
  |     |-- schemas.ts (pure)
  |     |-- evidence-validator.ts (pure)
  |
  |-- observation/queries.ts (effect boundary)
        |-- SurrealDB
```

Dependencies point inward: effect boundaries depend on pure core, never the reverse.

## Interface Contracts

### LLM Reasoning Effect Boundary

Input: entity context (assembled by context loader) + deterministic verdict + model reference
Output: LLM verdict (structured) OR undefined on failure

The LLM reasoning module receives a pre-assembled context object and returns a structured verdict. It does not query the database or assemble context itself.

### Context Loader Effect Boundary

Input: entity record + workspace record
Output: related decisions, constraints, external signals

Encapsulates all graph queries needed for LLM reasoning context. Returns plain data objects consumed by both deterministic and LLM pipelines.

### Evidence Validator Pure Core

Input: LLM output with entity refs + set of valid entity IDs in workspace
Output: cleaned LLM output with invalid refs stripped

Pure function. No IO. Validates that entity references in LLM output actually exist.

### Verdict Logic Pure Core (extension of verification-pipeline.ts)

Input: workspace settings + deterministic verdict + optional LLM verdict
Output: final verdict to persist (which source won, what severity/type)

Pure function. Reads `settings.observer_skip_deterministic` from workspace record (defaults to `true` when absent). Encapsulates skip optimization, confidence thresholds, fallback selection.

## Batching Rationale

The three LLM-related new files (`llm-reasoning.ts`, `llm-synthesis.ts`, `schemas.ts`) follow the same structural pattern (Zod schema + generateObject + timeout + fallback) but differ in:
- Schema shape (verification verdict vs synthesis pattern)
- Prompt content (entity-focused vs workspace-focused)
- Output handling (single verdict vs array of patterns)

Splitting into separate files keeps each under 100 lines and enables independent testing.

`evidence-validator.ts` is separate because it is pure and shared by both verification and synthesis paths.
