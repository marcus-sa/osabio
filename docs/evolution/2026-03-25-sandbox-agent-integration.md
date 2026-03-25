# Evolution: Sandbox Agent Integration

**Date**: 2026-03-25
**Feature ID**: sandbox-agent-integration
**Branch**: marcus-sa/sandbox-agent-eval
**Duration**: Single day (06:32 - 11:12 UTC)

## Summary

Replaced the Claude Agent SDK-specific orchestrator with a universal SandboxAgent SDK integration. Brain now delegates coding agent execution to SandboxAgent Server via an adapter interface, persists session state in SurrealDB (eliminating the module-level mutable registry), and issues governed proxy tokens linking intent authorization to agent sessions.

## Business Context

Brain's coding agent orchestrator was tightly coupled to Claude Agent SDK, limiting agent portability. The SandboxAgent SDK (from Rivet) provides a universal API for orchestrating multiple coding agents (Claude Code, Codex, OpenCode, Amp) in sandboxed environments. This integration enables:

- **Multi-agent portability**: Workspace admins can configure which coding agent to use
- **Multi-turn sessions**: Agents accept follow-up prompts instead of rejecting with 409
- **Session persistence**: Session state survives server restarts via SurrealDB
- **Governed autonomy**: Proxy tokens carry intent + session linkage for full traceability

## Phases Completed

### Phase 1: Foundation (Steps 01-01 to 01-03)
- Defined adapter port types and mock adapter for test injection
- Built event bridge translating SandboxAgent universal events to Brain StreamEvent variants
- Extended StreamEvent union with permission request variant
- Schema migration adding provider and session_type fields to agent_session

### Phase 2: Session Store and Lifecycle Refactor (Steps 02-01 to 02-04)
- Implemented session store with SurrealDB CRUD operations
- Eliminated module-level mutable `handleRegistry` Map (AGENTS.md violation)
- Wired adapter for session spawn and multi-turn prompt delivery
- Connected event bridge to SSE registry, removed old SDK event translation

### Phase 3: Integration and Walking Skeleton (Steps 03-01 to 03-02)
- Walking skeleton E2E: spawn, prompt, SSE events, SurrealDB record verification
- Multi-turn, persistence, error paths (EP-1 through EP-7), edge cases (EC-1, EC-2)

### Phase 4: R2 Proxy Token Governance (Steps 04-01 to 04-03)
- Schema migration adding intent + session fields to proxy_token table
- Extended CreateSessionRequest with optional env record
- Wired proxy token issuance into adapter spawn path with intent binding
- Proxy tokens now carry governance chain: intent -> session -> token

## Key Decisions

### From DISCUSS Wave
| ID | Decision | Status |
|----|----------|--------|
| D-01 | SandboxAgent as execution layer only, not governance layer | Provisional |
| D-02 | Two-plane governance: LLM proxy + dynamic MCP endpoint | Provisional |
| D-03 | Local provider retains Brain worktree manager | Provisional |
| D-04 | SurrealDB session persistence driver (deferred to cloud providers) | Provisional |
| D-05 | Three-release slicing strategy | Provisional |
| D-07 | Adapter interface wraps SDK at SDK level | Provisional |
| D-08 | New event bridge replaces Claude-specific bridge | Provisional |

### From DESIGN Wave
| ID | Decision | Status |
|----|----------|--------|
| AD-01 | Adapter abstracts at SDK level, not session level | Provisional |
| AD-02 | SurrealDB replaces in-memory handle registry | Provisional |
| AD-03 | Sandbox fields on agent_session, not separate table | Provisional |
| AD-04 | 100ms write buffer for event persistence (deferred) | Deferred |
| AD-05 | Forward-compatible unknown event handling in bridge | Provisional |
| AD-06 | Permission handler as separate component | Provisional |
| AD-07 | Session restoration via active session scan on startup | Provisional |

### From DISTILL Wave
| ID | Decision | Status |
|----|----------|--------|
| TD-01 | Unit tests use mock adapter, acceptance tests use real SDK | Confirmed |
| TD-02 | Given-When-Then as comments, not .feature files | Confirmed |
| TD-05 | Walking skeleton implementation order: WS-1 first | Provisional |

## Lessons Learned

1. **Module-level mutable state was the root cause of test fragility** — the old `handleRegistry` Map shared across concurrent test runs caused silent corruption. SurrealDB persistence with per-test namespace isolation solved this completely.

2. **Adapter interface paid for itself immediately** — the mock adapter enabled all 12 steps to be developed and tested without a running SandboxAgent Server, while the adapter boundary keeps the 0.x SDK dependency contained.

3. **Proxy token governance requires atomic creation** — initial approach of UPDATE-based token linking was fragile. Refactored to atomic creation where the proxy_token record is created with intent+session fields already populated, ensuring consistency.

4. **R2 scope was correctly deferred** — the dynamic MCP endpoint and intent-gated tool access were extracted into a separate feature (`intent-gated-mcp`) during delivery, keeping this feature focused on the execution layer.

## Deferred Work

- **SurrealDB persistence driver** for cloud providers (GitHub issue #187) — needed when sandboxes outlive Brain restarts
- **Intent-gated MCP** — separated into its own feature with full DISCUSS/DESIGN/DISTILL waves completed
- **Agent portability + provider configuration** (R3) — strategic but not urgent

## Migrated Artifacts

| Source | Destination |
|--------|-------------|
| `design/architecture-design.md` | `docs/architecture/sandbox-agent-integration/` |
| `design/component-boundaries.md` | `docs/architecture/sandbox-agent-integration/` |
| `design/data-models.md` | `docs/architecture/sandbox-agent-integration/` |
| `design/technology-stack.md` | `docs/architecture/sandbox-agent-integration/` |
| `distill/test-scenarios.md` | `docs/scenarios/sandbox-agent-integration/` |
| `distill/walking-skeleton.md` | `docs/scenarios/sandbox-agent-integration/` |
| `discuss/journey-agent-session-lifecycle.yaml` | `docs/ux/sandbox-agent-integration/` |
| `discuss/journey-agent-session-lifecycle-visual.md` | `docs/ux/sandbox-agent-integration/` |

## Test Coverage

- **Unit tests**: `tests/unit/orchestrator/sandbox-adapter.test.ts`, `sandbox-event-bridge.test.ts`, `session-store.test.ts`; `tests/unit/proxy/proxy-auth.test.ts`
- **Acceptance tests**: `tests/acceptance/sandbox-session-lifecycle.test.ts`, `sandbox-session-governance.test.ts`
- **Scenario coverage**: 31 scenarios (42% error/edge cases)
