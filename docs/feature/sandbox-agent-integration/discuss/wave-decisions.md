# DISCUSS Wave Decisions: Sandbox Agent Integration

## D-01: SandboxAgent as Execution Layer Only

**Decision**: Use SandboxAgent SDK as the sandbox execution layer, NOT as the tool governance layer.

**Rationale**: SandboxAgent solves sandbox provider abstraction, agent portability, and session management. Brain's governance (tool filtering, policy evaluation, credential brokerage) must remain in Brain's own MCP endpoint layer. SandboxAgent's MCP config is a transport mechanism (pointing agents at Brain's endpoint), not a governance mechanism.

**Status**: Provisional (from research, pending implementation validation)

---

## D-02: Two-Plane Governance Architecture

**Decision**: Maintain two separate governance planes:
1. LLM traffic plane (proxy) -- spend tracking, credential forwarding
2. Tool governance plane (dynamic MCP endpoint) -- policy evaluation, tool filtering, credential brokerage

**Rationale**: Having the proxy execute MCP tools would require running a partial agent loop with edge cases on mixed MCP + native tool calls. The dynamic MCP endpoint lets coding agents route tool calls naturally via standard MCP protocol.

**Status**: Provisional

---

## D-03: Local Provider Retains Brain Worktree Manager

**Decision**: When sandbox provider is "local", Brain's worktree-manager.ts creates a git worktree and passes the path as `cwd` to SandboxAgent. Cloud/container providers handle isolation internally and skip worktree creation.

**Rationale**: SandboxAgent's local provider offers zero isolation (host process, full filesystem access). Git worktrees remain necessary for file-level isolation in local deployment.

**Status**: Provisional

---

## D-04: SurrealDB Session Persistence Driver

**Decision**: Implement a custom `SessionPersistDriver` using SurrealDB rather than using built-in Postgres/SQLite drivers.

**Rationale**: Session data belongs in the knowledge graph alongside agent_session and trace records. This enables graph queries correlating sessions with tasks, decisions, and observations. Built-in drivers would create a separate data silo.

**Status**: Provisional

---

## D-05: Release Slicing Strategy

**Decision**: Split into 3 releases:
1. Multi-Turn + Persistence (core migration)
2. Dynamic MCP Endpoint + Governance Parity
3. Agent Portability + Provider Configuration

**Rationale**: Each release delivers independently verifiable value. Release 1 addresses the highest-scoring opportunities (multi-turn: 18.0, restoration: 16.0). Release 2 is required for production security. Release 3 is strategic but not urgent.

**Status**: Provisional

---

## D-06: Brain-Native Agents Unchanged

**Decision**: Brain-native agents (chat, PM, observer, analytics) remain in-process with AI SDK. SandboxAgent is only for externally-executed agents (coding agents, user-configured custom agents).

**Rationale**: Native agents use the proxy's full tool loop where all tools are executed by Brain. Sandboxing them would add complexity without benefit -- they already run inside Brain's process with direct graph access.

**Status**: Provisional

---

## D-07: Adapter Interface Around SandboxAgent SDK

**Decision**: Wrap SandboxAgent SDK behind a Brain-owned adapter interface to mitigate dependency risk on a 0.x SDK.

**Rationale**: SandboxAgent is 0.3.x/0.4.x from a startup (Rivet). Breaking changes are expected. An adapter interface allows Brain to swap implementations without cascading changes through the orchestrator.

**Status**: Provisional

---

## D-08: Event Bridge Replacement (Not Extension)

**Decision**: Build a new event bridge for SandboxAgent events. Deprecate the Claude Agent SDK event bridge.

**Rationale**: SandboxAgent's universal event schema is a superset -- it normalizes events across all agent types. Extending the existing Claude-specific bridge would create a maintenance burden maintaining two format translators.

**Status**: Provisional

---

## Open Questions

| # | Question | Owner | Deadline |
|---|---------|-------|----------|
| Q-01 | What is the exact SandboxAgent SDK npm package name and stable version? | Developer | Before US-01 |
| Q-02 | Does SandboxAgent SDK handle prompt queuing internally, or does Brain need to implement it? | Developer | Before US-04 |
| Q-03 | What is the maximum event replay size that maintains agent coherence? | Developer | Before US-05 |
| Q-04 | Should the adapter interface (D-07) abstract at the session level or the SDK level? | Architect | Before US-01 |
| Q-05 | How should permission auto-approve scope be represented in the grant model? | Product | Before US-07 |
