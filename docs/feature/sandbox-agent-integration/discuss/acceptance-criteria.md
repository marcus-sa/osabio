# Acceptance Criteria Summary: Sandbox Agent Integration

## US-01: Spawn Coding Agent via SandboxAgent SDK
- [ ] Sessions created via `sdk.createSession()` instead of Claude Agent SDK `query()`
- [ ] Local provider creates git worktree; Docker/E2B providers skip worktree
- [ ] MCP endpoint and proxy URL configured on every session
- [ ] Session spawns within 5 seconds for local provider
- [ ] Clear error message when SandboxAgent server is unavailable

## US-02: SurrealDB Session Persistence Driver
- [ ] `SessionPersistDriver` interface fully implemented (5 methods)
- [ ] Session records stored in SurrealDB with correct schema
- [ ] Events persisted in chronological order with full payload
- [ ] Handles 50 events/second without backpressure
- [ ] Buffers events during brief SurrealDB outages (< 30 seconds)

## US-03: Event Bridge for SandboxAgent Events
- [ ] SandboxAgent tool_call, file_edit, and permission_request events translated correctly
- [ ] Events appear in SSE stream within 500ms of emission
- [ ] Trace records created for tool calls and file edits
- [ ] Permission requests surface in UI with Approve/Reject controls
- [ ] Unknown event types logged and skipped without crashing

## US-04: Multi-Turn Prompts via session.prompt()
- [ ] POST .../prompt delivers follow-up via session.prompt() (not 409)
- [ ] Agent retains full context from previous prompts
- [ ] Concurrent prompts queued with 202 Accepted
- [ ] Concluded sessions return 404 with helpful message
- [ ] Multi-turn chain works for 3+ prompts

## US-05: Session Restoration from Persisted Events
- [ ] Sessions auto-restore after network timeout without user action
- [ ] Active sessions restored on server restart within 10 seconds
- [ ] Event replay uses persisted events from SurrealDB persistence driver
- [ ] Replay respects configurable limits (default: 50 events / 12,000 chars)
- [ ] User notified of restoration status (success or failure)
- [ ] > 95% restoration success rate for sessions with persisted events

## US-06: Dynamic MCP Endpoint per Agent Session
- [ ] Dynamic MCP endpoint registered per session at `/mcp/agent/<name>`
- [ ] `tools/list` returns only tools from the agent's effective toolset
- [ ] `tools/call` evaluates policy graph before forwarding
- [ ] OAuth credentials injected by credential broker for tool calls
- [ ] Unauthorized tool calls rejected with clear error and trace record
- [ ] Endpoint configured via `setMcpConfig()` with agent token auth

## US-07: Permission Request Handling
- [ ] Permission requests surface in coding session UI within 500ms
- [ ] Users can Approve Once, Approve Always, or Reject
- [ ] In-scope permissions auto-approved without user interruption
- [ ] Permission decisions recorded in trace graph
- [ ] 60-second timeout with auto-reject for unresponsive users
