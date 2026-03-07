# Coding Agent Orchestrator -- Component Boundaries

## Component Responsibility Matrix

### Server-Side (app/src/server/orchestrator/)

| Component | Responsibility | Owns | Does NOT Own |
|-----------|---------------|------|-------------|
| **Orchestrator Routes** | HTTP request handling, input validation, response formatting | Route definitions, request parsing | Business logic, process management |
| **Assignment Guard** | Pre-assignment validation: task eligibility, one-agent-per-task, authority check | Validation rules, error messages | Task status transitions, session creation |
| **Session Lifecycle** | OpenCode process spawn/kill, client caching, session creation, AbortController management | Active session registry (in-memory Map), process cleanup | Git operations, event forwarding |
| **Worktree Manager** | Git worktree CRUD, branch management, diff generation | Worktree paths, git CLI commands | Database persistence, process management |
| **Event Bridge** | Subscribe to OpenCode SSE, transform events, forward to Brain SSE, stall detection | Event transformation rules, heartbeat timers | SSE transport (delegated to SseRegistry) |
| **OpenCode Config Builder** | Build config object with MCP URLs, auth tokens, model settings | Config schema mapping | JWT creation (delegated to auth module), MCP route definitions |

### CLI-Side (cli/ + .opencode/plugins/)

| Component | Responsibility | Owns | Does NOT Own |
|-----------|---------------|------|-------------|
| **Brain OpenCode Plugin** | Register custom tools + lifecycle hooks for OpenCode | Tool definitions, hook handlers, plugin init | HTTP transport (delegated to CLI HTTP Client), auth flow |
| **CLI HTTP Client** (existing) | Authenticated HTTP calls to Brain API, OAuth token refresh | Token storage, request construction, auto-refresh | Tool definitions, MCP protocol, plugin API |
| **Init Command** (existing, extended) | Generate agent-specific config files and plugin installation | Config file templates, detection of agent runtime | OAuth flow (delegated to existing init), Brain API |

## Dependency Direction

All dependencies point inward. No circular dependencies. Components at the bottom have zero internal dependencies.

### Server-Side

```
Orchestrator Routes
    |-- Assignment Guard
    |       |-- IAM Authority (existing)
    |       |-- SurrealDB queries (existing)
    |-- Session Lifecycle
    |       |-- OpenCode Config Builder
    |       |-- @opencode-ai/sdk
    |       |-- SurrealDB queries (existing: createAgentSession)
    |-- Worktree Manager
    |       |-- (git CLI only, no internal deps)
    |-- Event Bridge
    |       |-- SSE Registry (existing)
```

### CLI-Side

```
Brain OpenCode Plugin (.opencode/plugins/brain.ts)
    |-- CLI HTTP Client (cli/http-client.ts)
    |       |-- Config Manager (cli/config.ts)
    |-- @opencode-ai/plugin (type imports only)

Brain MCP Server (cli/mcp-server.ts)  [existing, unchanged]
    |-- CLI HTTP Client (cli/http-client.ts)

Init Command (cli/commands/init.ts)  [extended]
    |-- Config Manager (cli/config.ts)
    |-- Init Content (cli/commands/init-content.ts)  [extended with OpenCode templates]
```

### Dependency Rules

1. **Routes** depend on all other orchestrator components but nothing depends on Routes
2. **Session Lifecycle** depends on Config Builder (to get config before spawn) and SDK (to spawn/manage)
3. **Event Bridge** depends only on existing SSE Registry for output
4. **Worktree Manager** is a pure infrastructure adapter with no internal dependencies
5. **Assignment Guard** depends only on existing IAM and SurrealDB modules
6. **Config Builder** is a pure function (input: server config + workspace context, output: config object)

## Interface Contracts

### Orchestrator Routes -> Assignment Guard

```
validateAssignment(input: {
  surreal: Surreal
  workspaceId: string
  taskId: string
}) -> Promise<{
  taskRecord: RecordId<"task">
  workspaceRecord: RecordId<"workspace">
  projectRecord?: RecordId<"project">
  taskTitle: string
  taskDescription?: string
}>

Errors:
  - Task not found (404)
  - Task not in assignable status (409)
  - Active agent session already exists for task (409)
  - Authority check failed for code_agent (403)
```

### Orchestrator Routes -> Session Lifecycle

```
createAgentSession(input: {
  worktreePath: string
  branchName: string
  config: OpencodeConfig
  taskRecord: RecordId<"task">
  workspaceRecord: RecordId<"workspace">
  projectRecord?: RecordId<"project">
  taskPrompt: string
  surreal: Surreal
}) -> Promise<{
  agentSessionId: string
  opencodeSessionId: string
  streamId: string
}>

getSessionStatus(agentSessionId: string) -> {
  status: "active" | "idle" | "completed" | "aborted" | "error"
  opencodeSessionId: string
  worktreePath: string
  branchName: string
  startedAt: string
  lastEventAt?: string
}

abortSession(agentSessionId: string) -> Promise<void>
  // Calls AbortController.abort(), triggers server.close()

sendFeedback(agentSessionId: string, message: string) -> Promise<void>
  // Calls client.session.chat() with rejection feedback

cleanupSession(agentSessionId: string) -> Promise<void>
  // Kills process, removes from registry (does NOT touch worktree)
```

