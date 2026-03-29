# Test Scenarios: Agent Management

## Scenario Inventory

### Walking Skeleton (R1) -- `walking-skeleton.test.ts`

| # | Scenario | Story | Type | Status |
|---|----------|-------|------|--------|
| WS-1 | Admin registers external agent and receives one-time proxy token | US-02 | happy | enabled |
| WS-2 | Admin views agent detail and sees configured authority scopes | US-03 | happy | enabled |
| WS-3 | Admin deletes agent and all related records are removed | US-04 | happy | enabled |
| WS-4 | Admin sees all agents in workspace grouped by runtime type | US-01 | happy | enabled |

### External Agent CRUD (R1) -- `external-agent-crud.test.ts`

| # | Scenario | Story | Type | Status |
|---|----------|-------|------|--------|
| EC-1 | Proxy token generated with cryptographic prefix | US-02 | happy | enabled |
| EC-2 | Authority scopes default to "propose" when not specified | US-02 | happy | enabled |
| EC-3 | Creation executes atomically (identity + edges + agent) | US-02 | happy | enabled |
| EC-4 | Duplicate agent name within workspace produces validation error | US-02 | error | enabled |
| EC-5 | Creating a osabio agent via the API is rejected | US-02 | error | enabled |
| EC-6 | Transaction failure leaves no partial records | US-02 | error | enabled |
| EC-7 | Creation without a name is rejected | US-02 | error | enabled |
| EC-8 | Creation without authentication is rejected | cross | error | enabled |
| EC-9 | Empty workspace shows no custom agents | US-01 | edge | enabled |
| EC-10 | Osabio agents listed as read-only | US-01 | happy | enabled |
| EC-11 | Listing agents for nonexistent workspace returns error | US-01 | error | enabled |
| EC-12 | Osabio agent detail is read-only | US-03 | happy | enabled |
| EC-13 | Requesting detail for nonexistent agent returns not found | US-03 | error | enabled |
| EC-14 | Delete with wrong confirmation name is rejected | US-04 | error | enabled |
| EC-15 | Deleting a osabio agent is rejected | US-04 | error | enabled |
| EC-16 | Deletion removes identity and all graph edges atomically | US-04 | happy | enabled |
| EC-17 | Deleting a nonexistent agent returns not found | US-04 | error | enabled |
| EC-18 | Agents in one workspace not visible in another | cross | boundary | enabled |
| EC-19 | Same agent name allowed across different workspaces | US-02, D10 | boundary | enabled |

### Sandbox Creation (R2) -- `sandbox-creation.test.ts`

| # | Scenario | Story | Type | Status |
|---|----------|-------|------|--------|
| SC-1 | Admin creates sandbox agent with coding agents and env vars | US-05 | happy | skipped |
| SC-2 | Sandbox creation blocked when no provider configured | US-05 | error | skipped |
| SC-3 | Cloud provider fields accepted for cloud providers only | US-05 | boundary | skipped |
| SC-4 | Filter tabs show correct count per runtime type | US-06 | happy | skipped |
| SC-5 | Spawning session creates active session record | US-07 | happy | skipped |
| SC-6 | Spawning session for external agent not allowed | US-07 | error | skipped |
| SC-7 | Sessions grouped by status on agent detail | US-08 | happy | skipped |
| SC-8 | Agent detail shows empty state when no sessions | US-08 | edge | skipped |

### Operational Dashboard (R3) -- `operational-dashboard.test.ts`

| # | Scenario | Story | Type | Status |
|---|----------|-------|------|--------|
| OD-1 | Admin updates agent description and authority scopes | US-09 | happy | skipped |
| OD-2 | Admin renames agent and identity name is synced | US-09 | happy | skipped |
| OD-3 | Editing a osabio agent is rejected | US-09 | error | skipped |
| OD-4 | Deleting agent with active sessions aborts them first | US-12 | happy | skipped |
| OD-5 | Historical session records preserved after deletion | US-12 | boundary | skipped |
| OD-6 | Newly created external agent shows "never connected" | US-11 | happy | skipped |
| OD-7 | Resuming idle session changes status to active | US-10 | happy | skipped |
| OD-8 | Sending feedback to idle session delivers message | US-10 | happy | skipped |
| OD-9 | Workspace with no custom agents shows guidance | US-13 | edge | skipped |

## Coverage Summary

| Release | Total | Happy | Error | Edge/Boundary | Error Ratio |
|---------|-------|-------|-------|---------------|-------------|
| R1 (WS + CRUD) | 23 | 10 | 10 | 3 | 43% |
| R2 (Sandbox) | 8 | 4 | 2 | 2 | 25% |
| R3 (Operations) | 9 | 5 | 1 | 3 | 11% |
| **Total** | **40** | **19** | **13** | **8** | **33%** |

R1 exceeds the 40% error ratio target. R2 and R3 error ratios are lower because they are placeholder scenarios; error paths will be expanded when those releases are implemented.

## Story Traceability

| Story | Scenarios | Files |
|-------|-----------|-------|
| US-01 | WS-4, EC-9, EC-10, EC-11 | walking-skeleton, external-agent-crud |
| US-02 | WS-1, EC-1--EC-8, EC-19 | walking-skeleton, external-agent-crud |
| US-03 | WS-2, EC-12, EC-13 | walking-skeleton, external-agent-crud |
| US-04 | WS-3, EC-14--EC-17 | walking-skeleton, external-agent-crud |
| US-05 | SC-1--SC-3 | sandbox-creation |
| US-06 | SC-4 | sandbox-creation |
| US-07 | SC-5, SC-6 | sandbox-creation |
| US-08 | SC-7, SC-8 | sandbox-creation |
| US-09 | OD-1--OD-3 | operational-dashboard |
| US-10 | OD-7, OD-8 | operational-dashboard |
| US-11 | OD-6 | operational-dashboard |
| US-12 | OD-4, OD-5 | operational-dashboard |
| US-13 | OD-9 | operational-dashboard |
