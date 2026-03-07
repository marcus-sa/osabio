# Definition of Ready Validation: Coding Session Epic

## US-CS-001: Live Agent Output Stream

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | "He finds it frustrating to wait blindly for the agent to finish" -- domain language, specific pain |
| User/persona identified | PASS | Marcus Oliveira, solo founder, assigns 3-5 tasks daily, needs real-time visibility |
| 3+ domain examples | PASS | 3 examples: happy path (pagination streaming), edge (idle transition), error (stall warning) |
| UAT scenarios (3-7) | PASS | 5 scenarios covering token rendering, file changes, status transitions, stall, scrolling |
| AC derived from UAT | PASS | 7 AC items, each traceable to a scenario |
| Right-sized | PASS | 2-3 days effort, 5 scenarios, single demonstrable feature (live output panel) |
| Technical notes | PASS | Identifies existing components (event-bridge, stall-detector, useAgentSession), new component needed |
| Dependencies tracked | PASS | All dependencies exist (spawn eventStream, event bridge, SSE registry) -- nothing blocked |

**DoR Status**: PASSED

---

## US-CS-002: Follow-Up Prompt to Running Agent

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | "His only option is to abort the entire session and lose all progress" -- clear pain |
| User/persona identified | PASS | Marcus Oliveira, watches agent output, needs to course-correct without losing progress |
| 3+ domain examples | PASS | 3 examples: redirect agent, idle prompt, terminal rejection |
| UAT scenarios (3-7) | PASS | 5 scenarios covering send to active, send to idle, disabled for completed/aborted, missing handle |
| AC derived from UAT | PASS | 7 AC items, each traceable to scenarios |
| Right-sized | PASS | 2 days effort, 5 scenarios: endpoint + input component + client wrapper |
| Technical notes | PASS | Endpoint path, request/response shapes, error codes, handle registry, server restart limitation |
| Dependencies tracked | PASS | Depends on US-CS-001 (output visibility), sendPrompt handle (exists), handleRegistry (exists) |

**DoR Status**: PASSED

---

## US-CS-003: Wire Event Stream into Session Lifecycle

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | "Event bridge exists but nothing connects them" -- infrastructure gap, not user-facing |
| User/persona identified | PASS | Marcus (same persona) -- infrastructure gap prevents him from seeing live activity |
| 3+ domain examples | PASS | 3 examples: events flow, terminal stops iteration, stream error handled |
| UAT scenarios (3-7) | PASS | 4 scenarios covering event flow, stall detector start, terminal stop, error handling |
| AC derived from UAT | PASS | 6 AC items traceable to scenarios |
| Right-sized | PASS | 1-2 days effort, 4 scenarios, focused on wiring in session-lifecycle.ts |
| Technical notes | PASS | Fire-and-forget iteration, background loop, updateLastEventAt dependency |
| Dependencies tracked | PASS | All components exist (event-bridge, stall-detector, SSE registry) -- nothing blocked |

**DoR Status**: PASSED

---

## US-CS-004: Contextual Review with Agent Conversation Log

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear | PASS | "Must mentally reconstruct the agent's reasoning from the diff alone" -- specific pain |
| User/persona identified | PASS | Marcus Oliveira, reviews 3-5 diffs daily, needs reasoning context |
| 3+ domain examples | PASS | 3 examples: course-corrected session, no-prompt session, reject with log context |
| UAT scenarios (3-7) | PASS | 5 scenarios covering log tab, user prompts, no-intervention, reject feedback, file links |
| AC derived from UAT | PASS | 7 AC items traceable to scenarios |
| Right-sized | PASS | 2-3 days effort, 5 scenarios, single demonstrable feature (Agent Log tab on review page) |
| Technical notes | PASS | Identifies persistence decision (server vs client), existing review page/response type |
| Dependencies tracked | PASS | Depends on US-CS-001, US-CS-002, US-CS-003, existing review page (all resolved/existing) |

**DoR Status**: PASSED

---

## Summary

| Story | DoR Status | Blocked By |
|-------|------------|------------|
| US-CS-001: Live Agent Output Stream | PASSED | Nothing |
| US-CS-002: Follow-Up Prompt | PASSED | US-CS-001 (needs output visibility) |
| US-CS-003: Event Stream Wiring | PASSED | Nothing |
| US-CS-004: Contextual Review | PASSED | US-CS-001, US-CS-002, US-CS-003 |

**Implementation Order**: US-CS-003 (wiring) -> US-CS-001 (output) -> US-CS-002 (prompts) -> US-CS-004 (review)

US-CS-003 is the enabling technical task. US-CS-001 and US-CS-002 are the core user stories delivering the interactive session experience. US-CS-004 enhances the existing review flow with session context.

All 4 stories pass DoR and are ready for DESIGN wave handoff.
