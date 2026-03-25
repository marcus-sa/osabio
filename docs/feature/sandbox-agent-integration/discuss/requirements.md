# Requirements: Sandbox Agent Integration

## Business Context

Brain's orchestrator currently uses `@anthropic-ai/claude-agent-sdk` to spawn Claude Code processes locally. This architecture has critical limitations: single-shot sessions (no follow-up prompts, 409 on POST .../prompt), in-memory state (lost on restart), no real sandbox isolation (git worktrees only), and tight coupling to one agent type. SandboxAgent SDK replaces the execution layer while Brain retains full governance control through its proxy and dynamic MCP endpoints.

## Personas

### Rafael Torres -- Senior Developer
- Uses Brain's coding agents daily for implementation tasks
- Expects multi-turn interaction (prompt, review, redirect)
- Wants session resilience -- long coding sessions should survive network glitches
- Cares about observability: wants to see what the agent is doing in real time

### Carla Mendes -- Workspace Admin
- Configures workspace settings for her engineering team
- Responsible for security posture (sandbox isolation level)
- Manages cost constraints (sandbox provider costs)
- Non-expert in container orchestration but technical enough to configure settings

### Brain Orchestrator -- Internal System Actor
- Spawns and manages agent sessions on behalf of users
- Resolves tool grants, registers MCP endpoints, manages lifecycle
- Must maintain governance invariants regardless of execution environment

## Business Rules

1. **Governance invariant**: Every MCP tool call from a sandbox-executed agent MUST go through Brain's policy evaluation, regardless of sandbox provider. Native tools (file, bash, git) execute locally in the sandbox without governance.

2. **Session persistence invariant**: Every session event MUST be persisted to SurrealDB before being acknowledged. Session restoration depends on complete event history.

3. **Credential isolation**: Agent tokens are scoped per session. One session's token cannot access another session's MCP endpoint or proxy context.

4. **Provider transparency**: The coding agent does not know which sandbox provider it runs in. Provider selection is a workspace-level configuration, not an agent-level concern.

5. **Worktree fallback**: When sandbox provider is "local", Brain's worktree-manager.ts creates a git worktree for the session. Cloud/container providers handle isolation internally.

## Non-Functional Requirements

| Category | Requirement | Threshold |
|----------|-------------|-----------|
| Latency | Session spawn (local provider) | < 5 seconds from request to first prompt delivery |
| Latency | MCP tool call round-trip (dynamic endpoint) | < 500ms for tool calls to Brain's endpoint |
| Latency | Event bridge delay | < 500ms from SandboxAgent event to SSE stream |
| Reliability | Session restoration success rate | > 95% of sessions with persisted events restore successfully |
| Reliability | Event persistence completeness | 100% of events persisted (no silent drops) |
| Throughput | Event write throughput | Handle 50 events/second per session without backpressure |
| Security | Token scope isolation | Zero cross-session token access |
| Observability | Trace completeness | Every MCP tool call has a trace record with policy evaluation result |

## Domain Glossary

| Term | Definition |
|------|-----------|
| **Sandbox session** | A coding agent process running inside a SandboxAgent-managed environment with Brain governance |
| **Dynamic MCP endpoint** | A per-agent HTTP endpoint (`/mcp/agent/<name>`) that serves filtered tools and evaluates policy |
| **Effective toolset** | The union of direct grants (`can_use`) and skill-derived tools (`possesses->skill_requires`) |
| **Session persistence driver** | Implementation of SandboxAgent's `SessionPersistDriver` interface using SurrealDB |
| **Event bridge** | Component translating SandboxAgent's universal event schema to Brain's SSE and trace formats |
| **Walking skeleton** | The thinnest end-to-end slice: spawn, prompt, follow-up, persist, conclude |
| **Sandbox provider** | The isolation backend (local, Docker, E2B, Daytona) configured at workspace level |

## Dependencies

| Dependency | Status | Impact |
|-----------|--------|--------|
| SandboxAgent SDK (npm package) | Available (0.3.x/0.4.x) | Core dependency -- entire feature depends on it |
| Brain proxy (`/proxy/llm/anthropic`) | Exists | LLM traffic routing -- no changes needed |
| Brain MCP infrastructure | Exists (from #183) | Dynamic MCP endpoint pattern available |
| SurrealDB agent_session table | Exists | Schema extension needed for SandboxAgent session fields |
| SSE registry | Exists | Event bridge adapts to existing SSE infrastructure |
| Git worktree manager | Exists | Retained for local provider; no changes needed |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| SandboxAgent SDK breaking changes (0.x semver) | Medium | High | Pin version; wrap behind adapter interface |
| SurrealDB event write bottleneck under load | Low | Medium | Batch writes; benchmark in acceptance tests |
| Dynamic MCP endpoint latency spikes | Low | Medium | Connection pooling; timeout with retry |
| Claude Code agent incompatibility with SandboxAgent | Low | High | Walking skeleton validates this first |
| Rivet (SandboxAgent maintainer) abandons project | Low | High | Apache 2.0 license; can fork if needed |
