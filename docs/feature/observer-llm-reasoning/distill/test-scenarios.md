# Observer LLM Reasoning: Test Scenario Traceability

Maps user stories and acceptance criteria to acceptance test scenarios with implementation sequence.

## Story Coverage Matrix

| Story | ID | Scenario | File | Status |
|-------|----|----------|------|--------|
| **US-1: Task Contradiction** | WS-1 | LLM detects semantic contradiction on task completion | walking-skeleton.test.ts | `it()` |
| | WS-2 | Observer produces valid observation with no decisions | walking-skeleton.test.ts | `it()` |
| | AC-1.1a | LLM detects mismatch when task contradicts decision | milestone-2 | `it.skip()` |
| | AC-1.1b | LLM creates observes edges to both task and decision | milestone-2 | `it.skip()` |
| | AC-1.2 | LLM confirms match when task aligns with decision | milestone-2 | `it.skip()` |
| | AC-1.4 | Observation source is deterministic_fallback on LLM failure | milestone-2 | `it.skip()` |
| | AC-1.5 | Ambiguous relationship produces info severity (not conflict) | milestone-2 | `it.skip()` |
| | AC-1.6 | Observation created even with non-existent entity refs | milestone-2 | `it.skip()` |
| **US-1 (Skip)** | AC-1.3 | Skip optimization disabled forces LLM invocation | milestone-2 | `it.skip()` |
| **US-2: Decision Verify** | AC-1.7a | Confirmed decision checked against completed tasks | milestone-3 | `it.skip()` |
| | AC-1.7b | No LLM when decision has no completed tasks | milestone-3 | `it.skip()` |
| **US-3a: Synthesis** | AC-2.5 | Empty anomaly list skips LLM | milestone-3 | `it.skip()` |
| | AC-2.1 | Anomalies trigger LLM synthesis | milestone-3 | `it.skip()` |
| | AC-2.3 | Pattern observation has type=pattern | milestone-3 | `it.skip()` |
| **US-3b: Dedup** | AC-2.4 | Running scan twice no duplicate patterns | milestone-3 | `it.skip()` |
| **US-4: Peer Review** | AC-3.1a | LLM evaluates PM observation with evidence | milestone-4 | `it.skip()` |
| | AC-3.1b | Peer review returns structured verdict | milestone-4 | `it.skip()` |
| | AC-3.3 | Original observation not modified after review | milestone-4 | `it.skip()` |
| | CASCADE-1 | Observer's own observations don't trigger review | milestone-4 | `it.skip()` |
| | CASCADE-2 | Observations without edges skip LLM review | milestone-4 | `it.skip()` |
| **US-5: Config** | SCHEMA-1 | confidence field persists | milestone-1 | `it.skip()` |
| | SCHEMA-2 | confidence absent when not provided | milestone-1 | `it.skip()` |
| | SCHEMA-3 | evidence_refs persists records | milestone-1 | `it.skip()` |
| | SETTINGS-1 | observer_skip_deterministic persists false | milestone-1 | `it.skip()` |
| | SETTINGS-2 | observer_skip_deterministic persists true | milestone-1 | `it.skip()` |

## Error Path Ratio

- Total scenarios: 25
- Error/edge/degradation scenarios: 10 (WS-2, AC-1.4, AC-1.5, AC-1.6, AC-1.7b, AC-2.5, CASCADE-1, CASCADE-2, SCHEMA-2, AC-2.4)
- Error path ratio: **40%** (target >= 40%)

## Implementation Sequence

1. **Walking skeleton** (2 scenarios) — prove LLM reasoning E2E works
2. **Milestone 1: Schema + Config** (5 scenarios) — foundation for LLM-specific fields
3. **Milestone 2: Semantic Verification** (7 scenarios) — core LLM contradiction detection
4. **Milestone 3: Decision + Synthesis** (5 scenarios) — decision verification and pattern synthesis
5. **Milestone 4: Peer Review** (5 scenarios) — LLM-powered reasoning quality evaluation

## Driving Ports

All tests invoke through these entry points only:

| Port | Type | Used By |
|------|------|---------|
| `POST /api/observe/:table/:id` | HTTP (EVENT target) | Walking skeleton, M2, M3, M4 |
| `POST /api/observe/scan/:workspaceId` | HTTP (scan trigger) | M3 |
| SurrealDB direct (schema validation) | DB | M1 |
| SurrealDB EVENTs (async triggers) | DB EVENT | All milestones |

No internal components are imported or tested directly.

## Key Differences from Observer-Agent Tests

| Aspect | Observer-Agent Tests | Observer LLM Reasoning Tests |
|--------|---------------------|------------------------------|
| LLM calls | No real LLM calls | Real LLM calls (OBSERVER_MODEL required) |
| Focus | Event wiring, schema, deterministic pipeline | Semantic analysis, confidence, evidence validation |
| Timeouts | 30-60s | 60-120s (LLM latency) |
| Determinism | Highly deterministic | LLM output varies; assertions are structural |
| New fields | verified, source, data | confidence, evidence_refs, settings |
