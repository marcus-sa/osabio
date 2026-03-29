# Definition of Ready Checklist: Claude Agent SDK Migration

## 1. User story is clearly written with acceptance criteria

- [x] 7 user stories in job story format, each tracing to a JTBD
- [x] 19 acceptance criteria in Gherkin format
- [x] Each AC is testable and specific
- **Evidence**: `user-stories.md`, `acceptance-criteria.md`

## 2. Dependencies are identified

- [x] `@anthropic-ai/claude-agent-sdk` npm package required
- [x] `ANTHROPIC_API_KEY` environment variable required
- [x] `osabio mcp` CLI command (existing, no changes needed)
- [x] Osabio HTTP API (existing, no changes needed)
- **Evidence**: `requirements.md` Dependencies section

## 3. Scope boundaries are clear

- [x] In-scope: spawn, config, hooks, events, init, tests, ADR
- [x] Out-of-scope: UI, SSE contract, Claude Code integration, session lifecycle
- **Evidence**: `requirements.md` Scope section

## 4. Technical risks are identified

- [x] SDK binary size (~50MB) — accepted, deployment is server-side
- [x] SDK API stability — mitigated by pinning version
- [x] `ANTHROPIC_API_KEY` auth model — different from OpenRouter, accepted
- [x] Hook error handling — fire-and-forget pattern documented
- **Evidence**: `jtbd-four-forces.md` Anxiety sections

## 5. Constraints are documented

- [x] 5 constraints (C1-C5) documented
- [x] Permission bypass requirement documented
- [x] StreamEvent contract preservation documented
- **Evidence**: `requirements.md` Constraints section

## 6. Estimation inputs available

- [x] Files to change identified: spawn-opencode.ts, config-builder.ts, event-bridge.ts, session-lifecycle.ts, init-content.ts, init.ts, tests
- [x] Files to create: spawn-agent.ts (or rewrite), agent-options-builder.ts, new ADR
- [x] Files to delete: spawn-opencode.ts (after rewrite), legacy plugin content

## 7. JTBD analysis complete

- [x] 3 jobs identified with dimensions
- [x] Four Forces mapped for all 3 jobs
- [x] Opportunity scoring completed — J1+J3 highest priority
- **Evidence**: `jtbd-job-stories.md`, `jtbd-four-forces.md`, `jtbd-opportunity-scores.md`

## 8. Journey design complete

- [x] Current vs target journey mapped
- [x] Emotional arc documented
- [x] Shared artifacts registry complete
- [x] Gherkin scenarios cover happy path + error paths + all hooks
- **Evidence**: `journey-agent-spawn-visual.md`, `journey-agent-spawn.feature`, `shared-artifacts-registry.md`

---

**DoR Status: PASSED** — All 8 items validated. Ready for DESIGN wave.
