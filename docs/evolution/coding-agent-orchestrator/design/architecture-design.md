# Coding Agent Orchestrator -- Architecture Design

## Executive Summary

The coding agent orchestrator enables Brain to assign tasks to an AI coding agent (OpenCode), monitor its progress via SSE, and present diffs for human review. It extends the existing modular monolith with a new `orchestrator/` domain that manages the OpenCode process lifecycle, git worktree isolation, and event bridging.

The design also includes a **Brain OpenCode Plugin** that ports the existing Brain CLI / Claude Code integration to OpenCode's plugin system. This gives OpenCode agents the same knowledge graph tools and session lifecycle hooks that Claude Code agents already have, enabling Brain to work with both agent runtimes through a shared backend.

The design reuses existing infrastructure: `agent_session` table, SSE registry, MCP route handlers, IAM authority framework, and the CLI HTTP client (`cli/http-client.ts`).

---

## Quality Attribute Priorities

| Rank | Attribute | Strategy |
|------|-----------|----------|
| 1 | Maintainability | Extend existing patterns (factory handlers, `ServerDependencies`). No new frameworks. |
| 2 | Reliability | AbortController-based cleanup. Stall detection via heartbeat timeout. One active agent per task guard. |
| 3 | Operability | All OpenCode events bridged to Brain SSE. Agent activity queryable from `agent_session`. |
| 4 | Security | Authority scoped to `code_agent`. Worktree paths validated. No arbitrary command execution. |
| 5 | Performance | Lazy spawn (<5s). SSE forwarding <1s. No hot path changes to existing chat/extraction. |

---

## C4 System Context (L1)

```mermaid
C4Context
    title System Context -- Coding Agent Orchestrator

    Person(user, "Brain User", "Assigns tasks, reviews diffs, accepts/rejects work")

    System(brain, "Brain App", "AI-native business management platform with knowledge graph, chat, and coding agent orchestration")

    System_Ext(opencode, "OpenCode Server", "AI coding agent runtime spawned as child process per assignment")
    System_Ext(claudecode, "Claude Code", "AI coding agent runtime (alternative to OpenCode)")
    System_Ext(surrealdb, "SurrealDB", "Graph database for entities, sessions, authority")
    System_Ext(openrouter, "OpenRouter", "LLM provider for chat agent, extraction, PM agent")
    System_Ext(git, "Git", "Version control: worktrees for agent isolation, diffs for review")

    Rel(user, brain, "Assigns tasks, monitors agent, reviews diffs", "HTTPS + SSE")
    Rel(brain, opencode, "Creates sessions, sends messages, receives events", "HTTP API + SSE")
    Rel(opencode, brain, "Calls Brain tools via plugin or MCP", "HTTP")
    Rel(claudecode, brain, "Calls Brain tools via MCP server (brain mcp)", "stdio + HTTP")
    Rel(brain, surrealdb, "Reads/writes agent sessions, task status, authority", "HTTP/WS")
    Rel(brain, openrouter, "Chat agent, extraction, PM agent inference", "HTTPS")
    Rel(brain, git, "Creates/removes worktrees, reads diffs", "CLI")
    Rel(opencode, git, "Commits code within worktree", "CLI")
```

---

## C4 Container (L2)

