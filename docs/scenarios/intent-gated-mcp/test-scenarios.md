# Test Scenarios: Intent-Gated MCP Tool Access

## Scenario Inventory

Total: 24 scenarios (3 walking skeletons + 10 happy path + 11 error/edge)
Error/edge ratio: 46% (11/24) -- exceeds 40% target

### Traceability Matrix

| # | Scenario | Category | User Stories | Release |
|---|----------|----------|-------------|---------|
| WS-1 | Agent discovers tools and calls an ungated tool | Walking skeleton | US-01, US-02 | WS |
| WS-2 | Agent escalates for gated tool and calls after auto-approval | Walking skeleton | US-01, US-02, US-03 | WS |
| WS-3 | Agent yields on pending veto and resumes after human approval | Walking skeleton | US-03, US-04, US-05 | R1 |
| HP-1 | Authorized tool appears as callable in tools/list | Happy path | US-01 | WS |
| HP-2 | Fresh session sees only brain-native and gated tools | Happy path | US-01 | WS |
| HP-3 | Gated tool listing includes escalation instructions | Happy path | US-01 | WS |
| HP-4 | Authorized tool call is forwarded and traced | Happy path | US-02 | WS |
| HP-5 | Newly authorized intent reflected in subsequent tools/list | Happy path | US-01, US-03 | WS |
| HP-6 | Auto-approved intent creates gates edge and returns authorized | Happy path | US-03 | WS |
| HP-7 | Veto-required intent returns pending_veto status | Happy path | US-03 | R1 |
| HP-8 | Human approves pending intent and intent transitions to authorized | Happy path | US-04 | R1 |
| HP-9 | Human vetoes pending intent with reason | Happy path | US-04 | R1 |
| HP-10 | Composite intent authorizes multiple tools in single escalation | Happy path | US-07 | R2 |
| EP-1 | Invalid proxy token returns 401 | Error path | US-01 | WS |
| EP-2 | Gated tool call without intent returns 403 intent_required | Error path | US-02 | WS |
| EP-3 | 403 includes action_spec_template for agent self-escalation | Error path | US-02, US-03 | WS |
| EP-4 | Policy-denied intent returns vetoed with denial reason | Error path | US-03 | WS |
| EP-5 | No gates edge created for denied intent | Error path | US-03 | WS |
| EP-6 | Tool call exceeding numeric constraint returns 403 constraint_violation | Error path | US-06 | R2 |
| EP-7 | Tool call with string constraint mismatch returns 403 constraint_violation | Error path | US-06 | R2 |
| EP-8 | Constraint-violating call not forwarded upstream | Error path | US-06 | R2 |
| EC-1 | Unknown session ID returns 404 | Edge case | US-01 | WS |
| EC-2 | Every tool call produces a trace record (success and failure) | Edge case | US-02 | WS |
| EC-3 | Duplicate intent creation returns existing intent | Edge case | US-08 | R3 |

### Property-Shaped Criteria

| Tag | Criterion | Story |
|-----|-----------|-------|
| @property | tools/list and tools/call always agree on scope (same computation function) | US-01, US-02 |
| @property | Every tools/call (success, error, rejected) produces exactly one trace record | US-02 |
| @property | Denied intents never create a gates edge | US-03 |

## Coverage by User Story

| Story | Scenarios | Coverage |
|-------|-----------|----------|
| US-01 | WS-1, WS-2, HP-1, HP-2, HP-3, HP-5, EP-1, EC-1 | All AC covered |
| US-02 | WS-1, WS-2, HP-4, EP-2, EP-3, EC-2 | All AC covered |
| US-03 | WS-2, WS-3, HP-5, HP-6, HP-7, EP-4, EP-5 | All AC covered |
| US-04 | WS-3, HP-8, HP-9 | All AC covered |
| US-05 | WS-3 | Resume trigger covered in walking skeleton |
| US-06 | EP-6, EP-7, EP-8 | All AC covered |
| US-07 | HP-10 | Composite happy path covered |
| US-08 | EC-3 | Dedup covered; timeout/cache deferred to R3 |
