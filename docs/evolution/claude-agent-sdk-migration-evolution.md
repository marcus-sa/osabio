# Evolution: Claude Agent SDK Migration

**Feature:** claude-agent-sdk-migration
**Completed:** 2026-03-07
**Duration:** ~2 hours (18:37 - 19:35 UTC)
**ADR:** ADR-008 (Accepted), supersedes ADR-001 and ADR-003

## Summary

Replaced `@opencode-ai/sdk` with `@anthropic-ai/claude-agent-sdk` for coding agent orchestration. The OpenCode SDK required an 8-step spawn sequence (port allocation, process spawn, stdout parsing, client creation, session creation, SSE subscription, HTTP MCP relay, manual process kill). The Claude Agent SDK reduces this to a single `query()` call returning a typed `AsyncIterable<Message>` with native MCP stdio transport and AbortController-based cancellation.

## Architecture Decisions

- **ADR-008 accepted:** Claude Agent SDK chosen over OpenCode SDK, direct Anthropic Messages API, and Vercel AI SDK alternatives.
- **ADR-001 superseded:** OpenCode SDK integration pattern no longer applies.
- **ADR-003 superseded:** OpenCode plugin-over-MCP pattern replaced by SDK-native MCP stdio transport.
- **Rejected alternatives:** (1) Configuration-only swap -- type/protocol gap too wide. (2) Adapter wrapper around spawn-opencode -- would duplicate complexity rather than eliminate it.

## Implementation Steps

### Phase 01: SDK Foundation
| Step | Name | Outcome |
|------|------|---------|
| 01-01 | Agent options builder and spawn function | Created `agent-options.ts` (pure `buildAgentOptions`) and `spawn-agent.ts` (SDK `query()` wrapper returning `AgentHandle`) |
| 01-02 | Event bridge SDK message translation | Replaced `OpencodeEvent` with SDK `Message` type; implemented `transformSdkMessage` producing `StreamEvent` variants |

### Phase 02: Lifecycle and Route Wiring
| Step | Name | Outcome |
|------|------|---------|
| 02-01 | Session lifecycle type migration | Replaced `OpenCodeHandle` with `AgentHandle`, `SpawnOpenCodeFn` with `SpawnAgentFn` throughout session lifecycle |
| 02-02 | Route wiring and env var rename | Updated `routes.ts` imports; renamed `ORCHESTRATOR_MOCK_OPENCODE` to `ORCHESTRATOR_MOCK_AGENT` |

### Phase 03: CLI Cleanup and OpenCode Removal
| Step | Name | Outcome |
|------|------|---------|
| 03-01 | CLI init OpenCode removal | Removed `setupOpencode()`, `OPENCODE_PLUGIN_CONTENT`, `buildOpencodeJsonContent()`, `OPENCODE_MD_CONTENT` from CLI init |
| 03-02 | Delete OpenCode modules and dependency | Deleted `spawn-opencode.ts`, `config-builder.ts`; removed `@opencode-ai/sdk` from `package.json` |

### Phase 04: Test Migration and ADRs
| Step | Name | Outcome |
|------|------|---------|
| 04-01 | Test kit and acceptance test updates | Updated orchestrator-test-kit mock to return `AgentHandle`; rewrote event bridge, agent lifecycle, and agent tools tests with SDK message fixtures |
| 04-02 | ADR status updates | ADR-008 accepted; ADR-001 and ADR-003 marked superseded |

### Post-Phase: Review Defects
| Step | Name | Outcome |
|------|------|---------|
| refactor | Refactoring pass | Code cleanup after main implementation |
| review-fix | Review defect fixes (D1-D6) | Handle registry cleanup, async error handling improvements |

## Metrics

- **Total steps:** 8 planned + 2 post-phase (refactor, review-fix)
- **Production files changed:** 9
- **Test files changed:** 8
- **Documentation files changed:** 3
- **Decomposition ratio:** 0.89 files/step
- **All tests passing:** Yes (all COMMIT phases PASS)
- **StreamEvent contract:** Unchanged (UI compatibility preserved)

## Key Technical Notes

- The SDK's `query()` function encapsulates the entire agent loop: tool call parsing, MCP server lifecycle, context window management, compaction triggers, multi-turn conversation state, and abort propagation.
- Osabio MCP server configured as stdio transport in SDK options, eliminating the HTTP relay hop that OpenCode required.
- All 6 lifecycle hooks now available as typed TypeScript callbacks (up from 3/6 with OpenCode plugin + 4/6 with Claude Code hooks workaround).
- `AbortController.abort()` replaces `client.session.abort()` + `proc.kill()`, eliminating process orphaning risk.
- No port allocation, stdout parsing, or process management code remains.

## Files Delivered

**New modules:**
- `app/src/server/orchestrator/agent-options.ts` -- pure config builder
- `app/src/server/orchestrator/spawn-agent.ts` -- SDK query() wrapper

**Modified modules:**
- `app/src/server/orchestrator/event-bridge.ts` -- SDK message translation
- `app/src/server/orchestrator/session-lifecycle.ts` -- type migration
- `app/src/server/orchestrator/routes.ts` -- spawn wiring

**Deleted modules:**
- `app/src/server/orchestrator/spawn-opencode.ts`
- `app/src/server/orchestrator/config-builder.ts`

**CLI:**
- `cli/commands/init.ts` -- removed setupOpencode()
- `cli/commands/init-content.ts` -- removed OpenCode content constants

**ADRs:**
- `docs/adrs/ADR-008-claude-agent-sdk-over-opencode.md` -- Accepted
- `docs/adrs/ADR-001-opencode-sdk-integration-pattern.md` -- Superseded
- `docs/adrs/ADR-003-opencode-plugin-over-mcp.md` -- Superseded
