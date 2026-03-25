# Story Map: Sandbox Agent Integration

## User: Rafael Torres (developer) + Carla Mendes (workspace admin) + Brain Orchestrator (internal)
## Goal: Replace Claude Agent SDK with SandboxAgent SDK for governed, multi-turn, restorable coding agent sessions

## Backbone

| Configure Sandbox | Spawn Session | Prompt Agent | Monitor Activity | Iterate (Multi-Turn) | Restore Session | Conclude Session |
|-------------------|---------------|--------------|------------------|---------------------|-----------------|------------------|
| Select provider | Resolve grants | Deliver prompt | Bridge events to SSE | Deliver follow-up | Auto-detect disconnect | Destroy sandbox |
| Set default agent | Register MCP endpoint | Route LLM through proxy | Display in feed | Preserve context | Replay events from DB | Persist session record |
| Configure provider credentials | Create sandbox session | Stream events | Trace tool calls with policy | Queue during processing | Rebind session ID | Compute summary |
| | Set MCP + proxy config | | Surface permissions | | Notify user | Update agent_session status |
| | Persist session to SurrealDB | | Auto-approve in-scope | | | Preserve worktree |
| | Create worktree (local only) | | | | | |

---

### Walking Skeleton

The thinnest end-to-end slice that connects ALL activities:

1. **Configure**: Local provider (no config change needed -- default)
2. **Spawn**: `sdk.createSession()` with local provider + basic MCP endpoint registration
3. **Prompt**: `session.prompt()` delivers first prompt, LLM routed through proxy
4. **Monitor**: Event bridge translates SandboxAgent events to SSE registry (basic)
5. **Iterate**: `session.prompt()` delivers follow-up to same session
6. **Restore**: SurrealDB persistence driver stores events (restoration reads from it)
7. **Conclude**: `sdk.destroySession()` + session record marked completed in SurrealDB

**Walking skeleton validates**: Can we spawn a coding agent via SandboxAgent, send it prompts (including follow-ups), see events in the feed, and persist the session?

---

### Release 1: Multi-Turn + Persistence (Core Migration)

**Outcome**: Developers can send follow-up prompts to coding agents and sessions survive server restarts.

Tasks included:
- Replace `query()` with `sdk.createSession()` + `session.prompt()` in spawn-agent.ts
- Implement SurrealDB `SessionPersistDriver` (5 methods)
- Adapt event-bridge.ts to SandboxAgent universal event schema
- Adapt session-lifecycle.ts to SandboxAgent session API
- Wire POST .../prompt to `session.prompt()` (eliminate 409)
- Basic session restoration via `sdk.resumeSession()`

---

### Release 2: Dynamic MCP Endpoint + Governance Parity

**Outcome**: Sandbox-executed agents have the same governance guarantees as Brain-native agents.

Tasks included:
- Register dynamic MCP endpoint `/mcp/agent/<name>` per session
- Filter `tools/list` by resolved effective toolset
- Policy evaluation on `tools/call`
- Credential brokerage (OAuth injection) for MCP tool calls
- Permission request mapping (SandboxAgent permissions -> intent authorization)
- Auto-approve permissions within granted scope
- Trace recording for MCP tool calls

---

### Release 3: Agent Portability + Provider Configuration

**Outcome**: Workspace admins can choose sandbox providers and agent types.

Tasks included:
- Workspace settings UI for sandbox provider selection
- Docker provider configuration (image, network, mounts)
- E2B provider configuration (API key, template)
- Agent type selection (claude, codex, opencode)
- Provider-specific worktree handling (local = Brain worktree, Docker/E2B = skip)

---

## Scope Assessment: PASS -- 10 stories estimated, 2 bounded contexts (orchestrator, MCP endpoint), estimated 8-10 days

The feature is right-sized when split into 3 releases. Each release delivers independently verifiable behavior:
- Release 1: Developer can multi-turn prompt and sessions persist (core value)
- Release 2: Tool calls are governed (governance parity)
- Release 3: Admin can configure providers (operational flexibility)
