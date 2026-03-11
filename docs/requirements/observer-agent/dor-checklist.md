# Observer Agent — Definition of Ready Checklist

## DoR Items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | **User value articulated** | PASS | Two jobs defined in `jtbd-job-stories.md`: Reality Verification (trust graph state) and Cross-Agent Peer Review (self-policing agents) |
| 2 | **Acceptance criteria testable** | PASS | All 6 AC groups in `acceptance-criteria.md` use Given-When-Then with concrete, measurable assertions. No subjective criteria. |
| 3 | **Dependencies identified** | PASS | Depends on: existing observation table, observes relation, intent EVENT pattern, authority scopes. All exist. New dependency: GitHub integration for CI status queries (can be stubbed in acceptance tests). |
| 4 | **Scope bounded** | PASS | Learning pipeline explicitly deferred. `pending_verification` status deferred. Workspace integration config UI deferred. v1 scope: EVENT triggers + Observer Agent + schema extensions + scan endpoint. |
| 5 | **Shared artifacts documented** | PASS | All `${variables}` tracked in `shared-artifacts-registry.md` with source, type, and description. Schema extensions listed. |
| 6 | **Stories sized** | PASS | 8 stories: 3S + 3M + 2L. No story exceeds L. |
| 7 | **Edge cases covered** | PASS | Error paths documented: API unreachable, no integration configured, duplicate EVENT delivery, LLM failure. All fail-open, never blocking. |
| 8 | **Traceability complete** | PASS | Every story traces to a job. Every requirement traces to a job. Every AC traces to stories. |

## Architectural Risks

| Risk | Mitigation |
|------|-----------|
| SurrealDB EVENT webhook port hardcoding | Follow existing intent EVENT pattern: `{PORT}` replaced at migration time |
| Observer Agent LLM cost per verification | Use Haiku-class model. For simple CI checks, consider skipping LLM entirely and using deterministic logic. |
| EVENT delivery ordering | Idempotency guard (Story 8) ensures correctness regardless of delivery order |
| Graph scan performance on large workspaces | Scope scan queries with workspace filter and reasonable LIMIT clauses |

## Handoff Readiness

- JTBD: 2 jobs with dimensions and four forces
- Journey: visual + YAML + Gherkin for reality verification flow
- Requirements: 6 requirements with sub-requirements
- Stories: 8 stories with acceptance criteria, sizes, priorities
- Artifacts: shared registry with schema extensions documented
- Deferred items: explicitly listed with rationale

**Ready for DESIGN wave handoff to nw-solution-architect.**