```mermaid
C4Container
    title Container Diagram -- Brain App with Coding Agent Orchestrator

    Person(user, "Brain User")

    Container_Boundary(brain, "Brain App (Bun.serve)") {
        Container(ui, "React SPA", "TypeScript, React", "Task board, chat, agent monitor, diff review UI")
        Container(api, "HTTP API", "Bun, TypeScript", "REST routes for chat, entities, MCP, orchestrator")
        Container(sse, "SSE Registry", "In-process", "Manages SSE streams for chat and agent events")
        Container(orchestrator, "Agent Orchestrator", "TypeScript module", "Manages OpenCode lifecycle, worktrees, event bridging")
        Container(mcp, "MCP Route Handlers", "TypeScript module", "Context, decisions, tasks, sessions for coding agents")
        Container(iam, "IAM Authority", "TypeScript module", "Permission checks per agent type and action")
    }

    Container_Boundary(cli_boundary, "Brain CLI") {
        Container(cli_mcp, "Brain MCP Server", "TypeScript, stdio", "MCP server for Claude Code (brain mcp)")
        Container(cli_plugin, "Brain OpenCode Plugin", "TypeScript, @opencode-ai/plugin", "Plugin with tools + hooks for OpenCode")
        Container(cli_http, "CLI HTTP Client", "TypeScript", "Shared HTTP client for Brain API with OAuth token management")
    }

    ContainerDb(surreal, "SurrealDB", "Graph DB", "Entities, agent_session, authority_scope, worktree state")
    Container_Ext(opencode, "OpenCode Process", "Child process", "AI coding agent with Claude, spawned per assignment")
    Container_Ext(claudecode, "Claude Code", "External process", "AI coding agent (alternative runtime)")
    Container_Ext(git, "Git CLI", "System", "Worktree creation, branch management, diff generation")

    Rel(user, ui, "Interacts with", "HTTPS")
    Rel(ui, api, "Calls", "HTTPS + SSE")
    Rel(api, orchestrator, "Delegates agent operations", "Function call")
    Rel(api, sse, "Registers streams, emits events", "Function call")
    Rel(api, mcp, "Routes MCP requests from agents", "Function call")
    Rel(api, iam, "Checks authority before writes", "Function call")
    Rel(orchestrator, opencode, "Spawns server, creates sessions, subscribes events", "HTTP + SSE")
    Rel(orchestrator, git, "Creates worktrees, reads diffs", "child_process.exec")
    Rel(orchestrator, sse, "Bridges OpenCode events to client SSE", "Function call")
    Rel(orchestrator, surreal, "Persists agent session state, worktree metadata", "Query")
    Rel(opencode, cli_plugin, "Loads plugin at startup", "Plugin API")
    Rel(cli_plugin, cli_http, "Uses for API calls", "Import")
    Rel(cli_plugin, api, "Calls Brain API for context and status", "HTTP")
    Rel(claudecode, cli_mcp, "Calls Brain tools via MCP", "stdio")
    Rel(cli_mcp, cli_http, "Uses for API calls", "Import")
    Rel(cli_http, api, "Authenticated HTTP requests", "HTTP + OAuth")
    Rel(mcp, surreal, "Reads/writes graph entities", "Query")
    Rel(mcp, iam, "Validates code_agent authority", "Function call")
```

---

## C4 Component (L3) -- Agent Orchestrator Subsystem

```mermaid
C4Component
    title Component Diagram -- Agent Orchestrator

    Container_Boundary(orch, "Agent Orchestrator (app/src/server/orchestrator/)") {
        Component(routes, "Orchestrator Routes", "TypeScript", "HTTP handlers: assign, status, abort, review, accept, reject")
        Component(lifecycle, "Session Lifecycle", "TypeScript", "Creates OpenCode server+client, manages AbortController, caches active sessions")
        Component(worktree, "Worktree Manager", "TypeScript", "Creates/removes git worktrees, generates diffs, validates paths")
        Component(bridge, "Event Bridge", "TypeScript", "Subscribes to OpenCode SSE, transforms events, forwards to Brain SSE registry")
        Component(guard, "Assignment Guard", "TypeScript", "Validates task eligibility, enforces one-agent-per-task, checks authority")
        Component(config, "OpenCode Config Builder", "TypeScript", "Builds OPENCODE_CONFIG_CONTENT with MCP server URLs, model config")
    }

    Container_Ext(opencode, "OpenCode Process")
    Container(sse, "SSE Registry")
    ContainerDb(surreal, "SurrealDB")
    Container(iam, "IAM Authority")

    Rel(routes, lifecycle, "Calls create/abort/cleanup")
    Rel(routes, worktree, "Calls create/remove/diff")
    Rel(routes, guard, "Validates before assignment")
    Rel(routes, bridge, "Starts/stops event subscription")
    Rel(lifecycle, config, "Gets OpenCode config")
    Rel(lifecycle, opencode, "Spawns server, creates session")
    Rel(bridge, opencode, "Subscribes to SSE events")
    Rel(bridge, sse, "Emits transformed events")
    Rel(guard, surreal, "Checks active sessions for task")
    Rel(guard, iam, "Checks code_agent authority")
    Rel(worktree, surreal, "Persists worktree metadata on agent_session")
    Rel(lifecycle, surreal, "Creates/updates agent_session records")
```

---

## Data Flow: Task Assignment

