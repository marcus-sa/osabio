# Agent Learnings: Acceptance Test Scenarios

## Scenario Inventory

### Walking Skeletons (2)

| ID | Title | Stories | Status |
|----|-------|---------|--------|
| WS-1 | Human creates a learning rule and it becomes available to agents | US-AL-005, US-AL-001, US-AL-003 | Enabled |
| WS-2 | Learning targeted to coding agents is not loaded for the chat agent | US-AL-003 | Enabled |

### Milestone 1: Schema and Queries (10 scenarios)

| ID | Title | Story | Type |
|----|-------|-------|------|
| M1-01 | Learning record stores all required fields with correct types | US-AL-005 | Happy |
| M1-02 | Learning type must be one of constraint, instruction, or precedent | US-AL-005 | Error |
| M1-03 | Learning status must be one of the valid lifecycle states | US-AL-005 | Error |
| M1-04 | Active learnings are listed for a workspace | US-AL-005 | Happy |
| M1-05 | Status transition from active to deactivated records audit trail | US-AL-001 | Happy |
| M1-06 | Pending approval learning is not returned as active | US-AL-005 | Boundary |
| M1-07 | Superseding a learning marks the old one as superseded and creates an edge | US-AL-005 | Happy |
| M1-08 | Evidence edges link a learning to its source entities | US-AL-005 | Happy |
| M1-09 | Learnings from one workspace are not visible in another | US-AL-005 | Boundary |
| M1-10 | Learning source must be human or agent | US-AL-005 | Error |
| M1-11 | Learning priority defaults to medium when not specified | US-AL-005 | Boundary |

### Milestone 2: JIT Loader and Formatter (9 scenarios)

| ID | Title | Story | Type |
|----|-------|-------|------|
| M2-01 | Learnings are sorted with human-created before agent-suggested | US-AL-003 | Happy |
| M2-02 | High priority learnings appear before medium and low | US-AL-003 | Happy |
| M2-03 | Constraints are never dropped even when they exceed the token budget | US-AL-003 | Boundary |
| M2-04 | Instructions fill remaining budget after constraints | US-AL-003 | Happy |
| M2-05 | Learnings with empty target_agents array are loaded for all agent types | US-AL-003 | Happy |
| M2-06 | Learnings with specific target_agents are only loaded for those agents | US-AL-003 | Happy |
| M2-07 | Workspace with no learnings returns empty list | US-AL-003 | Boundary |
| M2-08 | Deactivated learnings are excluded from active loading | US-AL-003 | Error |
| M2-09 | Superseded learnings are excluded from active loading | US-AL-003 | Error |

### Milestone 3: Prompt Injection (6 scenarios)

| ID | Title | Story | Type |
|----|-------|-------|------|
| M3-01 | MCP context packet includes active learnings for the workspace | US-AL-003 | Happy |
| M3-02 | MCP context packet omits learnings when workspace has none | US-AL-003 | Boundary |
| M3-03 | Learnings targeted to coding agents are excluded from MCP context for chat agent | US-AL-003 | Happy |
| M3-04 | Observer agent context excludes precedent learnings | US-AL-003 | Boundary |
| M3-05 | Deactivated learnings are not injected into any agent prompt | US-AL-003 | Error |
| M3-06 | Pending approval learnings are not injected into agent prompts | US-AL-003 | Error |

### Milestone 4: HTTP Endpoints and Feed (13 scenarios)

