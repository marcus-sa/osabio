# Research: Brain as Native Agent Runtime

**Date**: 2026-03-21
**Research Question**: Does Brain need OpenClaw (or any external agent framework) at all, or should it run agents natively via AI SDK with graph-governed tools?

**Conclusion**: Brain should run agents natively. OpenClaw's value decomposes into an agent loop (AI SDK), tools (filesystem, shell, git), and sandboxing (Docker/WASM). Brain already has the agent loop via its orchestrator. The remaining pieces are tools and infrastructure — not a framework dependency.

---

## 1. What Agent Frameworks Actually Do

Every agent framework — OpenClaw, Codex, Devin, Aider — does the same thing:

```
while (not done) {
  response = llm.generateText({ prompt, tools })
  for (toolCall of response.toolCalls) {
    result = execute(toolCall)
  }
}
```

That's the agent loop. Everything else is tools and context management.

| Framework Feature | What It Actually Is |
|------------------|-------------------|
| "Code editing" | Tool: read file, write file, apply diff |
| "Shell execution" | Tool: run command, return stdout/stderr |
| "Git integration" | Tool: git add, commit, push, diff |
| "Code search" | Tool: grep, glob, AST search |
| "Browser automation" | Tool: navigate, click, read DOM |
| "Multi-file editing" | Multiple invocations of the file tool |
| "Sandboxed execution" | Docker container hosting the tools |
| "Context management" | System prompt construction |
| "Memory" | Persistent state injected into prompts |
| "Approval gates" | Policy check before tool execution |

None of these require a framework. They require an agent loop (AI SDK), tools (functions), and governance (Brain).

---

## 2. What Brain Already Has

Brain's orchestrator (`app/src/server/orchestrator/`) already runs agents:

| Component | Status | Location |
|-----------|--------|----------|
| Agent loop | Exists | Claude Agent SDK via orchestrator |
| Session lifecycle | Exists | `session-lifecycle.ts` (spawning → active → completed) |
| Event streaming | Exists | Event bridge → SSE registry |
| Context injection | Exists | Graph context, learnings, BM25 search |
| Policy enforcement | Exists | Intent authorizer + policy graph |
| Spend tracking | Exists | Proxy spend cache + budget limits |
| Trace recording | Exists | Hierarchical traces in SurrealDB |
| Identity & auth | Exists | OAuth 2.1, DPoP, RAR |
| Task assignment | Exists | Orchestrator assign → agent session |
| Worktree isolation | Exists | Git worktrees per session |

What's missing: **general-purpose tools** (filesystem, shell, git) and **skills** (domain expertise injection).

---

## 3. The Three Layers of Agent Competency

Brain needs three layers to fully replace external agent frameworks:

| Layer | What | Example | Status |
|-------|------|---------|--------|
| **Tools** | Functional capabilities — stateless endpoints | `read_file`, `write_file`, `shell_exec`, `git_diff` | Missing (general-purpose set) |
| **Skills** | Domain expertise — behavioral instructions for a class of work | "how to do a security audit", "how to triage issues" | Missing |
| **Learnings** | Corrections/patterns — single rules from past failure or success | "don't mock the DB in these tests" | Exists (`learning` table) |

### Tools ≠ Skills ≠ Learnings

- A **tool** gives the agent a hand (functional capability)
- A **skill** tells the agent how to use its hands to bake a cake (domain expertise)
- A **learning** tells the agent not to burn the cake like last time (correction)

All three get injected into the agent's context, but at different layers and with different activation logic.

---

## 4. Tools: The General-Purpose Set

The tools that make an agent useful for software engineering are simple functions:

### Filesystem Tools

| Tool | Purpose | Signature |
|------|---------|-----------|
| `read_file` | Read file contents | `(path, offset?, limit?) → string` |
| `write_file` | Create or overwrite file | `(path, content) → void` |
| `edit_file` | Apply targeted string replacement | `(path, old, new, replaceAll?) → void` |
| `glob` | Find files by pattern | `(pattern, path?) → string[]` |
| `grep` | Search file contents | `(pattern, path?, options?) → Match[]` |

