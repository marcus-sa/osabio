# Walking Skeleton -- MCP Tool Registry (#178)

## Implementation Order

Each phase builds on the previous. Tests are independently runnable per file.

| Phase | File | User Story | Walking Skeleton | Focused | Dependencies |
|-------|------|-----------|-----------------|---------|-------------|
| 1 | `01-tool-schema-and-grants.test.ts` | US-3 | 1 (ENABLED) | 5 | Schema migration 0065 |
| 2 | `02-proxy-tool-injection.test.ts` | US-5 | 1 | 3 | Phase 1 + proxy step 7.5 |
| 3 | `03-brain-native-routing.test.ts` | US-6a | 1 | 2 | Phase 2 + proxy step 8.5 |
| 4 | `04-tool-call-tracing.test.ts` | US-9 | 1 | 3 | Phase 3 + tool-trace-writer |
| 5 | `05-credential-provider.test.ts` | US-1 | 1 | 5 | Phase 1 + encryption adapter |
| 6 | `06-account-connection.test.ts` | US-4 | 1 | 5 | Phase 5 + oauth-flow |
| 7 | `07-credential-brokerage.test.ts` | US-7 | 1 | 8 | Phase 6 + credential-resolver |
| 8 | `08-integration-routing.test.ts` | US-6b | 1 | 5 | Phase 7 + tool-executor (integration path) |
| 9 | `09-tool-governance.test.ts` | US-8 | 1 | 6 | Phase 8 + policy-evaluator extension |
| 10 | `10-account-revocation.test.ts` | US-10 | 1 | 3 | Phase 6 |

**Total: 10 walking skeletons + 45 focused scenarios = 55 scenarios**

## One-at-a-Time Enablement

Phase 1 walking skeleton is enabled (`it()`). All other tests use `it.skip()`.

After each phase implementation:
1. Enable the walking skeleton `it.skip()` -> `it()`
2. Run: `bun test tests/acceptance/tool-registry/0N-*.test.ts`
3. Verify the walking skeleton passes
4. Enable focused scenarios one-by-one
5. Commit, move to next phase

## Component Dependencies per Phase

### Phase 1: Schema Foundation
- `schema/migrations/0065_mcp_tool_registry.surql` (mcp_tool + can_use tables)
- `tool-registry/types.ts`
- `tool-registry/queries.ts`
- `tool-registry/routes.ts` (partial: tool CRUD + grant endpoints)

### Phase 2: Tool Injection
- `proxy/tool-resolver.ts` (can_use query + cache)
- `proxy/tool-injector.ts` (merge tools into request)
- `proxy/anthropic-proxy-route.ts` (step 7.5)

### Phase 3: Brain-Native Routing
- `proxy/tool-router.ts` (classify tool calls)
- `proxy/tool-executor.ts` (brain-native path)
- `proxy/anthropic-proxy-route.ts` (step 8.5)

### Phase 4: Tracing
- `proxy/tool-trace-writer.ts`
- Extends existing trace table (no schema change needed)

### Phase 5: Credential Providers
- `schema/migrations/0065_mcp_tool_registry.surql` (credential_provider table)
- `tool-registry/encryption.ts`
- `tool-registry/provider-queries.ts`
- `tool-registry/routes.ts` (provider endpoints)
- `runtime/config.ts` (toolEncryptionKey)

### Phase 6: Account Connection
- `schema/migrations/0065_mcp_tool_registry.surql` (connected_account table)
- `tool-registry/account-queries.ts`
- `tool-registry/oauth-flow.ts`
- `tool-registry/routes.ts` (account endpoints)

### Phase 7: Credential Brokerage
- `proxy/credential-resolver.ts`
- `tool-registry/encryption.ts` (decrypt)

### Phase 8: Integration Routing
- `proxy/tool-executor.ts` (integration path)
- Response sanitization logic

### Phase 9: Tool Governance
- `schema/migrations/0065_mcp_tool_registry.surql` (governs_tool table)
- Policy evaluator extension for `governs_tool`
- Governance check before credential resolution

### Phase 10: Account Revocation
- `tool-registry/account-queries.ts` (revoke: status + hard-delete credentials)
- `tool-registry/routes.ts` (DELETE account endpoint)

## Proxy Pipeline Context

```
Existing:  1-Parse -> 2-Auth -> 3-Identity -> 4-Session -> 5-Workspace -> 6-Policy -> 7-Context -> 8-Forward -> 9-Trace
Extended:  ... -> 7-Context -> [7.5-ToolInject] -> 8-Forward -> [8.5-ToolIntercept] -> 9-Trace(+tool_call)
```

Phase 2 adds step 7.5 (tool injection before forward).
Phase 3 adds step 8.5 (tool call interception after response).
Phase 4 extends step 9 (trace capture for tool_calls).
Phase 9 adds governance check inside step 8.5 (before credential resolution).

## Mandate Compliance Evidence

### CM-A: Driving Port Usage
All tests invoke through HTTP endpoints (driving ports):
- `POST /api/workspaces/:workspaceId/tools` (tool CRUD)
- `POST /api/workspaces/:workspaceId/tools/:toolId/grants` (can_use edges)
- `POST /api/workspaces/:workspaceId/providers` (provider CRUD)
- `POST /api/workspaces/:workspaceId/accounts/connect/:providerId` (account connection)
- `DELETE /api/workspaces/:workspaceId/accounts/:accountId` (account revocation)
- `POST /proxy/llm/anthropic/v1/messages` (proxy with tool injection + interception)

SurrealDB seed helpers are used for test setup (Given), not for assertions (Then).

### CM-B: Business Language
Zero technical terms in scenario names. All scenarios describe user/admin observable outcomes:
- "Admin grants agent access" (not "INSERT can_use edge")
- "Proxy injects granted tools" (not "step 7.5 appends to tools array")
- "Policy denies tool call" (not "governs_tool WHERE check fails")

### CM-C: Skeleton + Focused Counts
- Walking skeletons: 10 (one per phase)
- Focused scenarios: 45
- Total: 55
- Error/edge/boundary ratio: 44% (target: >= 40%)