### Orchestrator Routes -> Worktree Manager

```
createWorktree(input: {
  repoRoot: string
  taskSlug: string
}) -> Promise<{
  worktreePath: string   // e.g. ".brain/worktrees/agent-{taskSlug}"
  branchName: string     // e.g. "agent/{taskSlug}"
}>

removeWorktree(input: {
  repoRoot: string
  branchName: string
}) -> Promise<void>
  // git worktree remove + git branch -D

mergeWorktree(input: {
  repoRoot: string
  branchName: string
  targetBranch?: string  // default: current branch
}) -> Promise<{ merged: boolean; conflicts?: string[] }>

getDiff(input: {
  repoRoot: string
  branchName: string
  baseBranch?: string    // default: "main"
}) -> Promise<{
  files: Array<{ path: string; status: "added" | "modified" | "deleted"; additions: number; deletions: number }>
  rawDiff: string
  stats: { filesChanged: number; insertions: number; deletions: number }
}>
```

### Orchestrator Routes -> Event Bridge

```
startBridge(input: {
  opencodeClient: OpencodeClient
  opencodeSessionId: string
  streamId: string
  sse: SseRegistry
  onStall?: (sessionId: string) => void
}) -> { stop: () => void }

Event transformation:
  OpenCode EventMessagePartUpdated  ->  Brain {type: "agent_token", ...}
  OpenCode EventFileEdited          ->  Brain {type: "agent_file_change", ...}
  OpenCode session completed        ->  Brain {type: "agent_done", ...}
  OpenCode session error             ->  Brain {type: "agent_error", ...}
  No events for stall threshold     ->  Brain {type: "agent_stall_warning", ...}
```

### Session Lifecycle -> Config Builder

```
buildOpencodeConfig(input: {
  serverConfig: ServerConfig
  workspaceId: string
  brainBaseUrl: string
  authToken: string
}) -> OpencodeConfig
  // Pure function, no side effects
```

### Brain OpenCode Plugin -> CLI HTTP Client

```
Plugin initialization:
  loadConfig(repoRoot) -> BrainConfig
    // Reads ~/.brain/config.json, resolves worktree to main repo root
    // Returns: { server_url, workspace, client_id, access_token, refresh_token, token_expires_at }

  createHttpClient(config) -> BrainHttpClient
    // Existing class from cli/http-client.ts
    // Handles token refresh automatically

Plugin tool execution (each tool wraps one HTTP call):
  httpClient.post(path, body) -> Promise<Response>
    // e.g. POST /api/mcp/:workspaceId/context { intent: "task_context", task_id: "..." }
    // All tools follow this pattern — the plugin is a thin adapter

Plugin lifecycle hooks:
  session.created -> httpClient.post("/sessions/start", { agent: "opencode" })
    // Returns: { session_id }

  session.idle -> httpClient.post("/sessions/end", { session_id, summary, ... })
    // Persists session summary, entity references

  tool.execute.before -> (check tool name, optionally inject context)
    // No HTTP call — local filtering only

  experimental.session.compacting -> httpClient.post("/context", { intent: "workspace_overview" })
    // Fetch entity context, push into output.context[]
```

### Init Command -> Plugin Installation

```
initOpenCode(repoRoot: string, config: BrainConfig) -> void
  // 1. Create .opencode/plugins/ directory
  // 2. Write .opencode/plugins/brain.ts (embedded template from init-content.ts)
  // 3. Write .opencode/package.json with @opencode-ai/plugin dependency
  // 4. Create/update opencode.json with plugin reference (if npm approach used)
  // 5. Write OPENCODE.md instructions file (equivalent to CLAUDE.md block)

  Errors:
    - .opencode/ directory not writable
    - Config missing (run brain init first)
```

---

## Interaction with Existing Components

### ServerDependencies Extension

The orchestrator needs access to an in-memory registry of active sessions. This is analogous to how `SseRegistry` is created in `startServer()` and passed via `ServerDependencies`.

New field on `ServerDependencies`:
```
orchestratorRegistry: OrchestratorRegistry
```

`OrchestratorRegistry` is created in `startServer()` via a factory function, similar to `createSseRegistry()`.

### SSE Event Types Extension

New `StreamEvent` variants for agent orchestrator events:

```
AgentTokenEvent       -- streaming token from agent
AgentFileChangeEvent  -- file edited by agent
AgentStatusEvent      -- agent status change (active/idle/done/error)
AgentStallWarning     -- no activity detected
AgentDoneEvent        -- agent completed task
AgentErrorEvent       -- agent encountered error
```

These are added to the `StreamEvent` union in `shared/contracts.ts`.

### MCP Session Auto-Wiring

When OpenCode starts, it calls the Brain MCP `sessions/start` endpoint. The existing `handleSessionStart` in `mcp-route.ts` creates an `agent_session` record. However, the orchestrator has already created one during assignment.

Resolution: The orchestrator passes the `agent_session` ID to OpenCode via the task prompt or MCP config, so the MCP session start can link to the existing session rather than creating a duplicate. Alternatively, the orchestrator creates the session via `createAgentSession()` before OpenCode starts, and OpenCode's MCP session start becomes a no-op update.

The crafter will determine the exact mechanism during implementation.