```mermaid
sequenceDiagram
    participant U as User (UI)
    participant API as Brain API
    participant G as Assignment Guard
    participant W as Worktree Manager
    participant L as Session Lifecycle
    participant CB as Config Builder
    participant OC as OpenCode Process
    participant DB as SurrealDB
    participant SSE as SSE Registry

    U->>API: POST /api/orchestrator/:workspaceId/assign {taskId}
    API->>G: validateAssignment(taskId, workspaceId)
    G->>DB: Check no active agent_session for task
    G->>DB: Check task status in [todo, ready]
    G-->>API: Eligible

    API->>W: createWorktree(taskSlug)
    W-->>API: {worktreePath, branchName}

    API->>CB: buildOpencodeConfig(workspaceId, mcpBaseUrl)
    CB-->>API: {config}

    API->>L: createSession(worktreePath, config, AbortController)
    L->>OC: createOpencodeServer({config, signal})
    OC-->>L: {url, close}
    L->>OC: client.session.create({directory: worktreePath})
    OC-->>L: {sessionId}

    L->>DB: createAgentSession(agent: "opencode", taskId, workspaceId)
    Note over DB: task status promoted to in_progress

    API->>SSE: registerMessage(streamId)
    API->>L: startEventBridge(opencodeSessionId, streamId)
    L->>OC: client.session.chat({message: taskPrompt})

    API-->>U: {streamId, agentSessionId, streamUrl}
    U->>SSE: GET /api/orchestrator/stream/:streamId (SSE)
```

---

## Data Flow: Agent Monitoring (Event Bridge)

```mermaid
sequenceDiagram
    participant OC as OpenCode Process
    participant EB as Event Bridge
    participant SSE as SSE Registry
    participant UI as User (UI)

    loop OpenCode SSE stream
        OC->>EB: EventMessagePartUpdated (token/tool_call/file_edit)
        EB->>EB: Transform to Brain StreamEvent
        EB->>SSE: emitEvent(streamId, agentEvent)
        SSE->>UI: SSE data frame
    end

    OC->>EB: EventFileEdited
    EB->>SSE: emitEvent(streamId, {type: "agent_file_change", ...})

    Note over EB: Stall detection: no events for N seconds
    EB->>SSE: emitEvent(streamId, {type: "agent_stall_warning"})
```

---

## Data Flow: Review and Accept/Reject

```mermaid
sequenceDiagram
    participant U as User (UI)
    participant API as Brain API
    participant W as Worktree Manager
    participant L as Session Lifecycle
    participant OC as OpenCode Process
    participant DB as SurrealDB

    U->>API: GET /api/orchestrator/:workspaceId/sessions/:sessionId/review
    API->>W: getDiff(branchName)
    W-->>API: {files: FileDiff[], stats}
    API->>DB: SELECT agent_session (summary, files_changed, decisions)
    API-->>U: {diff, sessionSummary, filesChanged}

    alt Accept
        U->>API: POST .../sessions/:sessionId/accept
        API->>L: cleanup(sessionId)
        L->>OC: server.close()
        API->>W: mergeAndRemove(branchName)
        W-->>API: merged
        API->>DB: UPDATE agent_session SET ended_at, status="completed"
        API->>DB: UPDATE task SET status="done"
        API-->>U: {accepted: true}
    else Reject with feedback
        U->>API: POST .../sessions/:sessionId/reject {feedback}
        API->>OC: client.session.chat({message: feedback})
        Note over OC: Agent continues in same worktree
        API-->>U: {rejected: true, continuing: true}
    else Abort
        U->>API: POST .../sessions/:sessionId/abort
        API->>L: abort(sessionId)
        L->>OC: server.close() via AbortController
        API->>W: removeWorktree(branchName)
        API->>DB: UPDATE agent_session SET ended_at, status="aborted"
        API->>DB: UPDATE task SET status="ready"
        API-->>U: {aborted: true}
    end
```

---

## Integration with Existing Infrastructure

### Reused Components

| Component | Location | How Used |
|-----------|----------|----------|
| `agent_session` table | `schema/surreal-schema.surql` | Extended with orchestrator-specific fields |
| `createAgentSession()` | `mcp/mcp-queries.ts` | Called during assignment to create session + promote task status |
| `endAgentSession()` | `mcp/mcp-queries.ts` | Called on accept/abort to finalize session |
| `SSE Registry` | `streaming/sse-registry.ts` | Event bridge emits transformed OpenCode events |
| `IAM Authority` | `iam/authority.ts` | Guard checks `code_agent` permissions before assignment |
| `MCP Route Handlers` | `mcp/mcp-route.ts` | OpenCode agent calls these for context, decisions, task status |
| `ServerDependencies` | `runtime/types.ts` | Extended to include orchestrator registry |
| `withRequestLogging` | `http/request-logging.ts` | Wraps new orchestrator routes |

