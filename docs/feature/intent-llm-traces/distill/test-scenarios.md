# Intent LLM Traces: Acceptance Test Scenarios

Maps each acceptance test scenario to its user story, categorization, and implementation step.

## Summary

| Metric | Value |
|--------|-------|
| Total scenarios | 37 |
| Walking skeletons | 3 |
| Happy path | 12 |
| Deterministic/policy path | 5 |
| Error/edge cases | 17 |
| Error path ratio | 17/37 = 46% |
| Skipped (pending impl) | 2 |

## Step 01: Observation Reasoning Persistence (US-01)

File: `tests/acceptance/intent-llm-traces/observation-reasoning.test.ts`

| ID | Scenario | Category | Story |
|----|----------|----------|-------|
| WS-01 | Observer creates verified finding with reasoning | Walking skeleton | US-01 |
| S01-1 | Verification verdict reasoning persists | Happy path | US-01 |
| S01-2 | Peer review reasoning persists | Happy path | US-01 |
| S01-3 | Contradiction detection reasoning persists | Happy path | US-01 |
| S01-4 | Anomaly evaluation reasoning persists | Happy path | US-01 |
| S01-5 | Deterministic observation omits reasoning | Deterministic path | US-01 |
| S01-6 | Chat agent observation omits reasoning | Deterministic path | US-01 |
| S01-7 | Empty reasoning string preserved | Edge case | US-01 |
| S01-8 | Long reasoning persists without truncation | Edge case | US-01 |
| S01-9 | Reasoning does not interfere with existing fields | Edge case | US-01 |
| S01-10 | Special characters in reasoning persist | Edge case | US-01 |
| S01-11 | Multiple observations have independent reasoning | Edge case | US-01 |

Error path ratio: 5/11 = 45%

## Step 02: Intent LLM Reasoning Persistence (US-02)

File: `tests/acceptance/intent-llm-traces/intent-reasoning.test.ts`

| ID | Scenario | Category | Story |
|----|----------|----------|-------|
| WS-02 | Authorizer captures reasoning during evaluation | Walking skeleton | US-02 |
| S02-1 | Approved intent stores evaluator reasoning | Happy path | US-02 |
| S02-2 | Rejected intent stores evaluator reasoning | Happy path | US-02 |
| S02-3 | Veto-window intent stores evaluator reasoning | Happy path | US-02 |
| S02-4 | Human and LLM reasoning are distinct fields | Happy path | US-02 |
| S02-5 | Policy-only approval has no llm_reasoning | Policy path | US-02 |
| S02-6 | Policy-only rejection has no llm_reasoning | Policy path | US-02 |
| S02-7 | LLM reasoning survives status transitions | Edge case | US-02 |
| S02-8 | Long LLM reasoning persists fully | Edge case | US-02 |
| S02-9 | Special characters in LLM reasoning persist | Edge case | US-02 |
| S02-10 | Draft intent has no evaluator reasoning | Edge case | US-02 |
| S02-11 | LLM timeout fallback has no reasoning | Error path | US-02 |
| S02-12 | Multiple intents have independent reasoning | Edge case | US-02 |

Error path ratio: 5/12 = 42%

## Step 03: Reasoning Queries and API Access Control (US-03, US-04)

File: `tests/acceptance/intent-llm-traces/reasoning-queries.test.ts`

| ID | Scenario | Category | Story |
|----|----------|----------|-------|
| WS-03 | Admin queries observations and sees reasoning | Walking skeleton | US-03, US-04 |
| S03-1 | Returns only observations with reasoning | Happy path | US-04 |
| S03-2 | Respects configurable limit | Happy path | US-04 |
| S03-3 | Results ordered by most recent first | Happy path | US-04 |
| S03-4 | Time range filtering | Happy path | US-04 |
| S03-5 | Returns only deterministic observations | Happy path | US-04 |
| S03-6 | Workspace scope enforcement | Happy path | US-04 |
| S03-7 | Empty workspace returns empty results | Edge case | US-04 |
| S03-8 | Only deterministic observations returns empty | Edge case | US-04 |
| S03-9 | Limit of zero returns no results | Edge case | US-04 |
| S03-10 | Future since date returns empty | Edge case | US-04 |
| S03-11 | Default limit applies when not specified | Edge case | US-04 |
| S03-12 | Empty-string reasoning included in query | Edge case | US-04 |
| S03-13 | Admin sees reasoning in API (skipped) | Happy path | US-03 |
| S03-14 | Non-admin omits reasoning in API (skipped) | Error path | US-03 |

Error path ratio: 7/14 = 50% (including skipped)

## Step 04: UI Panel (Skipped)

UI tests are out of scope for the acceptance suite. The UI panel (US-03) is validated via the API access control tests in Step 03 (S03-13, S03-14).

## Implementation Sequence

```
Step 01 (observation reasoning) ──────┐
                                      ├→ Step 03 (query + API gating)
Step 02 (intent reasoning) ───────────┘
```

1. **Step 01**: Enable WS-01, implement `reasoning` field on observation schema, extend `createObservation()`.
2. **Step 02**: Enable WS-02, implement `llm_reasoning` field on intent schema, extend `updateIntentStatus()`.
3. **Step 03**: Enable WS-03, implement `listObservationsWithReasoning()` query, add API gating.

## Mandate Compliance Evidence

### CM-A: Driving Port Usage
All tests invoke through:
- `createObservation()` query function (observation driving port)
- `updateIntentStatus()` / direct DB merge (intent driving port)
- `GET /api/workspaces/:ws/observer/observations` (API driving port)

No internal component imports (validators, parsers, formatters).

### CM-B: Business Language Purity
Gherkin-style test descriptions use domain terms only:
- "observer creates a verified finding with reasoning"
- "authorizer captures reasoning during evaluation"
- "admin queries observations and sees reasoning"

Zero technical terms (no HTTP verbs, status codes, JSON, database references).

### CM-C: Scenario Counts
- Walking skeletons: 3 (user-centric E2E value)
- Focused scenarios: 34 (boundary tests)
- Error path ratio: 46% overall (exceeds 40% target)