### Shell Tools

| Tool | Purpose | Signature |
|------|---------|-----------|
| `shell_exec` | Run shell command | `(command, cwd?, timeout?) → { stdout, stderr, exitCode }` |

### Git Tools

| Tool | Purpose | Signature |
|------|---------|-----------|
| `git_status` | Working tree status | `() → FileStatus[]` |
| `git_diff` | Staged/unstaged changes | `(ref?) → string` |
| `git_log` | Recent commits | `(limit?, path?) → Commit[]` |
| `git_commit` | Create commit | `(message, files?) → string` |

### Context Tools (Brain-specific)

| Tool | Purpose | Signature |
|------|---------|-----------|
| `get_context` | Load graph state for current work | `(intent) → GraphContext` |
| `create_observation` | Log a signal to the graph | `(text, severity, type) → Observation` |
| `resolve_decision` | Check if a decision already exists | `(question) → Decision?` |
| `create_decision` | Propose a provisional decision | `(title, reasoning, alternatives) → Decision` |
| `search_entities` | Search workspace knowledge | `(query) → Entity[]` |
| `update_task_status` | Progress a task | `(taskId, status) → Task` |

These context tools already exist as MCP tools. The filesystem/shell/git tools are new but trivial to implement — each is 20-50 lines.

### Tool Governance

Every tool invocation passes through Brain's intent system:

```
Agent calls shell_exec("rm -rf /tmp/build")
  │
  ├─ Brain creates intent:
  │   { action: "shell:rm -rf /tmp/build", riskLevel: "medium" }
  │
  ├─ Policy evaluation:
  │   → Policy "no-destructive-without-approval" matches
  │   → Intent status: draft → pending_auth
  │
  ├─ Human approval (via UI/CLI):
  │   → Intent status: pending_auth → authorized
  │
  └─ Tool executes, result returned to agent
```

This is what OpenClaw's exec approval does — but Brain's version is richer because it evaluates against a policy graph with versioning, authority scopes, and audit trails.

---

## 5. Skills: Domain Expertise as Graph Nodes

Skills are the missing middle layer between tools (capabilities) and learnings (corrections). A skill is a governed, versionable, discoverable instruction document that gets JIT-injected into agent context when the incoming work matches its triggers.

### How Skills Differ from Learnings

| Aspect | Learning | Skill |
|--------|----------|-------|
| **Size** | Single rule (1-3 sentences) | Full instruction set (paragraphs to pages) |
| **Activation** | Always-on for target agents | Triggered by intent match |
| **Origin** | Reactive — derived from failures/patterns | Proactive — authored expertise |
| **Lifecycle** | `proposed → active → deactivated` | `draft → active → deprecated` (with version chain) |
| **Injection** | Appended to system prompt (token-budgeted) | Injected when trigger matches task |
| **Tool binding** | None | `skill_requires` edges to tools |

### Schema

```sql
DEFINE TABLE skill SCHEMAFULL;
DEFINE FIELD name ON skill TYPE string;
DEFINE FIELD description ON skill TYPE string;
DEFINE FIELD content ON skill TYPE string;
DEFINE FIELD triggers ON skill TYPE array<string>;
DEFINE FIELD version ON skill TYPE string;
DEFINE FIELD status ON skill TYPE string
  ASSERT $value IN ["draft", "active", "deprecated"];
DEFINE FIELD target_agent_types ON skill TYPE array<string>;
DEFINE FIELD workspace ON skill TYPE record<workspace>;
DEFINE FIELD created_by ON skill TYPE option<record<identity>>;
DEFINE FIELD created_at ON skill TYPE datetime;
DEFINE FIELD updated_at ON skill TYPE option<datetime>;

DEFINE TABLE skill_requires TYPE RELATION IN skill OUT mcp_tool SCHEMAFULL;
DEFINE TABLE possesses TYPE RELATION IN identity OUT skill SCHEMAFULL;
DEFINE FIELD granted_at ON possesses TYPE datetime;
DEFINE TABLE skill_supersedes TYPE RELATION IN skill OUT skill SCHEMAFULL;
DEFINE TABLE skill_evidence TYPE RELATION IN skill OUT agent_session | trace | observation SCHEMAFULL;
DEFINE FIELD added_at ON skill_evidence TYPE datetime;

DEFINE INDEX skill_workspace ON skill FIELDS workspace;
DEFINE INDEX skill_status ON skill FIELDS status;
```