### New Route Registration

New routes registered in `start-server.ts` under `/api/orchestrator/` prefix:

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/orchestrator/:workspaceId/assign` | Assign task to agent |
| GET | `/api/orchestrator/:workspaceId/sessions` | List active sessions |
| GET | `/api/orchestrator/:workspaceId/sessions/:sessionId` | Session status |
| GET | `/api/orchestrator/:workspaceId/sessions/:sessionId/review` | Get diff + summary |
| GET | `/api/orchestrator/stream/:streamId` | SSE stream for agent events |
| POST | `/api/orchestrator/:workspaceId/sessions/:sessionId/accept` | Accept and merge |
| POST | `/api/orchestrator/:workspaceId/sessions/:sessionId/reject` | Reject with feedback |
| POST | `/api/orchestrator/:workspaceId/sessions/:sessionId/abort` | Abort and cleanup |

### MCP Configuration for OpenCode

The orchestrator builds an OpenCode config that points the agent's MCP tools at the existing Brain MCP endpoints:

- Base URL: `http://127.0.0.1:{PORT}/api/mcp/{workspaceId}/`
- Auth: JWT token scoped to workspace + `code_agent` agent type
- Tools available: all existing MCP tier 1 (read), tier 2 (reason), tier 3 (write) handlers
- The agent calls `sessions/start` on init and `sessions/end` on completion -- these are the existing MCP session lifecycle endpoints

---

## Brain OpenCode Plugin Architecture

The Brain CLI currently integrates with Claude Code via two mechanisms: an MCP stdio server (`brain mcp`) for 30+ tools, and Claude Code hooks for session lifecycle. The OpenCode plugin ports both to OpenCode's native plugin system.

### Integration Strategy: Two Paths, Shared Backend

```
┌─────────────────────────────────────────────────────────────┐
│                    Brain HTTP API                            │
│  /api/mcp/:workspaceId/* (context, decisions, tasks, etc.)  │
└────────────────────┬────────────────────┬───────────────────┘
                     │                    │
        ┌────────────┴──────┐   ┌────────┴──────────────┐
        │  Brain MCP Server │   │  Brain OpenCode Plugin │
        │  (cli/mcp-server) │   │  (.opencode/plugins/)  │
        │                   │   │                        │
        │  stdio transport  │   │  Plugin custom tools   │
        │  30+ MCP tools    │   │  + lifecycle hooks     │
        └────────┬──────────┘   └────────┬──────────────┘
                 │                       │
        ┌────────┴──────────┐   ┌────────┴──────────────┐
        │   Claude Code     │   │      OpenCode          │
        └───────────────────┘   └───────────────────────┘
```

Both paths use the **same HTTP client** (`cli/http-client.ts`) and the **same backend API** (`/api/mcp/:workspaceId/*`). The difference is transport:
- Claude Code: MCP stdio protocol → HTTP
- OpenCode: Plugin custom tools → HTTP

### Plugin Structure

```
.opencode/
├── plugins/
│   └── brain.ts              # Brain plugin (tools + hooks)
├── package.json              # Dependencies: cli/http-client
└── (auto-generated by brain init --opencode)
```

The plugin exports a single `Plugin` function that:
1. Initializes the Brain HTTP client with stored credentials
2. Registers **custom tools** (same 30+ tools as MCP, using `tool()` helper)
3. Registers **lifecycle hooks** (ported from Claude Code hooks)

### Hook Mapping: Claude Code → OpenCode Plugin

| Claude Code Hook | OpenCode Plugin Event | Brain CLI Command | Plugin Behavior |
|-----------------|----------------------|-------------------|-----------------|
| `SessionStart` | `session.created` | `brain system load-context` | Load workspace context, start agent session via API |
| `PreToolUse` (Agent dispatch) | `tool.execute.before` | `brain system pretooluse` | Inject Brain context when subagent tools are dispatched |
| `UserPromptSubmit` | `message.updated` (role=user) | `brain system check-updates` | Check for workspace graph updates since last check |
| `SessionEnd` / `Stop` | `session.idle` | `brain system end-session` | End agent session, log summary via API |
| *(not available)* | `experimental.session.compacting` | *(new)* | Inject Brain entity context into compaction prompt |

### Custom Tool Registration

The plugin registers Brain tools as OpenCode native custom tools using `@opencode-ai/plugin`'s `tool()` helper. Each tool wraps an HTTP call to the Brain API:

