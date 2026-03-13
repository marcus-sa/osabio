# Definition of Ready Validation: Learning Library

## US-LL-01: Browse & Filter Learning Library

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "He cannot answer the basic question: What rules are my agents following right now?" -- clear pain in domain terms |
| User/persona identified | PASS | "Workspace owner managing four AI agent types" with specific agent list |
| 3+ domain examples with real data | PASS | 3 examples: Marcus filtering by mcp (12 -> 5 learnings), no-results filter, Priya's empty workspace |
| UAT scenarios (3-7) | PASS | 6 scenarios: navigate, browse, filter, expand, empty state, tab switch |
| AC derived from UAT | PASS | 9 AC items derived from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~2-3 days (page route, list component, filter logic, card component, empty states). 6 scenarios. |
| Technical notes | PASS | API endpoints identified, routing pattern, sidebar integration, shared constant gap noted |
| Dependencies tracked | PASS | Existing API (complete), shared contracts (complete), new AGENT_TYPES constant (needed) |

**DoR Status**: PASSED

---

## US-LL-02: Inline Pending Actions in Library

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "User must context-switch to feed to approve/dismiss — library should offer same inline actions" |
| User/persona identified | PASS | "Workspace owner browsing the learning library, encountering pending items" |
| 3+ domain examples with real data | PASS | 3 examples: approve while browsing unfiltered list, dismiss while filtered to pending, collision warning on approve |
| UAT scenarios (3-7) | PASS | 6 scenarios: inline actions visible, approve, approve-with-edit, collision warning, dismiss-with-reason, cancel |
| AC derived from UAT | PASS | 8 AC items covering inline actions, dialogs, optimistic updates |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~1 day (inline action buttons on pending cards + shared dialog components from feed). 6 scenarios. Simplified: no dedicated tab, reuses feed dialogs. |
| Technical notes | PASS | Same API endpoints as feed. Dialog components should be shared/extracted. |
| Dependencies tracked | PASS | US-LL-01 (library list), action API (complete), feed approve/dismiss dialogs (complete — extract as shared) |

**DoR Status**: PASSED

---

## US-LL-03: Edit or Deactivate Active Learning

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "coding agents are being overly rigid about TypeScript strict mode" -- concrete behavioral issue |
| User/persona identified | PASS | Marcus (edit flow), Priya (deactivation flow) -- distinct scenarios |
| 3+ domain examples with real data | PASS | 3 examples: edit text to add nuance, narrow agent targeting, deactivate conflicting learning |
| UAT scenarios (3-7) | PASS | 5 scenarios: open edit dialog, save edit, change agents, deactivate with confirmation, cancel |
| AC derived from UAT | PASS | 10 AC items covering edit and deactivation flows |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~2 days (edit dialog, deactivation dialog, optimistic updates). 5 scenarios. |
| Technical notes | PASS | API gaps clearly flagged: PUT for priority/target_agents, reactivation transition |
| Dependencies tracked | PASS | US-LL-01 (expanded card), backend gaps flagged as potential blockers |

**DoR Status**: PASSED

---

## US-LL-04: Create Learning with Agent Targeting

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "creating a learning requires a POST request with a JSON body to the API" -- clear gap |
| User/persona identified | PASS | Marcus (happy path), Elena (collision), Marcus (validation) |
| 3+ domain examples with real data | PASS | 3 examples: create targeted constraint for mcp, collision on similar text, form validation |
| UAT scenarios (3-7) | PASS | 5 scenarios: open dialog, create with all agents, create with specific agents, collision warning, validation |
| AC derived from UAT | PASS | 10 AC items covering form, validation, collision, and creation flow |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~1-2 days (create dialog, form validation, collision display). 5 scenarios. |
| Technical notes | PASS | Create API endpoint documented, embedding behavior noted, source field noted |
| Dependencies tracked | PASS | US-LL-01 (library page), create API (complete), AGENT_TYPES constant (needed) |

**DoR Status**: PASSED

---

## Summary

| Story | DoR Status | Days Est. | Scenarios | MoSCoW |
|-------|-----------|-----------|-----------|--------|
| US-LL-01: Browse & Filter | PASSED | 2-3 | 6 | Must Have |
| US-LL-02: Inline Pending Actions | PASSED | 1 | 6 | Must Have |
| US-LL-03: Edit/Deactivate | PASSED | 2 | 5 | Must Have |
| US-LL-04: Create Learning | PASSED | 1-2 | 5 | Must Have |

Total: 6-8 days, 22 scenarios, all stories pass DoR.

## Backend Gaps Identified

These are not blockers for DoR but should be resolved before or during implementation:

1. **AGENT_TYPES shared constant** -- agent type list is scattered across server modules. Need a single source for UI filter dropdowns and targeting checkboxes.
2. **Edit priority/target_agents on active learnings** -- current action endpoint only supports status transitions and text updates via approve. A PUT endpoint or expanded action may be needed for editing priority and target_agents fields.
3. **Collision query for approve flow** -- collision detection runs during creation but may need to be queried separately when approving a pending learning.
4. **Reactivation transition** -- `deactivated -> active` is not currently a valid transition. If reactivation is desired, a new transition must be added.

## Recommended Implementation Order

1. US-LL-01 (Browse & Filter) -- foundation for all other stories
2. US-LL-04 (Create Learning) -- simpler dialog, establishes form patterns
3. US-LL-02 (Triage Pending) -- builds on card pattern, adds approve/dismiss dialogs
4. US-LL-03 (Edit/Deactivate) -- most backend gaps, benefit from patterns established in 02/04
