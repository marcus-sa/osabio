# DESIGN Wave Handoff: Coding Session

## Epic Summary

The coding session feature transforms Brain's task delegation from a "fire-and-forget" model into an interactive supervisory experience. The orchestrator infrastructure (assign, spawn, worktree, review, accept/reject) exists but the interactive layer (live output, follow-up prompts, contextual review) does not.

**Core insight**: All the plumbing exists (event bridge, stall detector, spawn handle with sendPrompt + eventStream) but nothing connects them. The primary engineering work is wiring existing components together, plus building the UI components to render the output and accept user input.

---

## Jobs Served

| Job | Statement | Top Outcome | Score |
|-----|-----------|-------------|-------|
| J1 | Delegate coding work with confidence | Minimize time between assigning and seeing agent begin | 16.5 |
| J2 | Course-correct a working agent | Minimize time to course-correct agent heading wrong | 17.9 |
| J3 | Review and accept with full context | Minimize time to understand why agent made each change | 14.6 |

---

## Story Map (Implementation Order)

```
                    US-CS-003
                 (Event Wiring)
                   [Must Have]
                   1-2 days
                       |
              +--------+--------+
              |                 |
          US-CS-001         US-CS-002
       (Live Output)    (Follow-up Prompt)
        [Must Have]       [Must Have]
         2-3 days          2 days
              |                 |
              +--------+--------+
                       |
                   US-CS-004
              (Contextual Review)
               [Should Have]
                 2-3 days
```

**Total estimated effort**: 7-10 days

---

## Stories for DESIGN Wave

### US-CS-003: Wire Event Stream into Session Lifecycle (Technical Task)
- **Priority**: Must Have -- enables all other stories
- **Effort**: 1-2 days
- **Scope**: `session-lifecycle.ts` -- iterate eventStream, pipe through event bridge, start stall detector
- **Key decision for DESIGN**: Background iteration pattern (async generator loop vs event listener)

### US-CS-001: Live Agent Output Stream
- **Priority**: Must Have -- primary user-facing feature
- **Effort**: 2-3 days
- **Scope**: New `AgentSessionOutput` component, extend `useAgentSession` for token events, auto-scroll behavior
- **Key decisions for DESIGN**: Token accumulation data structure, auto-scroll pause-on-user-scroll behavior, file change notification rendering

### US-CS-002: Follow-Up Prompt to Running Agent
- **Priority**: Must Have -- without this, abort is the only intervention
- **Effort**: 2 days
- **Scope**: New POST `/prompt` endpoint in `routes.ts`, client API wrapper in `orchestrator-api.ts`, prompt input component
- **Key decisions for DESIGN**: Input placement relative to output panel, optimistic rendering of user messages, disabled state UX

### US-CS-004: Contextual Review with Agent Conversation Log
- **Priority**: Should Have -- enhances existing review, not blocking
- **Effort**: 2-3 days
- **Scope**: Agent Log tab on review page, conversation log persistence, tab navigation
- **Key decisions for DESIGN**: Server-side vs client-side log persistence (recommend server-side), log data model, tab component

---

## Artifacts Package

### JTBD & Discovery
- `/docs/ux/coding-session/jtbd-analysis.md` -- 3 jobs, forces analysis, opportunity scoring, 8-step job map

### Journey Design
- `/docs/ux/coding-session/journey-coding-session-visual.md` -- ASCII flow, emotional arc, UI mockups per step
- `/docs/ux/coding-session/journey-coding-session.yaml` -- Structured journey schema with shared artifacts and integration checkpoints
- `/docs/ux/coding-session/journey-coding-session.feature` -- 18 Gherkin scenarios + 2 @property scenarios
- `/docs/ux/coding-session/shared-artifacts-registry.md` -- 13 tracked artifacts with sources, consumers, and risk levels

### Requirements
- `/docs/requirements/coding-session/US-CS-001-live-agent-output-stream.md` -- 5 UAT scenarios, 7 AC
- `/docs/requirements/coding-session/US-CS-002-follow-up-prompt.md` -- 5 UAT scenarios, 7 AC
- `/docs/requirements/coding-session/US-CS-003-event-stream-wiring.md` -- 4 UAT scenarios, 6 AC
- `/docs/requirements/coding-session/US-CS-004-contextual-review.md` -- 5 UAT scenarios, 7 AC
- `/docs/requirements/coding-session/dor-validation.md` -- All 4 stories PASSED
- `/docs/requirements/coding-session/peer-review.yaml` -- Conditionally approved, 0 critical issues

### Existing Codebase (Reference for DESIGN)
- `app/src/server/orchestrator/spawn-opencode.ts` -- Production spawn with sendPrompt + eventStream
- `app/src/server/orchestrator/event-bridge.ts` -- Transforms OpenCode events to Brain StreamEvents
- `app/src/server/orchestrator/stall-detector.ts` -- Monitors for stalled sessions
- `app/src/server/orchestrator/session-lifecycle.ts` -- Session CRUD, handle registry, status management
- `app/src/client/components/graph/AgentStatusSection.tsx` -- Current UI (status badge, assign button, review link)
- `app/src/client/hooks/use-agent-session.ts` -- SSE subscription hook (handles status, file change, stall events)
- `app/src/client/graph/orchestrator-api.ts` -- Client API wrappers (assign, status, review, accept, reject, abort)

---

## Open Decisions for DESIGN Wave

| Decision | Options | Recommendation | Impact |
|----------|---------|----------------|--------|
| Conversation log persistence | Server-side (DB field/table) vs Client-side (session storage) | Server-side -- survives navigation, enables review of unattended sessions | US-CS-004 data model |
| Token accumulation model | String concatenation vs structured token array | Structured array -- enables per-token rendering and log reconstruction | US-CS-001 performance |
| Auto-scroll behavior | Always auto-scroll vs Pause when user scrolls up | Pause on user scroll-up, resume when user scrolls to bottom | US-CS-001 UX |
| Prompt input placement | Below output panel vs Floating bottom bar vs Separate section | Below output panel (inline, matches chat UX patterns) | US-CS-002 layout |
| Background event iteration | Async generator for-await-of vs Event emitter pattern | for-await-of with try/catch -- matches OpenCode SDK pattern | US-CS-003 implementation |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Server restart loses in-memory handles | Medium | High | Document as known limitation. Sessions not resumable after restart. Future: persist handles or reconnection protocol. |
| SSE connection drops during long sessions | Medium | Medium | useAgentSession already handles connection errors. Consider auto-reconnect. |
| Agent conversation log grows very large | Low | Medium | Cap log size at N tokens. Truncate older entries in UI. |
| OpenCode event format changes | Low | High | Event bridge transforms provide a stable interface. Version the transform layer. |
