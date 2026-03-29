# Technology Stack: Claude Agent SDK Migration

## New Dependencies

### @anthropic-ai/claude-agent-sdk

| Attribute | Value |
|-----------|-------|
| **Purpose** | Agent runtime — single `query()` function for spawning Claude agents |
| **License** | MIT |
| **Repository** | https://github.com/anthropics/claude-agent-sdk-js |
| **Why chosen** | First-party Anthropic SDK; typed AsyncIterable interface; native MCP server support; all 6 lifecycle hooks; eliminates process management |
| **Replaces** | `@opencode-ai/sdk` (third-party, process-based, 3/6 hooks) |

### Alternatives Considered

#### Alternative 1: Continue with @opencode-ai/sdk

- **What**: Keep OpenCode SDK, implement missing hooks via plugin system
- **Expected impact**: 60% of problem solved (still missing PreCompact, native abort)
- **Why insufficient**: OpenCode requires spawning server process, port allocation, stdout parsing. Plugin system provides only 3/6 hooks. Proprietary event format requires fragile parsing. SDK is third-party with uncertain maintenance timeline.

#### Alternative 2: Direct Anthropic Messages API

- **What**: Use `@anthropic-ai/sdk` Messages API directly, build agent loop manually
- **Expected impact**: 90% — full control over all behavior
- **Why insufficient**: Must reimplement: tool execution loop, MCP server management, context window compaction, abort handling, permission system. Estimated 2000+ lines of agent infrastructure code. The Agent SDK encapsulates all of this in a single `query()` call.

#### Alternative 3: Vercel AI SDK agent mode

- **What**: Use `ai` package (already in deps) with `streamText()` tool loop
- **Expected impact**: 70% — good streaming, tool loop built-in
- **Why insufficient**: No MCP server integration. No lifecycle hooks. No permission system. No context compaction. Would need to build all agent infrastructure on top. Not purpose-built for autonomous coding agents.

## Removed Dependencies

### @opencode-ai/sdk

| Attribute | Value |
|-----------|-------|
| **Current version** | ^1.2.20 |
| **Removal reason** | Fully replaced by Claude Agent SDK |
| **Files affected** | `spawn-opencode.ts` (deleted), `config-builder.ts` (replaced), `event-bridge.ts` (rewritten) |

### @opencode-ai/plugin (if present as devDep)

| Attribute | Value |
|-----------|-------|
| **Removal reason** | Plugin system no longer needed; Agent SDK has native hooks |
| **Files affected** | `init-content.ts` (`OPENCODE_PLUGIN_CONTENT` removed) |

## Unchanged Dependencies

| Package | Role | Impact |
|---------|------|--------|
| `@modelcontextprotocol/sdk` | Osabio MCP server (`cli/mcp-server.ts`) | None — MCP server code unchanged |
| `surrealdb` | Knowledge graph persistence | None — session queries unchanged |
| `ai` (Vercel AI SDK) | Chat agent, extraction pipeline | None — separate from orchestrator |
| `pino` | Logging | None |
| `zod` | Schema validation | None |

## Runtime Requirements

| Requirement | Current | After Migration |
|-------------|---------|----------------|
| **Bun** | Required | Required (unchanged) |
| **Node.js APIs** | `child_process.spawn` (OpenCode) | Not needed (SDK handles internally) |
| **Environment** | `OPENCODE_CONFIG_CONTENT` | `ANTHROPIC_API_KEY` |
| **Network** | localhost port per agent | Direct HTTPS to api.anthropic.com |
| **Disk** | OpenCode binary in PATH | Claude Code binary bundled in SDK (~50MB) |

## License Compliance

All dependencies use permissive licenses:

| Package | License |
|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | MIT |
| `@modelcontextprotocol/sdk` | MIT |
| `surrealdb` | Apache 2.0 |
| `ai` (Vercel) | Apache 2.0 |
| `zod` | MIT |
