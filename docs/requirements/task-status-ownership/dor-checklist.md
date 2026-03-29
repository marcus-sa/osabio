# Definition of Ready Checklist: Task Status Ownership

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | User stories trace to JTBD | Pass | All 6 stories trace to jobs 1-3 in user-stories.md |
| 2 | Acceptance criteria are testable | Pass | All criteria in Gherkin Given-When-Then format |
| 3 | Dependencies identified | Pass | Depends on existing commit-task-refs.ts, Osabio HTTP API, git hook infrastructure |
| 4 | Size estimated | Pass | 4x S, 2x M — fits single iteration |
| 5 | No ambiguous requirements | Pass | Ownership table in requirements.md is explicit per transition |
| 6 | Edge cases covered | Pass | Idempotency, no-refs commits, already-done tasks, crash-before-start |
| 7 | Non-requirements stated | Pass | No migration, no new status values |
| 8 | Shared artifacts identified | Pass | extractReferencedTaskIds (reused), update_task_status MCP tool (reused), Osabio HTTP client (reused) |

## Implementation Order (suggested)

1. **US-1 + US-2** (remove server-side transitions) — unblocks everything, smallest risk
2. **US-3** (osabio commit-check command) — core new functionality
3. **US-4** (post-commit hook wiring) — depends on US-3
4. **US-5 + US-6** (GitHub processor enhancements) — independent of US-3/4

US-1+2 can ship independently. US-3+4 and US-5+6 are two parallel tracks after that.