### Activation Flow

```
1. Task arrives: "Run a security audit on the auth module"

2. Skill discovery (BM25 against triggers + description):
   → "security-audit" skill scores high

3. Authorization:
   → Agent possesses this skill? (possesses edge)
   → Policy allows it? (policy graph)
   → Required tools available? (skill_requires edges)

4. Context injection:
   → Skill content injected into system prompt
   → Required tools provisioned
   → Learnings also loaded (separate, additive)

5. Execution:
   → Agent works with skill expertise + learning corrections + graph context

6. Evolution:
   → Failure? Observer proposes skill update
   → New version via skill_supersedes chain
```

### Import from skills.sh

The 80k+ skills in the `skills.sh` ecosystem are SKILL.md files (YAML frontmatter + Markdown body). Brain can import them:

```
SKILL.md → parse triggers from frontmatter
         → parse tool requirements from content
         → create skill node in SurrealDB
         → create skill_requires edges
         → set status = "draft" (human reviews before activation)
```

---

## 6. Sandboxed Execution

The one legitimate infrastructure concern from agent frameworks: isolation. An agent with filesystem and shell access can do damage.

### Options

| Approach | Isolation | Latency | Complexity |
|----------|-----------|---------|------------|
| **Git worktrees** | File-level (existing) | None | Already built |
| **Docker containers** | Process + filesystem | ~2s startup | Medium |
| **WASM** | Memory-level | ~10ms startup | High (tool porting) |
| **Firecracker/microVM** | Kernel-level | ~125ms startup | High (infra) |

Brain already uses git worktrees for agent isolation. For higher-risk operations, tools can execute inside a Docker container:

```
Agent calls shell_exec("npm install && npm test")
  │
  ├─ Policy says: "shell commands in project X require container isolation"
  │
  ├─ Brain spawns Docker container:
  │   → Mount worktree as volume
  │   → Network restricted to localhost
  │   → Resource limits (CPU, memory, timeout)
  │
  ├─ Command runs inside container
  │
  └─ Result returned to agent
```

This is not an agent framework feature. It's a tool execution policy. Brain's policy graph decides *whether* to sandbox, and the tool executor handles *how*.

### NVIDIA OpenShell

NVIDIA OpenShell (March 2026) provides kernel-level sandboxing for agent tool execution. It treats skills as behavioral units that can be scanned and restricted. Brain's architecture aligns with this — skills are governed graph nodes, tools execute inside policy-controlled sandboxes.

If OpenShell matures, Brain can use it as the sandbox backend instead of Docker. The tool interface doesn't change — only the executor.

---

## 7. The Full Agent Stack

```
Humans
  │
  ├─ Brain UI (chat, feed, graph view, skill library, policy management)
  ├─ Brain CLI
  └─ MCP (coding agents: Cursor, Claude Code, etc.)
       │
       ▼
  Brain Server
  ├─ Identity & Auth (OAuth 2.1, DPoP, RAR)
  ├─ Orchestrator (session lifecycle, task assignment)
  ├─ Context Builder
  │   ├─ Graph state (decisions, observations, tasks, constraints)
  │   ├─ Skills (triggered by intent, injected into prompt)
  │   └─ Learnings (always-on corrections)
  ├─ Policy Engine (intent → policy graph → authorize/deny)
  ├─ Spend Tracker (token budgets per agent/workspace)
  ├─ Observer (contradiction detection, skill evolution)
  └─ Trace Recorder (hierarchical, graph-native)
       │
       ▼
  AI SDK Agent Loop
  ├─ Vercel AI SDK / Claude Agent SDK
  └─ generateText({ prompt, tools }) in a loop
       │
       ▼
  Tools
  ├─ Filesystem (read, write, edit, glob, grep)
  ├─ Shell (exec with policy-governed sandboxing)
  ├─ Git (status, diff, log, commit)
  ├─ Brain Context (get_context, create_observation, resolve_decision)
  └─ Custom (workspace-defined MCP tools)
       │
       ▼
  Sandbox (optional, policy-driven)
  ├─ Git worktrees (file isolation — default)
  ├─ Docker containers (process isolation — when policy requires)
  └─ WASM / OpenShell (memory/kernel isolation — future)
```