| ID | Title | Story | Type |
|----|-------|-------|------|
| M4-01 | Human creates a constraint learning via HTTP and it is immediately active | US-AL-001 | Happy |
| M4-02 | Human creates an instruction learning with specific target agents | US-AL-001 | Happy |
| M4-03 | Creating a learning without required text field is rejected | US-AL-001 | Error |
| M4-04 | Creating a learning with invalid learning_type is rejected | US-AL-001 | Error |
| M4-05 | List learnings filtered by status returns only matching records | US-AL-004 | Happy |
| M4-06 | List learnings filtered by type returns only matching records | US-AL-004 | Happy |
| M4-07 | Approving a pending learning transitions it to active with audit trail | US-AL-004 | Happy |
| M4-08 | Dismissing a pending learning records the reason | US-AL-004 | Happy |
| M4-09 | Deactivating an active learning records audit trail | US-AL-004 | Happy |
| M4-10 | Approving an already-active learning is rejected | US-AL-004 | Error |
| M4-11 | Dismissing an active learning is rejected | US-AL-004 | Error |
| M4-12 | Action on non-existent learning returns not found | US-AL-004 | Error |
| M4-13 | Pending learnings appear in the governance feed | US-AL-004 | Happy |
| M4-14 | Editing and approving a pending learning saves modified text as active | US-AL-004 | Happy |

### Milestone 5: Pattern Detection (7 scenarios)

| ID | Title | Story | Type |
|----|-------|-------|------|
| M5-01 | Agent is rate-limited to 5 suggestions per workspace per week | US-AL-002 | Boundary |
| M5-02 | Different agents have independent rate limits | US-AL-002 | Happy |
| M5-03 | Dismissed learning with high similarity blocks re-suggestion | US-AL-002 | Happy |
| M5-04 | Agent-suggested learning is created with pending_approval status | US-AL-002 | Happy |
| M5-05 | Observer can suggest a learning targeted to coding agents | US-AL-002 | Happy |
| M5-06 | Rate limit count excludes suggestions older than 7 days | US-AL-002 | Boundary |
| M5-07 | Suggestions from different workspaces do not affect rate limit | US-AL-002 | Boundary |

### Milestone 6: Collision Detection (11 scenarios)

**IMPORTANT**: These tests call a real LLM for intent classification and a real embedding model for vector similarity — same approach as observer-llm-reasoning tests.

| ID | Title | Story | Type |
|----|-------|-------|------|
| M6-01 | Near-duplicate learning detected when texts are semantically identical | US-AL-006 | Happy |
| M6-02 | LLM classifies contradicting learnings in the ambiguous similarity zone | US-AL-006 | Happy |
| M6-03 | LLM classifies reinforcing learnings as non-blocking | US-AL-006 | Happy |
| M6-04 | Unrelated topics below 0.75 similarity produce no collision | US-AL-006 | Boundary |
| M6-05 | Policy collision is a hard block — learning cannot be activated | US-AL-006 | Happy |
| M6-06 | Decision collision is informational — learning reinforces confirmed decision | US-AL-006 | Happy |
| M6-07 | Decision contradiction produces warning but does not block | US-AL-006 | Happy |
| M6-08 | Human-created learning activates even when embedding is unavailable | US-AL-006 | Boundary |
| M6-09 | Agent-suggested learning stays pending when embedding is unavailable | US-AL-006 | Boundary |
| M6-10 | Collision detection respects workspace boundaries | US-AL-006 | Boundary |
| M6-11 | Human learning takes precedence over agent-suggested learning on collision | US-AL-006 | Happy |

## Coverage Summary

| Category | Count | Percentage |
|----------|-------|------------|
| Happy path | 29 | 50% |
| Error path | 12 | 21% |
| Boundary/Edge | 17 | 29% |
| **Total** | **58** | **100%** |
| Property-shaped | 0 | - |

Error + Boundary combined: 50% (exceeds 40% target).

## Story Coverage

| Story | Scenarios | Covered By |
|-------|-----------|------------|
| US-AL-005 | 11 | WS-1, WS-2, M1-01..M1-11 |
| US-AL-001 | 6 | WS-1, M4-01..M4-04 |
| US-AL-003 | 17 | WS-1, WS-2, M2-01..M2-09, M3-01..M3-06 |
| US-AL-004 | 14 | M4-05..M4-14 |
| US-AL-002 | 7 | M5-01..M5-07 |
| US-AL-006 | 11 | M6-01..M6-11 |
