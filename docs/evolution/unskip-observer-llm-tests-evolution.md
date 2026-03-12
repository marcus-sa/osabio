# Evolution: Unskip Observer LLM Reasoning Tests

## Summary

Enabled 23 previously-skipped acceptance tests across 4 milestones for the observer agent's LLM reasoning pipeline. All 25 tests (including 2 walking skeleton) now pass with real LLM calls.

## Timeline

- **2026-03-12**: All 4 steps completed in single session

## Steps Executed

| Step | Milestone | Tests Enabled | Fixes Required |
|------|-----------|--------------|----------------|
| 01-01 | Schema & Config | 5 | None — tests passed immediately |
| 02-01 | Semantic Verification | 7 | Observer model wiring in acceptance-test-kit, agent LLM path |
| 03-01 | Decision & Synthesis | 6 | Stale date threshold in anomaly test fixture |
| 04-01 | Peer Review | 5 | None — tests passed immediately |

## Key Fixes

### Step 02-01: LLM Model Wiring
- `acceptance-test-kit.ts`: Server boot now passes `observerModel` from config to dependencies
- `agent.ts`: Fixed LLM reasoning path to correctly receive and use the observer model
- `llm-reasoning.ts`: Fixed context assembly for LLM verification prompts
- `start-server.ts`: Ensured observer model wiring in server startup

### Step 03-01: Test Fixture Date
- `milestone-3-decision-and-synthesis.test.ts`: Tasks in the "scan with anomalies" test needed `updated_at` set to 20 days ago (matching the 14-day stale threshold), not `time::now()`

## Test Coverage

| Suite | Tests | LLM Required |
|-------|-------|-------------|
| Walking Skeleton | 2 | Yes |
| Milestone 1: Schema | 5 | No |
| Milestone 2: Semantic Verification | 7 | Yes |
| Milestone 3: Decision & Synthesis | 6 | Yes |
| Milestone 4: Peer Review | 5 | Yes |
| **Total** | **25** | — |

## Artifacts

- Roadmap: `docs/feature/unskip-observer-llm-tests/roadmap.yaml`
- Execution Log: `docs/feature/unskip-observer-llm-tests/execution-log.yaml`