No external agent framework in this stack. Brain owns every layer from human interaction to tool execution.

---

## 8. What About OpenClaw Compatibility?

Brain does not need to implement the OpenClaw Gateway Protocol. The Gateway Protocol was designed for OpenClaw clients talking to an OpenClaw gateway. If Brain is the runtime, there is no gateway.

However, Brain can still serve OpenClaw's existing user base through the path that already works: **MCP**.

```
OpenClaw CLI → spawns agent → agent connects to Brain MCP server
  │
  ├─ get_context (loads graph state)
  ├─ create_observation (logs signals)
  ├─ resolve_decision (checks existing decisions)
  └─ ...all existing MCP tools
```

This requires zero new code. OpenClaw agents call Brain's MCP server for context and governance. They run their own agent loop and tools. Brain doesn't need to replace OpenClaw for users who want to keep using it — it just governs them.

The native runtime (Brain running agents directly via AI SDK) is for users who want Brain to be the whole stack. MCP compatibility is for users who want Brain as a sidecar to their existing tools.

Both paths coexist. No Gateway Protocol needed for either.

---

## 9. Comparison: External Framework vs. Native Runtime

| Aspect | OpenClaw through Brain (Gateway Protocol) | Brain native (AI SDK + tools) |
|--------|-------------------------------------------|-------------------------------|
| Moving parts | 3 (client + Brain + OpenClaw runtime) | 1 (Brain) |
| Protocol coupling | Must track Gateway Protocol v3+ evolution | None — Brain defines its own tool interface |
| Auth | Two systems bridged (Ed25519 + DPoP) | One system (DPoP) |
| Context injection | Intercept or proxy | Native — Brain builds the prompt |
| Tool governance | Bridged via exec approval protocol | Native — policy graph evaluates directly |
| Skill injection | Must push skills into external runtime | Native — skills are part of prompt construction |
| Trace recording | Reconstruct from gateway events | Native — Brain records as it executes |
| Latency | Extra hop (Brain ↔ OpenClaw) | Direct (Brain → LLM) |
| Complexity | ~2000 lines of gateway protocol code | ~500 lines of tools |
| Ecosystem access | OpenClaw CLI, web UI, mobile, Mission Control | Brain UI, Brain CLI, MCP |

The native runtime is simpler, faster, and more capable. The only trade-off is ecosystem access — but Brain's MCP server already covers the integration case.

---

## 10. Schema Changes Required

### Agent Type Extension

```sql
ALTER FIELD agent_type ON agent TYPE string
  ASSERT $value IN ['code_agent', 'architect', 'management', 'design_partner', 'observer', 'chat_agent', 'mcp', 'native'];
```

### Device Fingerprint on Agent (for persistent identity across sessions)

```sql
DEFINE FIELD device_fingerprint ON agent TYPE option<string>;
DEFINE FIELD device_public_key ON agent TYPE option<string>;
DEFINE FIELD device_platform ON agent TYPE option<string>;
DEFINE FIELD device_family ON agent TYPE option<string>;
DEFINE INDEX agent_device_fingerprint ON agent FIELDS device_fingerprint;
```

### Skill Table

