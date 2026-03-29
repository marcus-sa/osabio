# Four Forces Analysis: Replace OpenCode with Claude Agent SDK

## Job 1: Orchestrator Spawns Coding Agent

### Push (Current Frustration)

- OpenCode requires spawning a separate server process (`opencode serve`), finding a free port, parsing stdout for "listening on" message, then creating an SDK client — fragile multi-step startup
- OpenCode SDK (`@opencode-ai/sdk`) is a third-party dependency with its own API surface, event format, and error modes
- OpenCode plugin system only supports 3 lifecycle hooks (`session.created`, `tool.execute.before`, `experimental.session.compacting`) — missing `UserPromptSubmit`, `Stop`, `SessionEnd`
- Config must be passed via `OPENCODE_CONFIG_CONTENT` env var as JSON — no typed programmatic API
- Event stream format is OpenCode-proprietary, requiring a translation layer (`event-bridge.ts`)

### Pull (Desired Future)

- `query()` returns a typed `AsyncIterable<SDKMessage>` — no server process, no port, no SDK client
- 18 hook events available programmatically as TypeScript callbacks, including all Claude Code equivalents
- MCP servers configured inline via `mcpServers` option — no separate config file needed
- Native permission control via `canUseTool` callback and `permissionMode`
- Subagent definitions via `agents` option with per-agent MCP server scoping
- Session resumption, structured output, and budget controls built-in

### Anxiety (Adoption Concerns)

- Claude Agent SDK bundles a Claude Code executable — adds binary size to deployment
- SDK is relatively new (renamed from "Claude Code SDK") — API stability uncertain
- Requires `ANTHROPIC_API_KEY` — different auth model than OpenRouter routing
- The SDK runs Claude Code under the hood — is it overkill for task dispatch?

### Habit (Current Behavior)

- Team knows the OpenCode spawn pattern (port allocation, server process, SDK client)
- `event-bridge.ts` translates OpenCode events to Osabio StreamEvents — must be rewritten
- `config-builder.ts` builds OpenCode-specific config shape — must be replaced
- Tests mock `SpawnOpenCodeFn` — test interfaces change

---

## Job 2: Developer Initializes Osabio Integration

### Push

- `osabio init` currently generates OpenCode plugin files, `opencode.json`, and `OPENCODE.md` — but the plugin only had 4 tools vs 20+ in MCP server
- OpenCode plugin integration was "half-baked" (user's words) — constant drift between plugin tools and MCP server tools
- Maintaining tool definitions in two places (MCP server + plugin) is a maintenance burden

### Pull

- Agent SDK uses MCP natively — `osabio mcp` works as-is via `mcpServers` config
- No plugin file needed — hooks are programmatic, not file-based
- Single source of truth: the MCP server defines all tools, Agent SDK consumes them
- Init only needs to configure `.mcp.json` (Claude Code) or generate SDK bootstrap (Agent SDK)

### Anxiety

- Removing OpenCode support entirely — what if some users prefer OpenCode?
- Agent SDK is Claude-only — no multi-model support via OpenRouter

### Habit

- `osabio init --opencode` generates plugin files — must be replaced or removed
- `OPENCODE.md` documents plugin tools — replaced by MCP tool discovery

---

## Job 3: Lifecycle Hooks Keep Osabio Synchronized

### Push

- OpenCode plugin only supports 3 hooks; Claude Code has 5+
- Missing `UserPromptSubmit` means no check-for-updates between prompts
- Missing `Stop` means no catch-unlogged-decisions prompt before session ends
- Missing `SessionEnd` means no automatic session summary logging
- Hook logic duplicated: shell commands (`osabio system load-context`) in Claude Code hooks vs inline TypeScript in OpenCode plugin

### Pull

- Agent SDK provides all 18 hook events as typed TypeScript callbacks
- Hooks run in-process — can call Osabio HTTP API directly, no shell subprocess
- `PreCompact` hook (new) can inject osabio context into compaction, preserving knowledge graph state across context window resets
- `SubagentStart`/`SubagentStop` hooks enable tracking nested agent dispatches

### Anxiety

- Hook callback errors could crash the agent session if not properly caught
- Hook timeout behavior — will a slow Osabio API call block the agent?

### Habit

- Claude Code hooks use shell commands (`osabio system pretooluse`) — well-tested pattern
- OpenCode hooks use `spawn("brain", [...])` — similar subprocess pattern
- Both must be replaced with direct HTTP calls in hook callbacks
