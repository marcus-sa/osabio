# Shared Artifacts Registry: Sandbox Agent Integration

## Artifact Registry

### session_id
- **Source of truth**: SandboxAgent SDK `createSession()` response
- **Consumers**: prompt endpoint, event bridge, session lifecycle, SurrealDB persistence driver, trace graph, SSE registry, session restoration
- **Owner**: orchestrator/spawn-agent.ts
- **Integration risk**: HIGH -- session ID mismatch between SandboxAgent runtime and SurrealDB persistence causes orphaned events and failed restoration
- **Validation**: After spawn, verify session ID in SurrealDB matches SDK response. After restoration, verify rebinding preserves logical session ID.

### agent_token
- **Source of truth**: DPoP token minted by orchestrator during session spawn
- **Consumers**: MCP endpoint `X-Brain-Auth` header, proxy `X-Brain-Auth` header
- **Owner**: orchestrator/spawn-agent.ts
- **Integration risk**: HIGH -- token mismatch between MCP config and proxy config means tool calls authenticate but LLM requests fail (or vice versa)
- **Validation**: Both `setMcpConfig` headers and `ANTHROPIC_BASE_URL` env use the same token value

### effective_toolset
- **Source of truth**: Grant resolution logic (`can_use` union `possesses->skill_requires`)
- **Consumers**: dynamic MCP endpoint `tools/list` filter, governance feed display
- **Owner**: orchestrator/spawn-agent.ts (resolution) + MCP endpoint (serving)
- **Integration risk**: HIGH -- stale toolset means agent sees tools it should not or misses tools it should have
- **Validation**: `tools/list` response contains exactly the resolved grant set. No tools from non-granted upstream servers appear.

### brain_proxy_url
- **Source of truth**: Server config (`runtime/config.ts`, derived from `PORT` and host settings)
- **Consumers**: workspace settings display, agent env `ANTHROPIC_BASE_URL`, session config
- **Owner**: runtime/config.ts
- **Integration risk**: MEDIUM -- URL mismatch means LLM requests fail silently (agent gets direct Anthropic responses without spend tracking)
- **Validation**: Agent's first LLM request appears in proxy spend tracking logs

### brain_mcp_base_url
- **Source of truth**: Server config (`runtime/config.ts`)
- **Consumers**: `setMcpConfig` remote URL construction, dynamic MCP endpoint registration
- **Owner**: runtime/config.ts
- **Integration risk**: MEDIUM -- URL mismatch means tool calls go to wrong endpoint or fail
- **Validation**: `setMcpConfig` URL resolves to a registered MCP endpoint that responds to `tools/list`

### mcp_endpoint_url
- **Source of truth**: Constructed from `brain_mcp_base_url` + agent name during spawn
- **Consumers**: `setMcpConfig` remote URL, governance feed display, trace graph
- **Owner**: orchestrator/spawn-agent.ts
- **Integration risk**: HIGH -- endpoint URL in MCP config must exactly match registered endpoint path
- **Validation**: Coding agent successfully calls `tools/list` and receives filtered tool set

### sandbox_provider
- **Source of truth**: Workspace settings in SurrealDB (`workspace` record)
- **Consumers**: orchestrator spawn logic (provider selection), worktree manager (local only)
- **Owner**: workspace settings UI
- **Integration risk**: MEDIUM -- invalid provider value causes spawn failure
- **Validation**: Enum validation on write (local | docker | e2b | daytona)

### default_agent_type
- **Source of truth**: Workspace settings in SurrealDB (`workspace` record)
- **Consumers**: orchestrator session creation (agent type parameter)
- **Owner**: workspace settings UI
- **Integration risk**: LOW -- invalid agent type returns clear error from SandboxAgent
- **Validation**: Enum validation on write matching SandboxAgent supported agents

### session_summary
- **Source of truth**: Computed from trace graph events at session conclusion
- **Consumers**: chat UI, governance feed, agent_session record
- **Owner**: orchestrator/session-lifecycle.ts
- **Integration risk**: LOW -- summary is derived, not authoritative
- **Validation**: Summary counts match actual event counts in trace graph

### event_stream
- **Source of truth**: SandboxAgent session event stream
- **Consumers**: event bridge, SSE registry, trace graph, governance feed UI, SurrealDB persistence driver
- **Owner**: event-bridge.ts
- **Integration risk**: HIGH -- event format mismatch between SandboxAgent schema and Brain's event format causes broken feed or lost events
- **Validation**: Event bridge integration test: send known SandboxAgent event, verify Brain event format matches expected schema

### replay_events
- **Source of truth**: SurrealDB session persistence driver (events table)
- **Consumers**: SandboxAgent session restoration, restored session context
- **Owner**: SurrealDB persistence driver
- **Integration risk**: HIGH -- corrupted or incomplete replay events produce incorrect agent state after restoration
- **Validation**: After restoration, agent can answer questions about previous context accurately
