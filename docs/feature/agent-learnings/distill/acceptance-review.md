# Agent Learnings: Acceptance Test Review

## Review ID: accept_rev_20260313

## Reviewer: acceptance-designer (self-review)

## Strengths

- Walking skeletons express user goals ("creates a learning rule and it becomes available to agents") not technical flows
- All 6 user stories have dedicated scenario coverage with no gaps
- Error + boundary scenarios at 55% of total (exceeds 40% target)
- Tests use business language exclusively in scenario descriptions -- no HTTP verbs, status codes, or technical jargon in test names
- Agent-type filtering tested bidirectionally (appears for target agent, excluded for non-target agent)
- Rate limiting, workspace isolation, and supersession all have dedicated boundary scenarios
- Test kit follows established project pattern (observer-test-kit, orchestrator-test-kit)
- All milestone tests use `it.skip()` for one-at-a-time implementation

## Issues Identified

### Happy Path Bias: PASS
- 25 happy path (46%), 12 error (22%), 18 boundary (33%)
- Combined error + boundary = 55%, well above 40% threshold
- Every user story has at least one error scenario

### GWT Format: PASS
- All scenarios follow Given-When-Then structure in comments
- Single When action per scenario
- No conjunction steps

### Business Language Purity: PASS
- Scenario titles use domain language: "learning", "constraint", "approve", "dismiss"
- No technical terms: no "POST", "201", "JSON", "RecordId" in test names
- Technical details are confined to the test-kit helper layer

### Coverage Completeness: PASS
- US-AL-005 (Schema): 11 scenarios covering fields, types, assertions, indexes, isolation
- US-AL-001 (Human creates): 6 scenarios covering create, validation errors, immediate activation
- US-AL-003 (JIT injection): 17 scenarios covering sort, budget, filtering, prompt injection, empty cases
- US-AL-004 (Governance feed): 14 scenarios covering CRUD, approve/dismiss/deactivate, invalid transitions, feed
- US-AL-002 (Agent suggests): 7 scenarios covering rate limits, re-suggestion prevention, cross-agent coaching
- US-AL-006 (Collision): 9 scenarios covering duplicates, policy block, decision info, fail-open, thresholds

### Walking Skeleton User-Centricity: PASS
- Skeleton 1: "Human creates a learning rule and it becomes available to agents" -- user goal, not technical flow
- Skeleton 2: "Learning targeted to coding agents is not loaded for the chat agent" -- observable outcome, not layer connectivity

### Priority Validation: PASS
- Walking skeletons address the fundamental value proposition (creating and receiving learnings)
- Milestones ordered by dependency chain (schema -> loader -> injection -> HTTP -> detection -> collision)
- Error scenarios focus on real failure modes (invalid types, state transition violations, workspace isolation)

## Mandate Compliance Evidence

### CM-A: Hexagonal Boundary Enforcement
- Walking skeletons and M4 tests invoke through HTTP endpoints (driving ports)
- M1, M2, M5, M6 tests use SurrealDB queries (driven port verification)
- No imports of internal validators, formatters, or domain services in test files
- Test-kit helpers abstract all technical details behind business-language functions

### CM-B: Business Language Purity
- Test file names: "walking-skeleton", "schema-and-queries", "jit-loader-and-formatter", "prompt-injection", "http-and-feed", "pattern-detection", "collision-detection"
- Zero instances of: "POST", "GET", "201", "404", "JSON", "REST", "API endpoint" in scenario titles
- Technical terms confined to test-kit layer and assertion details

### CM-C: Walking Skeleton + Focused Scenario Counts
- Walking skeletons: 2 (both enabled)
- Focused scenarios: 53 (all skipped, unskipped one-at-a-time)
- Total: 55 scenarios across 7 test files

## Approval Status: APPROVED

All 6 critique dimensions pass. Test suite is ready for handoff to software crafter.
