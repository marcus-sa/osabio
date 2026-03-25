# DISTILL Wave Decisions: Intent-Gated MCP Tool Access

## Synthesis Summary

### Test Framework Decision

Bun's built-in test runner (`describe`, `it`, `expect` from `bun:test`) with the project's `acceptance-test-kit.ts` for in-process server boot and isolated SurrealDB namespace. No BDD frameworks. Gherkin scenarios from DISCUSS wave are translated into Bun test format with Given/When/Then comments.

### Test File Organization

Single test file: `tests/acceptance/agent-mcp-governance.test.ts`

Rationale: All scenarios share the same server boot, test fixtures, and MCP endpoint helpers. The CI matrix auto-discovers directories under `tests/acceptance/`, so a single file in the root acceptance directory works. If the file grows past ~800 lines, split into `tests/acceptance/agent-mcp-governance/` directory.

### Driving Port

All tests exercise `POST /mcp/agent/:sessionName` via HTTP fetch. No internal module imports. Auth via `X-Brain-Auth` proxy token header. Test data setup via direct SurrealDB operations using `shared-fixtures.ts` helpers.

### Test Data Strategy

- Workspace + identity: `createWorkspaceDirectly()` (no HTTP auth needed for MCP proxy tests)
- Agent session: direct `CREATE agent_session` in SurrealDB
- Proxy token: `seedProxyToken()` from shared-fixtures, extended with `session` and `intent` fields
- MCP tools: direct `CREATE mcp_tool` records
- can_use grants: direct `RELATE identity->can_use->mcp_tool`
- Intents: `createIntentDirectly()` from shared-fixtures with `authorization_details`
- Gates edges: direct `RELATE intent->gates->agent_session`
- Policies: direct `CREATE policy` records with tool-matching rules

### Upstream MCP Server Mocking

Tests need a mock upstream MCP server to verify forwarding. Two options considered:

1. **MSW (Mock Service Worker)** -- intercepts fetch at network level. Good for HTTP-based MCP transport.
2. **mcpClientFactoryOverride** -- injects a mock `McpClientFactory` via `AcceptanceSuiteOptions`.

Decision: Use `mcpClientFactoryOverride` (option 2). It matches the existing pattern in `tool-registry-ui-test-kit.ts` and avoids MSW complexity for MCP protocol (which may use WebSocket transport).

### Skip/Enable Strategy

All scenarios except WS-1 start with `it.skip`. Implementation proceeds one-at-a-time per the walking-skeleton.md sequence. Each enabled scenario must pass before enabling the next.

### Scope Computation Consistency (@property)

The property that tools/list and tools/call use the same scope function is verified structurally: the test calls tools/list, sees a tool as authorized, then calls tools/call for the same tool and expects success. If scope computation diverges, the test fails.

### Observer Resume Testing

WS-3 (yield-and-resume) does NOT test the observer's graph scan directly. Instead, it tests the observable outcome: after human approval, the session can be resumed and the tool call succeeds. The observer's internal scan mechanism is an implementation detail tested at unit level.

### Mandate Compliance Evidence

- **CM-A**: Test file imports only from `bun:test`, `surrealdb`, `acceptance-test-kit`, and `shared-fixtures`. Zero internal component imports.
- **CM-B**: Test descriptions use business language ("agent discovers tools", "agent escalates for gated tool"). Zero technical jargon in scenario names.
- **CM-C**: 3 walking skeletons + 21 focused scenarios = correct ratio.
