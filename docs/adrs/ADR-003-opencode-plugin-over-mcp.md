# ADR-003: OpenCode Native Plugin Over MCP-Only Integration

## Status

Accepted

## Context

The Brain CLI already integrates with Claude Code via an MCP stdio server (`brain mcp`) exposing 30+ tools, plus Claude Code hooks for session lifecycle (SessionStart, PreToolUse, UserPromptSubmit, SessionEnd).

OpenCode supports two integration paths:
1. **MCP servers** -- configure `brain mcp` in `opencode.json` under `mcp:` key. Zero code changes.
2. **Native plugins** -- create `.opencode/plugins/brain.ts` using `@opencode-ai/plugin` with custom tools + hooks.

We need to decide which approach to use for the OpenCode integration.

## Decision

Use **native OpenCode plugin** as the primary integration path, not MCP.

## Rationale

### Why plugin is strictly superior for OpenCode

| Capability | MCP in OpenCode | Native Plugin |
|-----------|----------------|---------------|
| Custom tools (30+ Brain tools) | Yes (via stdio) | Yes (via `tool()` helper) |
| Session lifecycle hooks | No | Yes (`session.created`, `session.idle`) |
| Tool interception | No | Yes (`tool.execute.before`) |
| Compaction context injection | No | Yes (`experimental.session.compacting`) |
| Transport | Separate subprocess + stdio IPC | In-process function calls |
| Startup overhead | Spawns `brain mcp` process | Plugin loaded at init |
| Error handling | MCP error protocol | Native JS exceptions |
| Dependencies | None (reuse existing) | `@opencode-ai/plugin` (types only) |

The lifecycle hooks are the decisive factor. Without them:
- No automatic session tracking (start/end)
- No context injection into compaction prompts
- No pre-tool-use interception for subagent dispatch
- Manual session management burden on the user

### Why keep MCP for Claude Code

Claude Code does not have a plugin system. MCP + hooks in `.claude/settings.json` is the only integration path. The existing `brain mcp` server continues to serve Claude Code unchanged.

### Shared backend, different transports

Both integrations call the same Brain HTTP API (`/api/mcp/:workspaceId/*`) using the same `BrainHttpClient` class. The plugin is a thin adapter layer -- each custom tool maps to one HTTP POST call.

## Alternatives Considered

### Alternative 1: MCP-only (configure `brain mcp` in `opencode.json`)

- **Pro**: Zero new code. Reuse existing MCP server as-is.
- **Con**: No lifecycle hooks. No compaction context. Extra subprocess per agent session. Users must manually start/end sessions.
- **Rejected**: Missing hooks is a dealbreaker for parity with Claude Code integration.

### Alternative 2: Dual integration (MCP + plugin hooks only)

- **Pro**: Tools via MCP (no rewrite), hooks via plugin.
- **Con**: Two integration mechanisms running simultaneously. MCP subprocess + plugin. More complex debugging. Double the failure modes.
- **Rejected**: Unnecessary complexity when plugin can handle both tools and hooks.

### Alternative 3: Publish Brain plugin as npm package

- **Pro**: `opencode.json` references `"plugin": ["brain-opencode-plugin"]`. Clean install.
- **Con**: Requires npm publish pipeline. Version management. Plugin needs local config access (`~/.brain/config.json`). Over-engineering for a single-user product.
- **Rejected for now**: Start with local plugin dropped by `brain init --opencode`. Can extract to npm later if demand warrants.

## Consequences

### Positive
- Full feature parity with Claude Code integration (tools + lifecycle + context injection)
- Better performance (no stdio IPC subprocess)
- Compaction context injection (new capability not available in Claude Code)
- Single integration mechanism per agent runtime (simpler debugging)

### Negative
- Must maintain tool definitions in two places: `cli/mcp-server.ts` (Claude Code) and `.opencode/plugins/brain.ts` (OpenCode)
- Mitigation: Both import the same `BrainHttpClient` and call the same API endpoints. Tool definitions are thin wrappers.
- Future mitigation: Extract shared tool metadata into a common definition that generates both MCP tool handlers and OpenCode plugin tools.

### Neutral
- `@opencode-ai/plugin` is a dev dependency for types only -- minimal supply chain risk
- Plugin API may evolve (OpenCode is actively developed) -- pin version, wrap in adapter if needed