```
// Conceptual structure (not implementation code)
plugin tools = {
  brain_get_context:        tool({ ... }) → HTTP POST /api/mcp/:ws/context
  brain_get_project_context: tool({ ... }) → HTTP POST /api/mcp/:ws/project-context
  brain_get_task_context:    tool({ ... }) → HTTP POST /api/mcp/:ws/task-context
  brain_update_task_status:  tool({ ... }) → HTTP POST /api/mcp/:ws/tasks/status
  brain_create_observation:  tool({ ... }) → HTTP POST /api/mcp/:ws/observations
  brain_log_note:            tool({ ... }) → HTTP POST /api/mcp/:ws/notes
  // ... all 30+ tools from cli/mcp-server.ts
}
```

### Plugin vs MCP: Why Not Just MCP?

OpenCode supports MCP natively, so the existing `brain mcp` server could work by adding config to `opencode.json`. However, using native plugin tools provides advantages:

| Aspect | MCP in OpenCode | Native Plugin Tools |
|--------|----------------|-------------------|
| **Transport** | Separate stdio process | In-process function calls |
| **Startup** | Spawns `brain mcp` subprocess | Plugin loaded at init |
| **Lifecycle hooks** | Not available via MCP | `session.created`, `session.idle`, `tool.execute.before`, `session.compacting` |
| **Compaction context** | Not possible | Can inject Brain entities into compaction prompt |
| **Latency** | stdio IPC + HTTP | Direct HTTP (no IPC layer) |
| **Error handling** | MCP error protocol | Native plugin error handling |

The plugin approach is strictly superior for OpenCode because it provides lifecycle hooks that MCP cannot offer, plus compaction context injection.

### Orchestrator Integration

When the orchestrator spawns an OpenCode server for task assignment, it configures the Brain plugin via `OPENCODE_CONFIG_CONTENT`:

```
{
  "plugin": [],                    // No npm plugins needed
  // Plugin loaded from .opencode/plugins/brain.ts in the worktree
}
```

The worktree inherits the project's `.opencode/plugins/brain.ts` file, so the spawned OpenCode automatically loads the Brain plugin. The orchestrator's Config Builder sets the auth token and workspace ID via environment variables that the plugin reads at init.

### `brain init` Changes

The `brain init` command gains OpenCode support:

| Current (`brain init`) | New (`brain init --opencode`) |
|------------------------|-------------------------------|
| Creates `.mcp.json` with Brain MCP server | Creates `opencode.json` with Brain plugin reference |
| Creates `.claude/settings.json` hooks | Drops `.opencode/plugins/brain.ts` plugin file |
| Creates `.claude/commands/` slash commands | Creates `.opencode/commands/` if supported |
| OAuth flow → stores in `~/.brain/config.json` | Same OAuth flow, same credential store |

Auto-detection: `brain init` can detect whether `.claude/` or `.opencode/` exists and configure the appropriate integration. Both can coexist in the same repository.

---

## Walking Skeleton Scope

The walking skeleton (Feature 0) covers the minimum viable path:

1. **Brain OpenCode Plugin**: Plugin with core tools (get_context, get_task_context, update_task_status, create_observation) + session lifecycle hooks (session.created, session.idle)
2. **`brain init --opencode`**: Init command generates `opencode.json` config + drops plugin into `.opencode/plugins/`
3. **Assign route**: POST handler that creates worktree, spawns OpenCode, creates session, sends initial task message
4. **MCP integration**: OpenCode agent uses Brain tools via plugin (or MCP fallback)
5. **Status polling**: GET session status (no SSE bridging yet -- polling only)
6. **Accept/abort**: Accept merges worktree branch, abort removes it

Deferred from walking skeleton:
- SSE event bridging (use polling instead)
- Stall detection
- Reject-with-feedback loop
- UI components (test via curl/API client)
- Multi-session management
- Compaction context injection (experimental hook)
- Full 30+ tool parity in plugin (start with essential subset)

---

## Deployment Architecture

No changes to deployment topology. The orchestrator runs in-process within the existing Bun.serve monolith. OpenCode processes are spawned as child processes on the same host. Git worktrees are created in a `.brain/worktrees/` directory relative to the repository root.

Resource considerations:
- Each active agent consumes one OpenCode child process (~100-200MB RSS)
- Practical limit: 2-3 concurrent agents on a single host
- Worktrees share git objects (disk-efficient)
