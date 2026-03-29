# Requirements: Replace OpenCode with Claude Agent SDK

## Summary

Replace the OpenCode-based coding agent orchestrator with the Claude Agent SDK. The SDK provides a single `query()` function that returns a typed async iterable of messages, with native support for MCP servers and all lifecycle hooks. This eliminates the multi-step process startup, proprietary event format, and missing hook coverage.

## Scope

### In Scope

1. **Replace `spawn-opencode.ts`** with Agent SDK `query()` invocation
2. **Replace `config-builder.ts`** with Agent SDK options builder
3. **Replace `event-bridge.ts`** event transformation for SDK message types
4. **Implement all 6 lifecycle hooks** as TypeScript callbacks in query options
5. **Configure Osabio MCP server** as stdio transport in query options
6. **Update `session-lifecycle.ts`** types (`OpenCodeHandle` -> `AgentHandle`)
7. **Update `init-content.ts`** — remove OpenCode plugin/config generation
8. **Update `init.ts`** — remove `setupOpencode()` or repurpose for Agent SDK
9. **Supersede ADR-003** with new ADR documenting the Agent SDK decision
10. **Update tests** for new spawn function signature and event types

### Out of Scope

- Changing the orchestrator session lifecycle (create/abort/accept/reject/review/prompt)
- Changing the UI (AgentSessionPanel, AgentStatusSection)
- Changing the SSE streaming contract (StreamEvent types unchanged)
- Multi-model support (Agent SDK is Claude-only; this is acceptable)
- Claude Code integration (unchanged — continues using MCP + hooks)

## Constraints

- **C1**: Agent SDK requires `ANTHROPIC_API_KEY` environment variable
- **C2**: Agent SDK bundles a Claude Code executable — adds ~50MB to deployment
- **C3**: Must maintain the same `StreamEvent` contract to the browser (no UI changes)
- **C4**: Hook callbacks must not block the agent loop — use fire-and-forget with error swallowing for non-critical hooks
- **C5**: `permissionMode: "bypassPermissions"` required for autonomous operation (agent runs unattended)

## Dependencies

- `@anthropic-ai/claude-agent-sdk` npm package
- `osabio mcp` CLI command (existing, unchanged)
- Osabio HTTP API (existing, unchanged)
