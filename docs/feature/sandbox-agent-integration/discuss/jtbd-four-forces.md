# Four Forces Analysis: Sandbox Agent Integration

## Forces Analysis: Run Coding Agents in Isolation (Job 1)

### Demand-Generating
- **Push**: Current Claude Agent SDK spawns agents as local processes with `bypassPermissions: true` and no real isolation. Git worktrees provide file-level separation but no process, network, or resource isolation. A misbehaving agent can exhaust host CPU/memory, access the network freely, or read files outside the worktree.
- **Pull**: SandboxAgent abstracts Docker, E2B, and Daytona behind one API. One `createSession()` call provisions a sandboxed environment. No need to build container orchestration from scratch.

### Demand-Reducing
- **Anxiety**: Coupling to a 0.3.x/0.4.x SDK from a startup (Rivet). What if the project is abandoned? What if breaking changes ship faster than Brain can adapt? The local provider offers zero isolation (host process), so "sandbox" is misleading for the default deployment.
- **Habit**: Current worktree-based isolation works for local development. The team knows how to debug local processes. Docker/E2B adds operational complexity (container builds, network config, cloud costs).

### Assessment
- Switch likelihood: **High** -- the push (no real isolation) and pull (turnkey sandbox abstraction) are strong
- Key blocker: Dependency risk on early-stage SDK
- Key enabler: Eliminates months of custom sandbox provider integration
- Design implication: Wrap SandboxAgent SDK behind a Brain-owned adapter interface to mitigate dependency risk

---

## Forces Analysis: Agent Portability (Job 2)

### Demand-Generating
- **Push**: Brain is locked to Claude Code via `@anthropic-ai/claude-agent-sdk`. Adding Codex or OpenCode requires a new integration from scratch -- different process model, different event format, different configuration.
- **Pull**: SandboxAgent normalizes six agent types behind one API. `agent: "claude"` swaps to `agent: "codex"` with no code changes. Universal event schema means one event bridge for all agents.

### Demand-Reducing
- **Anxiety**: Will agent-specific features (Claude Code's `permissionMode`, Codex's sandbox model) map cleanly to the universal API? What capabilities are lost in abstraction?
- **Habit**: Claude Code works well for current use cases. No urgent need to run other agents today.

### Assessment
- Switch likelihood: **Medium** -- strong pull but low push (no immediate multi-agent demand)
- Key blocker: Abstraction may lose agent-specific capabilities
- Key enabler: Future-proofs agent selection as the market evolves rapidly
- Design implication: Prioritize after isolation; agent portability is a strategic advantage, not an urgent pain

---

## Forces Analysis: Multi-Turn Sessions (Job 3)

### Demand-Generating
- **Push**: Claude Agent SDK's `query()` is single-shot. `POST .../prompt` returns 409 because there is no mechanism for follow-up prompts. The orchestrator cannot do reject-and-retry, iterative refinement, or human-in-the-loop correction. Users must re-spawn entire sessions to course-correct.
- **Pull**: SandboxAgent's `session.prompt()` supports follow-ups. Send correction prompts without losing context. The reject-and-retry flow becomes natural.

### Demand-Reducing
- **Anxiety**: Multi-turn sessions accumulate state. What if the context window fills? How does the user know the session is "stale"?
- **Habit**: Users have adapted to the single-shot model -- they front-load detailed prompts knowing they cannot course-correct.

### Assessment
- Switch likelihood: **High** -- the push is acute (409 on prompt, no course correction) and the pull is immediate
- Key blocker: Context window management for long sessions
- Key enabler: Directly unblocks a broken UX (prompt endpoint returning 409)
- Design implication: Must-have in walking skeleton -- this is the most user-visible improvement

---

## Forces Analysis: Session Restoration (Job 4)

### Demand-Generating
- **Push**: Current in-memory handle registry (`Map<id, AgentHandle>`) loses all session state on server restart or network interruption. Long-running coding sessions (30+ minutes) are vulnerable to transient failures. Users lose work with no recovery path.
- **Pull**: SandboxAgent auto-restores sessions by rebinding session IDs and replaying persisted events. Configurable replay window (50 events / 12K chars by default). Zero-effort recovery for users.

### Demand-Reducing
- **Anxiety**: Will event replay produce the exact same agent state? Could replayed context mislead the agent?
- **Habit**: Users have learned to keep sessions short and save work frequently to mitigate loss risk.

