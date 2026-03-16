# Evolution: LLM Reasoning as Internal Telemetry

**Feature**: intent-llm-traces
**Date**: 2026-03-16
**Status**: Complete
**ADR**: ADR-053-llm-reasoning-as-internal-telemetry

---

## Summary

Store LLM chain-of-thought reasoning on Observation and Intent nodes as internal telemetry. The Observer verification pipeline, graph scan, trace analyzer, and Intent authorization pipeline now persist the full LLM reasoning that produced each verdict alongside the record itself. Reasoning is admin-gated in API responses and surfaced through a collapsible "View Logic" panel in the UI.

**Why**: Agent decisions were opaque -- when the Observer flagged a contradiction or the Authorizer denied an intent, the reasoning behind the verdict was lost. This feature enables forensic debugging, compliance auditing, and future self-calibration by preserving the exact chain-of-thought that produced each automated judgment.

---

## Implementation Phases

### Phase 01: Observation Reasoning Persistence (Steps 01-01 through 01-04)

Added `reasoning` field (`option<string>`) to the observation table. Extended `createObservation` to accept an optional reasoning parameter. Threaded reasoning from all 6 Observer LLM paths:

1. **Verification verdict** -- `llm-reasoning.ts` -> `verification-pipeline.ts` -> `agent.ts` -> `createObservation`
2. **Peer review** -- `llm-reasoning.ts` -> `agent.ts` -> `createObservation`
3. **Contradiction detection** -- `llm-synthesis.ts` -> `graph-scan.ts` -> `createObservation`
4. **Anomaly evaluation** -- `llm-synthesis.ts` -> `graph-scan.ts` -> `createObservation`
5. **Trace contradiction** -- `trace-response-analyzer.ts` -> `createObservation`
6. **Trace missing decision** -- `trace-response-analyzer.ts` -> `createObservation`

Deterministic observations (no LLM involved) omit the reasoning field entirely.

### Phase 02: Intent Reasoning Persistence (Step 02-01)

Added `llm_reasoning` field (`option<string>`) to the intent table. Extended the LLM evaluator Zod schema with a `reasoning` field for full chain-of-thought, distinct from the existing `reason` field (one-line summary). Policy-only evaluations (no LLM call) omit `llm_reasoning`.

### Phase 03: Reasoning Query and API Gating (Step 03-01)

Added `listObservationsWithReasoning` and `listObservationsWithoutReasoning` query functions. Workspace-scoped, ordered by creation date, with configurable limit and optional time-range filtering. Gated `reasoning` and `llm_reasoning` fields in observation and intent detail API responses to admin-role requesters only. Non-admin responses omit reasoning fields entirely (not null, not empty).

### Phase 04: UI Reasoning Panel (Step 04-01)

Created shared `ReasoningPanel` component using Base UI collapsible primitive. Three states: reasoning available (full text in monospace), deterministic fallback message, legacy/empty not-available message. Integrated into `EntityDetailPanel` for observation and intent entity kinds. Panel collapsed by default, admin-only visibility enforced by API layer.

---

## Files Modified

### Step 01-01: Schema + verification reasoning path
- `schema/migrations/0050_observation_reasoning.surql` (new)
- `schema/surreal-schema.surql`
- `app/src/server/observation/queries.ts`
- `app/src/server/observer/llm-reasoning.ts`
- `app/src/server/observer/verification-pipeline.ts`
- `app/src/server/agents/observer/agent.ts`
- `tests/acceptance/intent-llm-traces/observation-reasoning.test.ts` (new)

### Step 01-03: Graph scan reasoning paths
- `app/src/server/observer/llm-synthesis.ts`
- `app/src/server/observer/graph-scan.ts`

### Step 01-04: Trace analyzer reasoning paths
- `app/src/server/observer/trace-response-analyzer.ts`

### Step 02-01: Intent LLM reasoning persistence
- `schema/migrations/0051_intent_llm_reasoning.surql` (new)
- `schema/surreal-schema.surql`
- `app/src/server/intent/authorizer.ts`
- `app/src/server/intent/intent-queries.ts`
- `app/src/server/intent/types.ts`
- `app/src/server/oauth/intent-submission.ts`
- `tests/acceptance/intent-llm-traces/intent-reasoning.test.ts` (new)

### Step 03-01: Reasoning query function and API access control
- `app/src/server/observation/queries.ts`
- `app/src/server/entities/entity-detail-route.ts`
- `app/src/server/intent/intent-routes.ts`
- `tests/acceptance/intent-llm-traces/reasoning-queries.test.ts` (new)

### Step 04-01: View Logic UI reasoning panel
- `app/src/client/components/ui/collapsible.tsx` (new)
- `app/src/client/components/reasoning-panel.tsx` (new)
- `app/src/client/components/entity-detail-panel.tsx`

---

## Completion Stats

| Step | Phase | Status | Commit |
|------|-------|--------|--------|
| 01-01 | Schema + verification | DONE | `6d0b993d` |
| 01-02 | Peer review reasoning | DONE (no-op, already wired by 01-01) | -- |
| 01-03 | Graph scan reasoning | DONE | `dc3248c2` |
| 01-04 | Trace analyzer reasoning | DONE | `4e8455bc` |
| 02-01 | Intent LLM reasoning | DONE | `f595d153` |
| 03-01 | Reasoning queries + API gating | DONE | `0e7174fd` |
| 04-01 | View Logic UI panel | DONE | `767a9712` |

**DELIVER wave commit**: `168d9264` -- squashed PR merge to main

**Total steps**: 7 (6 executed, 1 no-op)
**Acceptance test suites**: 3 (observation-reasoning, intent-reasoning, reasoning-queries)
**Unit tests skipped**: All steps -- acceptance tests covered full DB round-trip; pure wiring changes had no independent unit-testable logic.

---

## Key Decisions

- **Separate reasoning from text**: Observation `text` (conclusion) and `reasoning` (chain-of-thought) are distinct fields. This preserves the human-readable summary while storing the full LLM output.
- **Admin-only API gating**: Reasoning may contain prompt fragments, entity references, and model-specific artifacts. Gated at the API response layer, not the query layer.
- **No model stats on records**: Token counts, cost, and latency remain on the trace table. Reasoning records link to traces via existing graph edges for full telemetry.
- **Named `llm_reasoning` on intent**: Distinguished from the existing human-provided `reasoning` field on intents to avoid ambiguity.
- **Step 01-02 was a no-op**: Peer review reasoning was already wired by the step 01-01 implementation, which handled all `createObservation` call sites in `agent.ts`.

---

## Architecture Impact

- **Schema**: Two new optional string fields across two tables. Fully backward compatible -- existing records load without reasoning.
- **Observer pipeline**: All 6 LLM reasoning paths now thread through to persistence. No new LLM calls added.
- **Intent authorization**: Evaluator schema extended additively. Existing `reason` field unchanged.
- **API layer**: Response-level filtering based on requester role. No new endpoints.
- **UI**: New shared `ReasoningPanel` component, reusable for future reasoning displays.
- **No new dependencies**: All changes use existing SurrealDB, Vercel AI SDK, Zod, React, and Base UI.
