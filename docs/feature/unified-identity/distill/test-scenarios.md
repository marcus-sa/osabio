# Unified Identity: Test Scenario Inventory

## Summary

| Metric | Count |
|--------|-------|
| Total scenarios | 54 |
| Walking skeleton scenarios | 3 |
| Focused scenarios | 51 |
| Happy path scenarios | 32 (59%) |
| Error/edge/boundary scenarios | 22 (41%) |
| Stories covered | 7/7 |

Error/edge/boundary ratio: 41% (exceeds 40% target).

## Scenario Inventory by Story

### Walking Skeleton (walking-skeleton.test.ts) -- 3 scenarios, ACTIVE

| # | Scenario | Category |
|---|----------|----------|
| 1 | Given a workspace with a person, when a human identity hub is created and linked via spoke edge, then traversal from identity reaches the person record | happy |
| 2 | Given a human identity exists, when an agent identity is created with managed_by pointing to the human, then the managed_by chain resolves to a human in one hop | happy |
| 3 | Given both human and agent identities exist in a workspace, when querying all identities for the workspace, then both appear with correct types | happy |

### US-UI-001: Identity Hub Schema (identity-schema.test.ts) -- 10 scenarios

| # | Scenario | Category |
|---|----------|----------|
| 1 | Human identity created with name, type, role, workspace, created_at | happy |
| 2 | Agent identity created with type 'agent' and role 'management' | happy |
| 3 | System identity created with type 'system' | happy |
| 4 | Agent spoke created with managed_by referencing identity | happy |
| 5 | identity_person spoke edge traversal returns person | happy |
| 6 | identity_agent spoke edge traversal returns agent | happy |
| 7 | Invalid type 'bot' rejected by schema | error |
| 8 | Missing required name field rejected | error |
| 9 | Agent spoke without managed_by rejected | error |
| 10 | person.identities field removed from schema | boundary |
| 11 | Identity table has workspace and type+workspace indexes | boundary |

### US-UI-002: Identity Bootstrap (identity-bootstrap.test.ts) -- 6 scenarios

| # | Scenario | Category |
|---|----------|----------|
| 1 | Workspace creation creates owner identity with human type and spoke edge | happy |
| 2 | Bootstrap registers template agent identities for management, code_agent, observer | happy |
| 3 | Each agent's managed_by chain resolves to workspace owner human identity | happy |
| 4 | Running bootstrap twice produces no duplicate identities | boundary |
| 5 | Bootstrap handles edge case where person lookup yields no results | error |
| 6 | Person record fields remain unchanged after bootstrap wrapping | boundary |

### US-UI-003: Edge Migration (edge-migration.test.ts) -- 10 scenarios

| # | Scenario | Category |
|---|----------|----------|
| 1 | Task created with identity-type owner | happy |
| 2 | Agent identity can own a task | happy |
| 3 | Decision with split attribution (agent decided_by, human confirmed_by) | happy |
| 4 | Feature created with identity-type owner | happy |
| 5 | Question created with identity-type assigned_to | happy |
| 6 | owns relation edge from identity to task with traversal | happy |
| 7 | member_of relation from identity to workspace with reverse traversal | happy |
| 8 | Schema check: no remaining record<person> in ownership fields | boundary |
| 9 | Task with person record as owner rejected after migration | error |

### US-UI-004: Auth Rewiring (auth-rewiring.test.ts) -- 7 scenarios

| # | Scenario | Category |
|---|----------|----------|
| 1 | Session.identity_id references identity record after sign-up | happy |
| 2 | Identity from session has type 'human' | happy |
| 3 | Account.identity_id references identity record | happy |
| 4 | Schema: person_id removed, identity_id present on session/account | boundary |
| 5 | OAuth tables userId references identity | boundary |
| 6 | Chat message processes successfully using identity-based actor | happy |
| 7 | Session without identity_id fails at schema level | error |

### US-UI-005: Audit Trail (audit-trail.test.ts) -- 7 scenarios

| # | Scenario | Category |
|---|----------|----------|
| 1 | Agent task shows actor 'PM Agent' + accountable human 'Marcus Oliveira' | happy |
| 2 | Human decision shows self as both actor and accountable | happy |
| 3 | Mixed human/agent tasks all have identity type context | happy |
| 4 | Every owned task references identity (no person or null) | boundary |
| 5 | Suggestion converted to task shows agent actor and task outcome | happy |
| 6 | Human identity dual-label query returns empty managed_by without error | edge |

### US-UI-006: Authority Overrides (authority-overrides.test.ts) -- 7 scenarios

| # | Scenario | Category |
|---|----------|----------|
| 1 | Role-based permission from authority_scope for management + create_task | happy |
| 2 | Per-identity override grants 'auto' for confirm_decision (overrides 'blocked' default) | happy |
| 3 | No override: role default 'blocked' used for junior coder | happy |
| 4 | No role and no override: fail-safe blocked | error |
| 5 | Human identity with type 'human' bypasses authority | boundary |
| 6 | authorized_to relation table exists in schema | boundary |
| 7 | Override with invalid permission value rejected | error |

### US-UI-007: Agent Mention Resolution (agent-mention-resolution.test.ts) -- 5 scenarios

| # | Scenario | Category |
|---|----------|----------|
| 1 | Role mention "the PM agent suggested" resolves to PM Agent identity | happy |
| 2 | Name mention "Code Agent finished" resolves to Code Agent identity | happy |
| 3 | Ambiguous mention "an agent" creates no false-positive attribution | error |
| 4 | Non-existent "Design Agent" creates no phantom identity | error |
| 5 | Mixed human and agent mentions in same message both resolve | boundary |

## Implementation Sequence

Tests should be un-skipped one at a time in this order:

1. **walking-skeleton.test.ts** -- Already active. Validates schema exists.
2. **identity-schema.test.ts** -- Schema DDL correctness.
3. **identity-bootstrap.test.ts** -- Bootstrap logic via HTTP driving port.
4. **edge-migration.test.ts** -- Ownership field migration.
5. **auth-rewiring.test.ts** -- Session/account identity_id.
6. **audit-trail.test.ts** -- Dual-label query layer.
7. **authority-overrides.test.ts** -- Authority model extensions.
8. **agent-mention-resolution.test.ts** -- Extraction pipeline extension.

This sequence mirrors the story dependency chain (US-UI-001 through US-UI-007).
