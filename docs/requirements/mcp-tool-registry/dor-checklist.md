# Definition of Ready Checklist — MCP Tool Registry (#178)

## DoR Items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | **User value articulated** | PASS | 4 JTBD job stories with functional/emotional/social dimensions (`jtbd-job-stories.md`) |
| 2 | **Acceptance criteria testable** | PASS | 10 ACs with Gherkin Given/When/Then, all verifiable via acceptance tests (`acceptance-criteria.md`) |
| 3 | **Dependencies identified** | PASS | Skills (#177) identified as dependency for skill-derived tool resolution (phase 5). Walking skeleton is independent. |
| 4 | **Technical feasibility validated** | PASS | Existing proxy pipeline (9-step), DPoP auth, context injection, trace infrastructure confirmed via codebase exploration. No `mcp_tool` schema exists yet — greenfield for tool layer. |
| 5 | **Scope bounded** | PASS | 3 tool categories defined (local/context/integration), Brain only manages context + integration. 11 implementation phases with clear walking skeleton boundary. |
| 6 | **UX journey mapped** | PASS | 3-actor journey (admin/user/proxy) with emotional arcs, error paths, shared artifact registry (`journey-tool-lifecycle-visual.md`, `.yaml`) |
| 7 | **Stories sized and ordered** | PASS | 10 stories sized S-XL, walking skeleton ordered 1-11 (`user-stories.md`) |
| 8 | **No open blockers** | PASS | Walking skeleton has no blockers. Skill-derived resolution (US-5 partial) depends on #177 but is phase 5, not blocking skeleton. |

## Walking Skeleton Validation

The walking skeleton (US-3 -> US-5 -> US-6 -> US-9) validates:
- Schema: `mcp_tool` + `can_use` persisted in SurrealDB
- Tool resolution: identity -> can_use -> mcp_tool query
- Tool injection: proxy adds tools to LLM request
- Tool interception: proxy routes Brain-native tool calls
- Tracing: tool call produces trace record

This proves the vertical slice works before adding OAuth/credentials/governance.

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Tool injection adds latency to every proxy request | Cache tool resolution per identity with 60s TTL |
| Too many tools confuse LLM | Token budget for injected tools (like context injection) |
| OAuth provider API changes break credential flow | Status monitoring on connected_accounts, auto-expire on repeated failures |
| Tool name collisions between runtime and Brain-managed | Namespace Brain tools with toolkit prefix (e.g. `github.create_issue`) |
| Concurrent tool call execution ordering | Proxy handles tool calls sequentially per request, parallel across requests |
