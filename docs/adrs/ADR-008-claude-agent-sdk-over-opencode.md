# ADR-008: Claude Agent SDK Over OpenCode SDK

## Status

Accepted 2026-03-08

Supersedes: ADR-001, ADR-003

## Context

The Brain orchestrator spawns autonomous coding agents to work on tasks from the knowledge graph. The current implementation uses `@opencode-ai/sdk` which requires:

1. Spawning an OpenCode server process (`child_process.spawn`)
2. Allocating a free network port and waiting for the server to start
3. Parsing stdout for readiness signals
4. Creating a client, session, and subscribing to a proprietary SSE event stream
5. Translating OpenCode-specific event types to Brain's StreamEvent contract

This multi-step process introduces failure modes at each stage: port allocation races, startup timeouts, stdout parsing fragility, and process orphaning on crashes.

Additionally, OpenCode's plugin system provides only 3 of 6 desired lifecycle hooks (SessionStart, PreToolUse, SessionEnd). The remaining 3 (UserPromptSubmit, Stop, PreCompact) require workarounds via Claude Code's hook system in `.claude/settings.json`, creating a split integration path.

Anthropic has released the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) which provides a single `query()` function returning a typed `AsyncIterable<Message>` with native MCP server support and all 6 lifecycle hooks as TypeScript callbacks.

## Decision

Replace `@opencode-ai/sdk` with `@anthropic-ai/claude-agent-sdk`. Use the SDK's `query()` function as the sole agent spawn mechanism. Configure Brain MCP as a stdio transport in the SDK options. Implement all 6 lifecycle hooks as TypeScript callbacks.

## Rationale

### Hook Parity Comparison

| Hook | OpenCode Plugin | Claude Code Hooks | Agent SDK |
|------|----------------|-------------------|-----------|
| SessionStart | `session.created` | `SessionStart` command | `onSessionStart` callback |
| PreToolUse | `tool.execute.before` | `PreToolUse` command | `onPreToolUse` callback |
| UserPromptSubmit | Not available | `UserPromptSubmit` command | `onUserPromptSubmit` callback |
| Stop | Not available | `Stop` prompt | `onStop` callback |
| PreCompact | `experimental.session.compacting` | Not available | `onPreCompact` callback |
| SessionEnd | Not available | `SessionEnd` command | `onSessionEnd` callback |
| **Coverage** | **3/6** | **4/6** | **6/6** |

### Spawn Complexity Comparison

| Step | OpenCode SDK | Agent SDK |
|------|-------------|-----------|
| Port allocation | `findFreePort()` via net.createServer | Not needed |
| Process spawn | `child_process.spawn("opencode", ...)` | Not needed (SDK internal) |
| Readiness detection | Parse stdout for "listening on" | Not needed |
| Client creation | `createOpencodeClient({ baseUrl })` | Not needed |
| Session creation | `client.session.create()` | Not needed |
| Event subscription | `client.event.subscribe()` | `query()` returns AsyncIterable |
| MCP configuration | HTTP relay to Brain server | stdio transport (direct) |
| Abort | `client.session.abort()` + `proc.kill()` | `AbortController.abort()` |
| **Total steps** | **8** | **1** (`query()`) |

### MCP Integration Comparison

| Aspect | OpenCode (current) | Agent SDK |
|--------|-------------------|-----------|
| Transport | HTTP (Brain server -> OpenCode server -> tool call -> response) | stdio (SDK spawns `brain mcp` subprocess) |
| Tool definitions | Duplicated in plugin + MCP server | Single source: `cli/mcp-server.ts` |
| Latency | HTTP round-trip per tool call | stdio IPC (lower latency) |
| Process count | OpenCode server + brain mcp (if configured) | brain mcp only |

## Alternatives Considered

### Alternative 1: Keep OpenCode SDK, add missing hooks via workarounds

- **What**: Implement UserPromptSubmit/Stop/PreCompact via event stream interception or external monitoring
- **Expected impact**: 70% -- gets hooks working but fragile
- **Why insufficient**: Hook timing is critical (Stop must execute before session ends). Interception adds latency and failure modes. The root problem (process management complexity) remains. Third-party SDK with uncertain maintenance timeline.

### Alternative 2: Direct Anthropic Messages API + custom agent loop

- **What**: Use `@anthropic-ai/sdk` to call Messages API directly; build tool execution loop, MCP management, context compaction, and abort handling manually
- **Expected impact**: 95% -- full control over everything
- **Why insufficient**: Estimated 2000+ lines of agent infrastructure. Must handle: tool call parsing, MCP server lifecycle, context window management, compaction triggers, multi-turn conversation state, abort propagation. The Agent SDK encapsulates all of this. Solo developer cannot justify maintaining custom agent loop.

### Alternative 3: Vercel AI SDK streamText() with tool loop

- **What**: Use the `ai` package already in dependencies with `streamText()` and tool definitions
- **Expected impact**: 70% -- good streaming, basic tool loop
- **Why insufficient**: No MCP server integration (must wrap tools manually). No lifecycle hooks. No permission system. No context compaction. Not designed for autonomous coding agents. Would need significant scaffolding.

## Consequences

### Positive

- All 6 lifecycle hooks available as typed TypeScript callbacks
- Single `query()` call replaces 8-step spawn sequence
- Brain MCP tools defined in one place (`cli/mcp-server.ts`), no duplication
- Typed `AsyncIterable<Message>` replaces untyped OpenCode SSE events
- AbortController-based cancellation eliminates process orphaning risk
- No port allocation, no stdout parsing, no process management
- First-party Anthropic SDK with long-term maintenance commitment

### Negative

- SDK bundles Claude Code binary (~50MB) -- increases deployment size
- Requires `ANTHROPIC_API_KEY` env var (API key management)
- Claude-only (no model switching) -- acceptable for current use case
- SDK is newer, less battle-tested than OpenCode SDK
- Event translation must be rewritten for SDK message types (one-time cost)

### Neutral

- Session lifecycle (create/abort/accept/reject/review) unchanged
- SSE streaming contract unchanged
- UI components unchanged
- Stall detector, assignment guard, worktree manager unchanged
- Claude Code integration (via MCP + hooks in .claude/settings.json) unchanged

## Migration Impact

| Component | Action | Effort |
|-----------|--------|--------|
| `spawn-opencode.ts` | Delete, replace with `spawn-agent.ts` | Medium |
| `config-builder.ts` | Delete, replace with `agent-options.ts` | Low |
| `event-bridge.ts` | Rewrite transform function | Medium |
| `session-lifecycle.ts` | Type alias updates | Low |
| `routes.ts` | Import path updates | Low |
| `init-content.ts` | Remove OpenCode plugin content | Low |
| `init.ts` | Simplify `setupOpencode()` | Low |
| Tests (7 files) | Rewrite for new types | Medium |
| `package.json` | Swap dependencies | Low |