### Assessment
- Switch likelihood: **High** -- infrastructure reliability directly affects user trust
- Key blocker: Ensuring replay fidelity
- Key enabler: Custom SurrealDB persistence driver stores events in graph, enabling both restoration and audit
- Design implication: Include in walking skeleton -- persistence driver is prerequisite for restoration

---

## Forces Analysis: Dynamic MCP Endpoint Governance (Job 5)

### Demand-Generating
- **Push**: Current stdio MCP server (Brain CLI inside agent process) requires bundling the CLI binary in every sandbox. The CLI approach does not scale to Docker/E2B environments where the filesystem is ephemeral and the CLI binary must be pre-installed.
- **Pull**: Brain exposes `/mcp/agent/<name>` as a remote MCP endpoint. SandboxAgent configures it via `setMcpConfig()`. Coding agents call it via standard MCP protocol they already speak natively. One governance implementation serves all agents.

### Demand-Reducing
- **Anxiety**: Remote MCP adds network latency to every tool call. What if the endpoint is unavailable? The agent hangs waiting for tool results.
- **Habit**: The stdio MCP server is fast (in-process) and already works for local Claude Code sessions.

### Assessment
- Switch likelihood: **High** -- the push (cannot bundle CLI in cloud sandboxes) directly blocks cloud deployment
- Key blocker: Network reliability and latency for tool calls
- Key enabler: Eliminates CLI binary dependency; enables per-agent tool filtering at endpoint level
- Design implication: The dynamic MCP endpoint already exists in Brain's architecture. This job is about wiring it to SandboxAgent's MCP config.

---

## Forces Analysis: SurrealDB Session Persistence (Job 6)

### Demand-Generating
- **Push**: In-memory handle registry loses all state on process restart. No audit trail, no cross-session correlation, no graph queries over agent history.
- **Pull**: SandboxAgent's `SessionPersistDriver` interface (5 methods) allows a clean SurrealDB implementation. Sessions and events become graph entities queryable alongside tasks, decisions, and traces.

### Demand-Reducing
- **Anxiety**: SurrealDB write performance for high-frequency event streams (tool calls can fire dozens per second). Will the persistence driver become a bottleneck?
- **Habit**: In-memory handles are simple and fast. Adding database writes adds complexity.

### Assessment
- Switch likelihood: **High** -- prerequisite for session restoration (Job 4) and event streaming (Job 7)
- Key blocker: Write performance for event-heavy sessions
- Key enabler: Unlocks session restoration, audit, and graph-based agent history
- Design implication: Batch event writes; use SurrealDB's async event patterns for non-blocking persistence

---

## Forces Analysis: Event Streaming to Feed (Job 7)

### Demand-Generating
- **Push**: Current event bridge is tightly coupled to Claude Agent SDK's `AsyncIterable<unknown>` message format. Events are streamed to the SSE registry but not persisted in the trace graph.
- **Pull**: SandboxAgent's universal event schema provides structured events (tool calls, file edits, permission requests) with consistent typing. Brain can bridge these to both the SSE registry (real-time feed) and the trace graph (persistent audit).

### Demand-Reducing
- **Anxiety**: Two event formats to maintain -- SandboxAgent events for sandbox agents, Claude Agent SDK events for legacy. Will the event bridge become a maintenance burden?
- **Habit**: Current event bridge works for Claude Code. Changing it risks breaking existing SSE consumers.

### Assessment
- Switch likelihood: **High** -- necessary for observability parity between native and sandbox agents
- Key blocker: Event schema translation complexity
- Key enabler: SandboxAgent's universal schema actually simplifies the bridge (one format for all agents vs per-agent formats)
- Design implication: Build a new event bridge for SandboxAgent events; deprecate the Claude Agent SDK event bridge

---

## Forces Analysis: Workspace Sandbox Configuration (Job 8)

### Demand-Generating
- **Push**: No configuration mechanism for sandbox providers today. The orchestrator hardcodes local execution.
- **Pull**: Workspace admins can choose the isolation level matching their risk/cost profile. E2B for high-security work, Docker for CI, local for development.

### Demand-Reducing
- **Anxiety**: Configuration complexity for non-technical workspace admins. Docker requires registry access, E2B requires API keys.
- **Habit**: Everything runs locally today with no configuration needed.

### Assessment
- Switch likelihood: **Medium** -- the push is moderate (local works) but the pull is strategic (enables cloud deployment)
- Key blocker: Configuration UX for multiple providers
- Key enabler: SandboxAgent abstracts provider differences -- config is a provider name + credentials
- Design implication: Start with local provider (no config change), add Docker/E2B as incremental slices
