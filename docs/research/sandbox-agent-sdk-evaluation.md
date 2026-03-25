# Research: SandboxAgent SDK for Brain Agent Execution

**Date**: 2026-03-25
**Research Question**: Would SandboxAgent SDK be ideal for agent execution in Brain, particularly for governed tool access via MCP config and skills injection via skills config?
**Prior Art**: `docs/research/brain-native-agent-runtime.md` (concluded Brain should run agents natively)

---

## 1. What SandboxAgent Is

SandboxAgent ([sandboxagent.dev](https://sandboxagent.dev)) is an open-source (Apache 2.0) Rust binary + TypeScript SDK by Rivet that provides a universal HTTP/SSE interface for controlling coding agents (Claude Code, Codex, OpenCode, Amp, Cursor, Pi) running in isolated sandboxes.

**Core value proposition**: One HTTP API to control any coding agent, regardless of their proprietary interfaces.

**Execution model**:
```
Your Backend → SDK (HTTP) → Sandbox Agent Server (Rust) → Agent Process (Claude Code, etc.)
                                  ↕
                           Sandbox (E2B / Docker / Daytona / Vercel)
```

**Key capabilities**:
- Session lifecycle management (create, prompt, stream events, resume, destroy)
- Universal event schema across all supported agents
- Permission request handling (approve/reject tool use)
- MCP server configuration per session
- Skills configuration per session
- File system, process, and terminal access within sandbox
- Inspector UI for debugging
- OpenTelemetry observability

Sources: [GitHub](https://github.com/rivet-dev/sandbox-agent), [Docs](https://sandboxagent.dev/docs)

---

## 2. MCP Configuration Analysis

SandboxAgent supports configuring MCP servers that agents can use within sessions.

### What it provides

```typescript
// Set MCP config for a working directory
await sdk.setMcpConfig("/workspace", "my-server", {
  type: "local",  // or "remote"
  command: "/path/to/server",
  args: ["--flag"],
  env: { API_KEY: "..." },
  enabled: true,
  timeout: 30000,
});

// Remote servers support bearer tokens
await sdk.setMcpConfig("/workspace", "remote-server", {
  type: "remote",
  url: "https://api.example.com/mcp",
  transport: "sse",
  headers: { Authorization: "Bearer ${ENV_VAR}" },
});

// Session inherits MCP config from its working directory
await sdk.createSession({ agent: "claude", cwd: "/workspace" });
```

### What it does NOT provide

| Brain Need | SandboxAgent Support |
|-----------|---------------------|
| **Per-tool filtering** (expose only granted tools from an MCP server) | Not supported — entire MCP servers are enabled/disabled, not individual tools |
| **Dynamic tool injection** based on workspace grants or policy | Not supported — MCP config is static per working directory |
| **Credential brokerage** (OAuth token injection, refresh, rotation) | Basic only — static env vars and bearer tokens, no OAuth flow management |
| **Policy evaluation** before tool execution | Not supported — permission handling is binary approve/reject at the agent level |
| **Tool governance audit trail** | Not supported — events stream tool calls but no policy evaluation records |

**Critical gap**: Brain's tool registry (#178) requires resolving an agent's effective toolset as `can_use ∪ (possesses → skill_requires)` — the union of direct grants and skill-derived tools. SandboxAgent has no concept of tool-level access control. It exposes entire MCP servers or nothing.

Source: [MCP Config Docs](https://sandboxagent.dev/docs/mcp-config)

---

## 3. Skills Configuration Analysis

### What it provides

Skills are `SKILL.md` instruction files that get loaded into agent context. SandboxAgent supports three source types:

| Source | Format | Example |
|--------|--------|---------|
| `github` | `owner/repo` | `rivet-dev/skills` |
| `local` | Filesystem path | `/workspace/.skills/` |
| `git` | Clone URL | `https://git.example.com/skills.git` |

```typescript
// Register skill source
await sdk.setSkillsConfig("/workspace", "my-skills", {
  source: { type: "github", owner: "rivet-dev", repo: "skills" },
  skills: ["sandbox-agent"],  // optional: filter to specific skills
  ref: "main",
});
```

### What it does NOT provide

| Brain Need (Issue #177) | SandboxAgent Support |
|------------------------|---------------------|
| **Graph-native skills** (SurrealDB `skill` table with lifecycle) | Not supported — skills are filesystem files, not database records |
| **BM25 trigger matching** (activate skills based on intent) | Not supported — all configured skills are available, no selective activation |
| **`skill_requires` edges** (skills bundle tool access) | Not supported — skills and MCP tools are independent configs |
| **LLM-driven tool requirement analysis** | Not supported |
| **Version chains** (`skill_supersedes` relation) | Not supported — uses git refs for versioning |
| **Policy governance** (`governs_skill` relation) | Not supported |
| **`possesses` relation** (agent-skill assignment) | Not supported — skills are directory-scoped, not identity-scoped |
| **Missing tool resolution** (gap detection + MCP server catalog) | Not supported |

**Key insight**: SandboxAgent's skills are static instruction files loaded from repositories. Brain's skills (#177) are graph-native entities with lifecycle management, trigger-based activation, tool bundling, policy governance, and LLM-driven analysis. These are fundamentally different concepts that share the name "skill."

Source: [Skills Config Docs](https://sandboxagent.dev/docs/skills-config)

---

## 4. Architecture Fit Assessment

### What SandboxAgent solves well

1. **Sandbox isolation** — Brain needs agents to execute in isolated environments. SandboxAgent abstracts sandbox providers (E2B, Docker, Daytona, Vercel, Cloudflare) behind a single API.

2. **Agent-agnostic interface** — Brain's orchestrator could swap between Claude Code, Codex, and others without rewriting integration code.

3. **Session management** — Full session lifecycle over HTTP: `createSession()`, `prompt()`, `resumeSession()`, `destroySession()`. Sessions support multi-turn interaction (unlike Claude Agent SDK's single-query model). The API includes listing sessions, fetching event history with pagination, and runtime config changes (model, mode, thought level).

   ```typescript
   const session = await sdk.createSession({ agent: "claude", cwd: "/" });
   const response = await session.prompt([{ type: "text", text: "implement rate limiting" }]);
   // Later: send follow-up without respawning
   await session.prompt([{ type: "text", text: "add tests for the rate limiter" }]);
   // Resume after disconnect
   const restored = await sdk.resumeSession(session.id);
   ```

   This directly unblocks the orchestrator's reject-and-retry flow (`POST .../prompt` currently returns 409 because Claude Agent SDK doesn't support follow-up prompts).

4. **Session restoration** — Automatic recovery from connection loss. When `prompt()` or `resumeSession()` encounters a stale connection, the SDK transparently recreates a fresh session, rebinds the local session ID to the new runtime ID, and replays recent persisted events as context. Configurable via `replayMaxEvents` (default 50) and `replayMaxChars` (default 12,000). This eliminates the need for Brain's orchestrator to handle reconnection logic or agent respawning on transient failures.

5. **Event streaming** — Universal event schema for tool calls, file edits, and permission requests. Brain could ingest these into its trace graph. Supports both real-time streaming (`session.onEvent()`) and historical pagination (`sdk.getEvents({ sessionId, limit })`).

6. **Permission handling** — Granular permission request/response model: `session.onPermissionRequest()` + `session.respondPermission(id, "once" | "always" | "reject")`. Brain's orchestrator could map this to its intent authorization system — auto-approve tools within granted scope, escalate others to the user.

7. **Custom session persistence** — The `SessionPersistDriver` interface (5 methods: `getSession`, `listSessions`, `updateSession`, `listEvents`, `insertEvent`) allows Brain to write a SurrealDB driver, storing session records and events directly in the knowledge graph alongside `agent_session` and trace data. Built-in drivers exist for Postgres, SQLite, IndexedDB, and Rivet, but any backend works. Session restoration (point 4) depends on this driver for event replay.

5. **Credential extraction** — `sandbox-agent credentials extract-env` pulls API keys from local agent configs, useful for sandbox provisioning.

6. **Personal subscription support** — SandboxAgent can detect and use OAuth tokens from users' existing Claude Code / Codex personal subscriptions. Agents run under the user's own auth — no API key management needed for individual users. This is useful for Brain's self-hosted / personal use case where users bring their own subscriptions.

### LLM Credential Models

SandboxAgent supports three credential strategies, relevant to Brain's multi-tenant architecture:

| Model | Mechanism | Brain Relevance |
|-------|-----------|-----------------|
| **Personal subscription** | Auto-detects OAuth tokens from local Claude Code / Codex login. Short-lived tokens, no key management. | Individual users running Brain locally — zero config, agents use the user's own subscription |
| **API keys** | Pass `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` via `spawn.env` | Brain-managed agents where the workspace provides model access |
| **Per-tenant gateway** | Scoped API keys per tenant with independent spend tracking and budget limits | Aligns with Brain's proxy spend tracking and per-workspace budget limits |

The per-tenant gateway model maps directly to Brain's existing spend tracking architecture (`proxy_spend_cache` + budget limits). Brain could issue scoped keys per workspace/agent and pass them to SandboxAgent, maintaining spend isolation without exposing organizational API keys.

**Credentials and governance are orthogonal.** All LLM requests from coding agents still flow through Brain's proxy for tool filtering, policy evaluation, spend tracking, and trace recording. But the LLM credentials (who pays for inference) can come from any of the three models above. A personal subscription user's OAuth token passes *through* the proxy to the LLM provider — Brain governs the request but the user's own subscription covers the cost. This means Brain doesn't need to provide LLM API keys for self-hosted users while still maintaining full governance.

Source: [LLM Credentials Docs](https://sandboxagent.dev/docs/llm-credentials)

### What SandboxAgent cannot solve

1. **Governed tool access** — Brain's core differentiator is policy-controlled tool access. SandboxAgent exposes entire MCP servers or nothing. Brain needs per-tool filtering based on `can_use` grants, `possesses → skill_requires` derivation, and policy evaluation. This must be implemented in Brain's proxy layer regardless.

2. **Tool credential brokerage** — Brain's OAuth credential management (#178) for integration tools (GitHub, Slack, Jira MCP servers) requires dynamic token injection, refresh flows, and per-identity credential isolation. SandboxAgent only supports static env vars and bearer tokens for MCP server auth. Note: LLM provider credentials are handled separately (see above) and are less of a gap.

3. **Graph integration** — Brain's knowledge graph (decisions, observations, tasks, learnings) must be injected into agent context. SandboxAgent has no mechanism for dynamic context injection beyond skills files and MCP servers.

4. **Skills as graph entities** — Issue #177's design is fundamentally about graph-native skills with trigger matching, tool bundling, version chains, and policy governance. SandboxAgent's file-based skills don't map to this.

5. **Intent authorization** — Brain's intent system (RAR tokens, DPoP, policy graph evaluation) operates before tool execution. SandboxAgent's permission model is a simple approve/reject callback.

---

## 5. Integration Architecture (If Adopted)

If Brain were to use SandboxAgent, it would serve as the **sandbox execution layer** for all externally-executed agents (coding agents, user-configured custom agents) while Brain's proxy and dynamic MCP endpoint form the **governance control plane**:

```
Agent (Claude Code / Codex / custom agent in sandbox)
  │
  ├── LLM API requests → Brain Proxy → spend tracking, credential forwarding → LLM Provider
  │                         ↑                                                     ↑
  │                   LLM traffic plane                                    user's own credentials
  │                   (passthrough for tool calls)                         (personal sub / API key / gateway)
  │
  ├── MCP tool calls → Brain /mcp/agent/<name> → policy, credentials, upstream MCP → tool results
  │                         ↑
  │                   tool governance plane
  │                   (per-agent filtered tools/list, governed tools/call)
  │
  └── Native tools (file, bash, git) → execute locally in sandbox (ungoverned passthrough)

Brain Backend
  ├── Proxy (LLM traffic plane)
  │     ├── LLM credential forwarding (personal sub / API key / gateway)
  │     ├── Spend tracking (per-workspace budget limits)
  │     └── Trace recording (LLM request/response audit)
  │
  ├── Dynamic MCP Endpoint /mcp/agent/<name> (tool governance plane)
  │     ├── tools/list → filtered by agent grants (can_use ∪ possesses→skill_requires)
  │     ├── tools/call → policy evaluation → credential brokerage → upstream MCP
  │     └── Trace recording (tool call audit)
  │
  ├── Knowledge Graph (context injection via MCP)
  ├── Skill Resolver (BM25 trigger matching → SKILL.md delivery)
  │
  └── SandboxAgent SDK ← execution layer
        ├── Session lifecycle (create, resume, destroy)
        ├── Agent process management (Claude Code, Codex, etc.)
        ├── Sandbox provider abstraction (E2B, Docker, Daytona)
        ├── Event streaming → Brain trace graph
        └── Session persistence → SurrealDB (custom driver)
```

### Why two planes instead of one

The proxy and MCP endpoint are separate because they solve different problems:

**LLM traffic (proxy):** The coding agent sends LLM API requests through Brain's proxy URL. The proxy forwards to the LLM provider with the user's credentials, tracks spend, and records traces. The proxy does **not** execute tool calls for coding agents — it is a passthrough for the LLM conversation. Native tools (file read/write, bash, git) execute locally in the sandbox without governance.

**MCP tool calls (dynamic endpoint):** SandboxAgent configures Brain's `/mcp/agent/<name>` as an MCP server via `setMcpConfig()`. The coding agent discovers governed tools via standard `tools/list` (filtered by agent grants) and executes them via `tools/call` (policy evaluation + credential brokerage + upstream forwarding). This uses the standard MCP protocol that Claude Code, Codex, etc. already speak natively.

**Why not have the proxy execute MCP tools?** The proxy would need to run a partial agent loop — intercept LLM responses, split tool calls into MCP (execute) vs native (pass through), feed MCP results back to the LLM, and only return to the coding agent when native-only calls remain. This creates edge cases when the LLM returns mixed MCP + native tool calls in one response (the proxy can't execute MCP tools while waiting on native results it doesn't have). The dynamic MCP endpoint avoids this entirely — the coding agent routes tool calls to the right destination naturally via standard MCP protocol.

This differs from **Brain-native agents** (chat, PM, observer) where the proxy owns the full agent loop and executes ALL tools. Sandbox-executed agents (coding agents, user-configured custom agents) own their own loop; Brain governs only what it needs to.

Skills config delivers activated skills as `SKILL.md` files in the sandbox.

---

## 6. Comparison: SandboxAgent vs Brain Native Runtime

| Dimension | SandboxAgent | Brain Native (current path) |
|-----------|-------------|---------------------------|
| **Agent loop** | Delegates to coding agents (Claude Code, etc.) | Claude Agent SDK `query()` → local Claude Code process |
| **Tool execution** | Native tools: local in sandbox (passthrough). MCP tools: Brain dynamic endpoint (governed) | Native tools: local in worktree. MCP tools: Brain CLI stdio MCP server |
| **Tool governance** | MCP tools governed via `/mcp/agent/<name>`. Native tools ungoverned | MCP tools governed via Brain CLI + proxy. Native tools ungoverned (bypassPermissions) |
| **LLM credentials** | Personal subscription OAuth, API keys, per-tenant gateway | OpenRouter / Ollama via config |
| **Tool credentials** | Static env vars / bearer tokens | OAuth brokerage with refresh |
| **Skills** | File-based, static | Graph-native, trigger-activated, tool-bundled |
| **Context injection** | Skills files + MCP servers | Graph context, learnings, skills, tools |
| **Sandbox isolation** | Provider-dependent: local = none (host process), Docker = container, E2B = VM | Git worktrees for local isolation (existing) |
| **Agent variety** | 6 agents supported | Single agent per orchestrator config |
| **Session model** | Multi-turn (`prompt()` + `resumeSession()` + auto-restoration) | Single-query (`query()` returns `AsyncIterable`, no follow-ups) |
| **Session persistence** | Custom driver interface — implement `SessionPersistDriver` (5 methods) for any backend | In-memory handle registry (`Map<id, AgentHandle>`) |
| **Permission model** | Granular per-request (`onPermissionRequest` → `once`/`always`/`reject`) | Binary (`bypassPermissions: true`) |
| **Observability** | OpenTelemetry | OpenTelemetry (existing) |

---

## 7. Trade-offs

### Gains from adopting SandboxAgent

1. **Sandbox abstraction** — No need to build Docker/E2B/Daytona integration from scratch
2. **Agent portability** — Swap coding agents without rewriting integration
3. **Session management** — Battle-tested session lifecycle over HTTP
4. **Inspector UI** — Free debugging/introspection tool
5. **Community momentum** — 1.2k GitHub stars, active development, multiple sandbox providers

### Losses from adopting SandboxAgent

1. **Governance gap** — Brain's entire value proposition (governed autonomy) must still be built on top. SandboxAgent provides no tool-level access control, policy evaluation, or credential brokerage.
2. **Two governance models** — Brain-native agents use proxy-executed tool loops. Coding agents use dynamic MCP endpoints with native tool passthrough. Same governance logic, different integration patterns to maintain.
3. **Skills impedance** — Two different "skills" concepts (file-based vs graph-native) create confusion and require a translation layer.
4. **Dependency risk** — Coupling to a 0.3.x/0.4.x SDK from a startup (Rivet) for a core execution path.

---

## 8. Recommendation

**Use SandboxAgent as the sandbox execution layer, not as the tool governance layer.**

SandboxAgent solves a real problem Brain has — it needs to run coding agents in isolated environments without building sandbox provider integrations from scratch. But SandboxAgent's MCP config and skills config are **transport mechanisms**, not governance mechanisms.

### Concrete integration pattern

1. **Brain resolves grants** — When spawning an agent session, Brain resolves the agent's effective toolset (`can_use ∪ possesses→skill_requires`), evaluates policies, and prepares credentials.

2. **Brain exposes dynamic MCP endpoint** — Brain registers `/mcp/agent/<name>` which serves only the tools this agent is granted. `tools/list` returns the filtered toolset. `tools/call` evaluates policy, injects credentials, and forwards to upstream MCP servers.

3. **SandboxAgent configures MCP** — Brain uses `sdk.setMcpConfig()` to point the coding agent at its dynamic MCP endpoint:
   ```typescript
   await sdk.setMcpConfig("/workspace", "brain", {
     type: "remote",
     url: `${brainUrl}/mcp/agent/${agentName}`,
     transport: "sse",
     headers: { "X-Brain-Auth": agentToken },
   });
   ```

4. **Brain configures proxy** — The coding agent's LLM endpoint is set to Brain's proxy URL for spend tracking and credential forwarding.

5. **Brain generates skills config** — Brain renders activated skills (from BM25 trigger matching) as `SKILL.md` files in the sandbox filesystem, or serves them via a local MCP server with a `get_skill_content` tool.

6. **SandboxAgent executes** — The coding agent runs in the sandbox with:
   - Brain's proxy as its LLM endpoint (spend tracking, credential forwarding)
   - Brain's dynamic MCP endpoint for governed tools (policy, credentials, upstream forwarding)
   - Native tools executing locally in the sandbox (ungoverned passthrough)

7. **Brain records traces** — Event stream from SandboxAgent feeds into Brain's trace graph. MCP tool calls are also traced at the endpoint level, giving dual observability.

### What this means for #177

SandboxAgent's skills-config does **not** replace the need to build issue #177. Brain's graph-native skills (trigger matching, tool bundling, version chains, policy governance) are a superset of what SandboxAgent provides. However, SandboxAgent's skills-config provides a convenient **delivery mechanism** — Brain resolves which skills to activate, then uses SandboxAgent's config to make them available in the sandbox.

### What this means for MCP tool access

SandboxAgent's MCP config does **not** replace Brain's tool registry (#178) or tool governance. Brain must still resolve per-agent tool grants, broker credentials, and evaluate policies. SandboxAgent's MCP config is the **transport mechanism** — it points the coding agent at Brain's dynamic MCP endpoint (`/mcp/agent/<name>`) where governance happens. The endpoint is a thin layer on top of the same grant resolution and policy evaluation that Brain-native agents already use.

The key architectural insight: **one governance implementation, two integration patterns**. Brain-native agents (chat, PM, observer) get governed tools via the proxy's full agent loop. Sandbox-executed agents (coding agents, user-configured custom agents) get governed tools via the dynamic MCP endpoint. Both resolve grants from the same `can_use ∪ possesses→skill_requires` logic and evaluate the same policy graph.

### Orchestrator refactoring

The orchestrator currently uses `@anthropic-ai/claude-agent-sdk` (`query()`) to spawn Claude Code processes locally with git worktrees. Adopting SandboxAgent replaces this SDK for all sandbox-executed agents — both built-in coding agents and user-configured custom agents.

**Current architecture (Claude Agent SDK — coding agents only):**

| Component | Current Implementation |
|-----------|----------------------|
| Agent spawn | `query()` from `@anthropic-ai/claude-agent-sdk` → local Claude Code process |
| Agent options | `buildAgentOptions()` → `cwd`, `maxTurns`, `allowedTools`, `systemPrompt`, `permissionMode` |
| MCP server | Brain CLI as stdio MCP server (`mcpServers.brain`) within agent process |
| LLM proxy | `ANTHROPIC_BASE_URL` → Brain proxy `/proxy/llm/anthropic` with `X-Brain-Auth` |
| Isolation | Git worktree per session (`agent/<task-slug>-<uuid>` branch) |
| Events | `AsyncIterable<unknown>` → event bridge → SSE registry |
| Lifecycle | In-memory handle registry (`AgentHandle` with `abort()`) |
| Session model | Single-query (no follow-up prompts after spawn) |

**Target architecture (SandboxAgent SDK):**

SandboxAgent is not limited to built-in coding agents. It is the execution layer for **any agent configured by workspace users** — coding agents, custom agents with specific tool grants, domain-specific agents with curated skills. All run through the same SandboxAgent session lifecycle with Brain's governance (dynamic MCP endpoint for tools, proxy for LLM traffic).

| Component | SandboxAgent Implementation |
|-----------|---------------------------|
| Agent spawn | `sdk.createSession()` → agent process in sandbox (E2B, Docker, etc.) |
| Agent options | SandboxAgent session config + `sdk.setMcpConfig()` + env vars |
| MCP server | Brain dynamic MCP endpoint `/mcp/agent/<name>` via remote MCP config |
| LLM proxy | Same — Brain proxy URL passed as `ANTHROPIC_BASE_URL` env |
| Isolation | **Depends on provider** — see isolation section below |
| Events | SandboxAgent universal event stream → event bridge → SSE registry |
| Lifecycle | SandboxAgent session API (`createSession`, `prompt`, `resumeSession`, `destroySession`) |
| Session model | Multi-turn (`prompt()` supports follow-ups — unblocks reject-and-retry) |
| Restoration | Automatic — SDK rebinds session ID, replays events on connection loss |
| Permissions | `onPermissionRequest()` → map to intent authorization (auto-approve within grants) |

**Key files affected:**

| File | Change |
|------|--------|
| `orchestrator/spawn-agent.ts` | Replace `query()` with `sdk.createSession()` + `sdk.prompt()` |
| `orchestrator/agent-options.ts` | Replace SDK options with SandboxAgent session config |
| `orchestrator/event-bridge.ts` | Adapt from Claude Agent SDK message format to SandboxAgent event schema |
| `orchestrator/session-lifecycle.ts` | Adapt lifecycle to SandboxAgent session API; remove in-memory handle registry |
| `orchestrator/worktree-manager.ts` | **Keep for local provider** — see isolation section below |
| `orchestrator/routes.ts` | `POST .../prompt` becomes functional (SandboxAgent supports multi-turn) |

**MCP server migration:**

Currently, the Brain CLI runs as a stdio MCP server inside the agent process:
```typescript
// Current: stdio MCP server in agent options
mcpServers: {
  brain: {
    type: "stdio",
    command: brainCliPath,
    args: ["mcp"],
    env: { BRAIN_WORKSPACE_ID: workspaceId, BRAIN_IDENTITY_ID: identityId },
  },
}
```

With SandboxAgent, Brain exposes a remote MCP endpoint per agent:
```typescript
// Target: remote MCP server via SandboxAgent config
await sdk.setMcpConfig("/workspace", "brain", {
  type: "remote",
  url: `${brainUrl}/mcp/agent/${agentName}`,
  transport: "sse",
  headers: { "X-Brain-Auth": agentToken },
});
```

This eliminates the need to bundle the Brain CLI in the sandbox and enables per-agent tool filtering at the endpoint level.

**Isolation: local provider does NOT sandbox**

The local provider (`sandbox-agent` local deploy) spawns agent processes directly on the host as child processes — no containers, VMs, chroot, or kernel namespaces. Agents get full access to the host filesystem. The "worktree" in SandboxAgent is just a configurable path (`OPENCODE_COMPAT_WORKTREE`), not a git worktree.

This means Brain's `worktree-manager.ts` is still needed for local deployment to provide git-level isolation per coding session:

| Provider | Isolation | Brain worktree needed? |
|----------|-----------|----------------------|
| **Local** | None — direct host process | **Yes** — Brain creates git worktree, passes path as `cwd` to SandboxAgent session |
| **Docker** | Container with bind mounts | No — mount repo into container |
| **E2B** | VM (Firecracker) | No — sandboxed filesystem |
| **Daytona** | Container/VM | No — sandboxed filesystem |

For local deployment, Brain creates the git worktree first, then passes the worktree path as the session's `cwd`:

```typescript
// Local provider: Brain still manages worktrees
const worktree = await createWorktree(repoPath, taskSlug);
const session = await sdk.createSession({
  agent: "claude",
  cwd: worktree.path,  // agent operates in isolated worktree
});
```

For cloud/container providers, the sandbox handles isolation and Brain skips worktree creation.

Brain-native agents (chat, PM, observer, analytics) remain unchanged — they run in-process with AI SDK and the proxy's full tool loop.

### Priority consideration

SandboxAgent becomes valuable when Brain needs to run **coding agents** (Claude Code, Codex) in sandboxes for software engineering tasks. If the current focus is on chat agents and knowledge graph management (which run in Brain's own process), SandboxAgent can be deferred until the coding agent use case is prioritized.

---

## Sources

- [SandboxAgent Homepage](https://sandboxagent.dev)
- [SandboxAgent GitHub](https://github.com/rivet-dev/sandbox-agent)
- [MCP Config Docs](https://sandboxagent.dev/docs/mcp-config)
- [Skills Config Docs](https://sandboxagent.dev/docs/skills-config)
- [Custom Tools Docs](https://sandboxagent.dev/docs/custom-tools)
- [Security Docs](https://sandboxagent.dev/docs/security)
- [Architecture Docs](https://sandboxagent.dev/docs/architecture)
- [Orchestration Architecture](https://sandboxagent.dev/docs/orchestration-architecture)
- [LLM Credentials Docs](https://sandboxagent.dev/docs/llm-credentials)
- [Agent Sessions Docs](https://sandboxagent.dev/docs/agent-sessions)
- [Session Restoration Docs](https://sandboxagent.dev/docs/session-restoration)
- [Session Persistence Docs](https://sandboxagent.dev/docs/session-persistence)
- [Brain Issue #177: Skills](https://github.com/marcus-sa/brain/issues/177)
- [Brain Native Agent Runtime Research](docs/research/brain-native-agent-runtime.md)