```sql
DEFINE TABLE skill SCHEMAFULL;
DEFINE FIELD name ON skill TYPE string;
DEFINE FIELD description ON skill TYPE string;
DEFINE FIELD content ON skill TYPE string;
DEFINE FIELD triggers ON skill TYPE array<string>;
DEFINE FIELD version ON skill TYPE string;
DEFINE FIELD status ON skill TYPE string
  ASSERT $value IN ["draft", "active", "deprecated"];
DEFINE FIELD target_agent_types ON skill TYPE array<string>;
DEFINE FIELD workspace ON skill TYPE record<workspace>;
DEFINE FIELD created_by ON skill TYPE option<record<identity>>;
DEFINE FIELD created_at ON skill TYPE datetime;
DEFINE FIELD updated_at ON skill TYPE option<datetime>;

DEFINE TABLE skill_requires TYPE RELATION IN skill OUT mcp_tool SCHEMAFULL;
DEFINE TABLE possesses TYPE RELATION IN identity OUT skill SCHEMAFULL;
DEFINE FIELD granted_at ON possesses TYPE datetime;
DEFINE TABLE skill_supersedes TYPE RELATION IN skill OUT skill SCHEMAFULL;
DEFINE TABLE skill_evidence TYPE RELATION IN skill OUT agent_session | trace | observation SCHEMAFULL;
DEFINE FIELD added_at ON skill_evidence TYPE datetime;
DEFINE INDEX skill_workspace ON skill FIELDS workspace;
DEFINE INDEX skill_status ON skill FIELDS status;
```

### Summary

| Change | Type |
|--------|------|
| Add `'native'` to `agent.agent_type` | Migration |
| Add device fields to `agent` | Migration |
| Add `skill` table + relations | Migration |
| All other tables | Unchanged |

---

## 11. Build Order

| Phase | What | Depends On | Effort |
|-------|------|-----------|--------|
| 1 | Filesystem tools (read, write, edit, glob, grep) | AI SDK | S |
| 2 | Shell tool (exec with timeout, cwd) | — | S |
| 3 | Git tools (status, diff, log, commit) | — | S |
| 4 | Tool governance (policy check before execution) | Intent system | M |
| 5 | Orchestrator integration (tools registered in agent loop) | Orchestrator | M |
| 6 | Skill schema + migration | SurrealDB | S |
| 7 | Skill CRUD routes | Skill schema | M |
| 8 | Skill discovery (BM25 trigger matching) | BM25 infra | M |
| 9 | Skill injection into context builder | Context builder | M |
| 10 | Skill importer (skills.sh / SKILL.md → graph) | Skill schema | M |
| 11 | Sandboxed shell execution (Docker) | Shell tool | L |
| 12 | Skill evolution (Observer → skill updates) | Observer + skills | L |
| 13 | Skill library UI | Frontend | L |
| 14 | Brain CLI (task-scoped agent sessions) | Orchestrator + tools | L |

**MVP (phases 1-5)**: Brain runs agents with filesystem/shell/git tools, governed by policies. Proves the concept — no external framework.

**Skills (phases 6-10)**: Full skill system — discovery, injection, import from skills.sh.

**Production (phases 11-14)**: Sandboxed execution, skill evolution, UI, dedicated CLI.

---

## Sources

- Brain orchestrator: `app/src/server/orchestrator/`
- Brain intent authorizer: `app/src/server/intent/authorizer.ts`
- Brain learning system: `app/src/server/learning/`
- Brain context builder: `app/src/server/chat/context.ts`
- Brain proxy: `app/src/server/proxy/anthropic-proxy-route.ts`
- Brain SSE registry: `app/src/server/streaming/sse-registry.ts`
- [Vercel AI SDK](https://sdk.vercel.ai/) — agent loop, tool use, streaming
- [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) — kernel-level agent sandboxing
- [skills.sh](https://skills.sh) — 80k+ SKILL.md behavioral instruction sets
- HiClaw — containerized agent architecture with Matrix coordination
- Paperclip OpenClaw adapter — reference for agent lifecycle management
- Previous research: `docs/research/openclaw-gateway-protocol-integration.md`
- Previous research: `docs/research/openclaw-native-gateway-architecture.md`
