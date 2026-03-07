# Shared Artifacts Registry: Coding Session

## Artifact Registry

### taskId
- **Source of truth**: Entity detail panel props (from URL route param, resolved to RecordId)
- **Consumers**: Assign button onClick, POST /assign body, spawnOpenCode param, /brain-start-task command arg, review page header, task status updates
- **Owner**: Entity detail route
- **Integration risk**: HIGH -- taskId flows through the entire lifecycle; mismatch means wrong task assigned or status updated on wrong record
- **Validation**: RecordId round-trip test (raw -> RecordId -> raw) at HTTP boundary

### workspaceId
- **Source of truth**: URL route parameter / workspace state store
- **Consumers**: All orchestrator API URL paths, worktree creation, agent_session workspace field, SSE stream lookup
- **Owner**: Workspace state store
- **Integration risk**: HIGH -- workspace scopes all operations; wrong workspace = security boundary violation
- **Validation**: Workspace existence check in assignment guard

### repoPath
- **Source of truth**: Workspace record `repo_path` field in SurrealDB
- **Consumers**: Worktree creation cwd, repo path banner in AgentStatusSection, assignment guard validation
- **Owner**: Workspace record
- **Integration risk**: HIGH -- missing or invalid repo path causes worktree creation failure
- **Validation**: Path existence check in assignment guard; inline form for setting

### agentSessionId
- **Source of truth**: `createAgentSession` return value (UUID generated at creation)
- **Consumers**: Handle registry key, SSE stream ID derivation, status/review/accept/reject/abort/prompt endpoint paths, review page URL, EventSource subscription
- **Owner**: Session lifecycle module
- **Integration risk**: HIGH -- session ID is the primary key for all session operations; must be consistent from creation through conclusion
- **Validation**: Session lookup with 404 on miss; never prefixed with table name in API responses

### streamId
- **Source of truth**: `generateStreamId(agentSessionId)` -- derived as `stream-${agentSessionId}`
- **Consumers**: SSE EventSource URL path, event bridge emitEvent target, stall detector
- **Owner**: Session lifecycle module
- **Integration risk**: MEDIUM -- derivation is deterministic; risk is if generation formula changes
- **Validation**: Must match between server-side event emission and client-side EventSource URL

### streamUrl
- **Source of truth**: Derived client-side as `/api/orchestrator/stream/${streamId}`
- **Consumers**: useAgentSession hook, EventSource constructor
- **Owner**: AgentStatusSection component (derives from streamId)
- **Integration risk**: MEDIUM -- URL path must match server route registration
- **Validation**: SSE connection error handler surfaces connection failures

### orchestratorStatus
- **Source of truth**: `agent_session.orchestrator_status` field in SurrealDB
- **Consumers**: Status badge in AgentStatusSection, review link visibility, prompt input enabled/disabled, accept/reject/abort endpoint guards
- **Owner**: Session lifecycle module (updates via merge)
- **Integration risk**: HIGH -- status gates all user actions; stale status = wrong UI state
- **Validation**: Status transitions validated at endpoint level; SSE events update client-side status

### agentTokens (NEW -- not yet implemented)
- **Source of truth**: OpenCode `message.part.updated` events, transformed by event bridge to `agent_token` StreamEvents
- **Consumers**: AgentSessionOutput component (accumulated text), agent log for review page
- **Owner**: Event bridge module
- **Integration risk**: MEDIUM -- tokens are append-only; risk is if events arrive out of order or duplicated
- **Validation**: Token accumulation resets on new prompt; no deduplication needed (SSE is ordered)

### fileChangeNotifications (NEW -- not yet implemented)
- **Source of truth**: OpenCode `file.edited` events, transformed by event bridge to `agent_file_change` StreamEvents
- **Consumers**: Inline notifications in AgentSessionOutput, files changed count in status bar
- **Owner**: Event bridge module
- **Integration risk**: LOW -- count is cumulative; missed event only understates count
- **Validation**: Count displayed in status bar; file names shown in inline notifications

### sendPromptHandle (NEW -- not yet implemented)
- **Source of truth**: `OpenCodeHandle.sendPrompt` function stored in handleRegistry
- **Consumers**: POST /prompt endpoint handler
- **Owner**: Handle registry in session lifecycle module
- **Integration risk**: HIGH -- handle must be present for prompt delivery; missing handle = 404/500
- **Validation**: Handle registry lookup with 404 on miss; 409 if session is terminal

### followUpPromptText (NEW -- not yet implemented)
- **Source of truth**: User input in prompt text field (client-side)
- **Consumers**: sendPrompt API call body, user message rendered in agent output, agent log for review
- **Owner**: AgentSessionPanel component
- **Integration risk**: LOW -- text flows one direction from user to agent
- **Validation**: Non-empty validation before send; input cleared after successful send

### agentConversationLog (NEW -- not yet implemented)
- **Source of truth**: Accumulated sequence of agent tokens + user prompts during session lifetime
- **Consumers**: Review page Agent Log tab
- **Owner**: TBD -- client-side accumulation or server-side persistence
- **Integration risk**: MEDIUM -- log must survive page refresh during active session for review to show full history
- **Validation**: Log includes all events from session start; user prompts are visually distinct

---

## Integration Validation Checklist

- [ ] Every `${variable}` in UI mockups has a documented source in this registry
- [ ] taskId round-trips correctly through all API calls (raw ID, never table-prefixed)
- [ ] workspaceId is consistent across orchestrator URL paths
- [ ] agentSessionId is consistent from creation through accept/reject/abort
- [ ] streamId derivation matches between server (generateStreamId) and client (streamUrl)
- [ ] orchestratorStatus transitions are enforced: spawning -> active <-> idle -> completed/aborted
- [ ] handleRegistry has sendPrompt for all active sessions; cleaned up on terminal status
- [ ] SSE events use the same streamId registered at spawn time
- [ ] Agent conversation log captures both agent output and user prompts in order

## Open Questions

1. **Agent conversation log persistence**: Should the log be persisted server-side (survives page refresh, available at review) or accumulated client-side only? Server-side persistence adds complexity but enables review of sessions where the user navigated away.

2. **Token accumulation reset**: Should accumulated tokens reset when a new user prompt is sent, or continue as a continuous stream? Current design: continuous stream with user messages interleaved as distinct blocks.
