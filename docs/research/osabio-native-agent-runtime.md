# Research: Osabio as Native Agent Runtime

**Date**: 2026-03-21
**Research Question**: Does Osabio need OpenClaw (or any external agent framework) at all, or should it run agents natively via AI SDK with graph-governed tools?

**Conclusion**: Osabio should run agents natively. OpenClaw's value decomposes into an agent loop (AI SDK), tools (filesystem, shell, git), and sandboxing (Docker/WASM). Osabio already has the agent loop via its orchestrator. The remaining pieces are tools and infrastructure — not a framework dependency.

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

None of these require a framework. They require an agent loop (AI SDK), tools (functions), and governance (Osabio).

---

## 2. What Osabio Already Has

Osabio's orchestrator (`app/src/server/orchestrator/`) already runs agents:

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

Osabio needs three layers to fully replace external agent frameworks:

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

### Context Tools (Osabio-specific)

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

Every tool invocation passes through Osabio's intent system:

```
Agent calls shell_exec("rm -rf /tmp/build")
  │
  ├─ Osabio creates intent:
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

This is what OpenClaw's exec approval does — but Osabio's version is richer because it evaluates against a policy graph with versioning, authority scopes, and audit trails.

---

## 5. The Proxy as Tool Layer

All LLM requests are routed through Osabio's proxy. The proxy already intercepts requests and injects context. The insight: **the proxy can also inject tools and intercept tool calls**. No separate MCP gateway needed — the proxy IS the tool layer.

### How It Works

```
Any agent (OpenClaw, Cursor, Claude Code, curl, anything)
  │
  POST /v1/chat/completions  (bare request, no tools, no credentials)
  │
  ▼
Osabio Proxy
  │
  ├─ 1. Identify agent (DPoP-bound identity)
  ├─ 2. Resolve active skills for this agent + current task
  ├─ 3. Resolve tools: can_use ∩ skill_requires = this session's toolset
  ├─ 4. Inject tools into request's `tools` parameter
  ├─ 5. Inject skill content + learnings + graph context into messages
  ├─ 6. Forward enriched request to LLM provider
  │
  ├─ 7. LLM responds with tool_calls
  ├─ 8. Proxy intercepts tool_calls
  ├─ 9. For each tool call:
  │     ├─ Create intent: { action: "github:create_issue", requester: identity }
  │     ├─ Evaluate against policy graph (governs_tool edges)
  │     ├─ If integration tool: lookup connected_account, refresh token, execute with brokered creds
  │     ├─ If local tool: execute in sandbox (policy-dependent isolation level)
  │     ├─ Sanitize response (strip credential artifacts)
  │     └─ Record trace (tool call → trace node in graph)
  ├─ 10. Send tool results back to LLM
  ├─ 11. Loop 7-10 until LLM returns final response
  │
  └─ 12. Return response to agent
```

The agent sends a bare LLM request. It doesn't know about tools, skills, or credentials. The proxy adds everything.

### Why the Proxy, Not an MCP Gateway

| MCP Gateway approach | Proxy approach |
|---------------------|---------------|
| Agents must discover and configure tools | Agents send bare requests — Osabio decides what they get |
| Separate protocol (MCP) for tool delivery | Same HTTP path the agent already uses |
| Agent chooses which tools to call | LLM chooses from tools Osabio injected — agent never sees the list |
| Credentials could leak via MCP response | Credentials never leave the proxy — agent sees sanitized results |
| Works only for MCP-aware agents | Works for **any** agent that routes LLM calls through Osabio |

The proxy approach is strictly more powerful: it works for every agent type (OpenClaw, Cursor, Claude Code, raw API calls) without requiring MCP support. The agent doesn't even need to know tools exist.

### Per-Agent Tool Resolution

Not all tools and skills are available to all agents. Osabio resolves the toolset per-request based on the agent's identity:

```sql
-- Tools this identity is authorized to use
SELECT out AS tool FROM can_use WHERE in = $identity;

-- Skills this identity possesses
SELECT out AS skill FROM possesses WHERE in = $identity;

-- Tools required by active skills
SELECT out AS tool FROM skill_requires WHERE in IN $active_skills;

-- Policies governing these tools
SELECT in AS policy FROM governs_tool WHERE out IN $resolved_tools;
```

The intersection of authorized tools (`can_use`) and skill-required tools (`skill_requires`) becomes the `tools` array injected into the LLM request.

| Agent | Skills | Tools Injected |
|-------|--------|---------------|
| Junior dev | `write-unit-tests` | `read_file`, `write_file`, `grep`, `shell_exec` (read-only) |
| Senior dev | `security-audit`, `deploy` | `read_file`, `write_file`, `shell_exec`, `git_*`, `github.*` |
| PM agent | `triage-issues` | `linear.*`, `slack.send_message`, `search_entities` |
| Observer | (built-in) | `get_context`, `create_observation`, `search_entities` |

### Brokered Credentials at the Proxy

The core security principle: **LLMs must never see raw credentials**. The proxy holds secrets, agents hold nothing.

When the LLM returns a tool call for an integration tool (e.g., `github.create_issue`):

1. Proxy identifies the toolkit (`github`) from the tool name
2. Looks up `connected_account` for this identity + toolkit
3. Refreshes OAuth token if expired (automatic)
4. Executes the API call with the brokered credential
5. Returns sanitized result to the LLM (no tokens in response)

The agent never sees the GitHub token. It never even knows a token exists.

### Connected Account Lifecycle

```
1. Admin configures auth_config for "github" toolkit:
   → OAuth2 client_id, client_secret, scopes
   → Stored encrypted in Osabio's database

2. Identity connects their GitHub account:
   → Osabio initiates OAuth2 flow
   → User authorizes in browser
   → Osabio receives access_token + refresh_token
   → Stored in connected_account (encrypted)
   → Status: "active"

3. LLM calls github.create_issue (via proxy-injected tool):
   → Proxy looks up connected_account for this identity + github
   → Token expired? Auto-refresh using refresh_token
   → Execute API call with fresh token
   → Update last_used_at

4. Token revoked externally:
   → Next API call fails with 401
   → Osabio marks connected_account status: "expired"
   → LLM receives tool error: "GitHub connection expired"
   → Agent surfaces this to user
   → User re-authorizes via Osabio UI
```

### Tool Categories

Three categories, all injected by the proxy:

#### Local Tools (no credentials)

| Tool | Risk Level | Default Policy |
|------|-----------|---------------|
| `read_file` | low | Auto-approve |
| `write_file` | low | Auto-approve |
| `edit_file` | low | Auto-approve |
| `glob` | low | Auto-approve |
| `grep` | low | Auto-approve |
| `shell_exec` | medium | Policy-dependent |
| `git_commit` | medium | Auto-approve |
| `git_push` | high | Require approval |

#### Context Tools (Osabio-native)

| Tool | Risk Level |
|------|-----------|
| `get_context` | low |
| `search_entities` | low |
| `create_observation` | low |
| `resolve_decision` | low |
| `create_decision` | medium |
| `update_task_status` | medium |

#### Integration Tools (brokered credentials)

| Toolkit | Example Tools | Auth Type |
|---------|--------------|-----------|
| GitHub | `create_issue`, `create_pr`, `merge_pr` | OAuth2 |
| Slack | `send_message`, `create_channel` | OAuth2 |
| Linear | `create_issue`, `update_status` | API key |
| Stripe | `create_charge`, `list_invoices` | API key |
| Gmail | `send_email`, `search_inbox` | OAuth2 |
| Custom | Any REST endpoint as `mcp_tool` node | Bearer / API key |

### How It Differs from Composio

| Aspect | Composio | Osabio |
|--------|----------|-------|
| **Delivery** | MCP gateway (agents must be MCP-aware) | LLM proxy (works for any agent) |
| **Tool selection** | Agent requests tools by name | Osabio injects tools based on identity + skills |
| **Credential storage** | Proprietary vault (cloud) | `connected_account` table (self-hosted, encrypted) |
| **Authorization** | External policy engine | Intent system + policy graph (existing, versioned) |
| **Audit trail** | Gateway logs | Graph-native traces (hierarchical, queryable) |
| **Governance** | Rate limits + HITL | Rate limits + HITL + policy graph + authority scopes + RAR |
| **Deployment** | Cloud (Composio hosts execution) | Self-hosted (Osabio hosts everything) |

### The MCP Server Still Exists (For External Agents)

The proxy approach handles agents whose LLM calls route through Osabio. For external agents that want to call Osabio tools directly (e.g., a script, a CI pipeline), the existing MCP server still works:

```json
{
  "mcpServers": {
    "brain": {
      "command": "brain",
      "args": ["mcp"]
    }
  }
}
```

But the MCP server exposes only **context tools** (graph read/write). Integration tools and local tools flow through the proxy — that's where credential brokerage and policy enforcement live

---

## 6. Skills: Domain Expertise as Graph Nodes

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

The 80k+ skills in the `skills.sh` ecosystem are SKILL.md files (YAML frontmatter + Markdown body). Osabio can import them:

```
SKILL.md → parse triggers from frontmatter
         → parse tool requirements from content
         → create skill node in SurrealDB
         → create skill_requires edges
         → set status = "draft" (human reviews before activation)
```

---

## 7. Sandboxed Execution

The one legitimate infrastructure concern from agent frameworks: isolation. An agent with filesystem and shell access can do damage.

### Options

| Approach | Isolation | Latency | Complexity |
|----------|-----------|---------|------------|
| **Git worktrees** | File-level (existing) | None | Already built |
| **Docker containers** | Process + filesystem | ~2s startup | Medium |
| **WASM** | Memory-level | ~10ms startup | High (tool porting) |
| **Firecracker/microVM** | Kernel-level | ~125ms startup | High (infra) |

Osabio already uses git worktrees for agent isolation. For higher-risk operations, tools can execute inside a Docker container:

```
Agent calls shell_exec("npm install && npm test")
  │
  ├─ Policy says: "shell commands in project X require container isolation"
  │
  ├─ Osabio spawns Docker container:
  │   → Mount worktree as volume
  │   → Network restricted to localhost
  │   → Resource limits (CPU, memory, timeout)
  │
  ├─ Command runs inside container
  │
  └─ Result returned to agent
```

This is not an agent framework feature. It's a tool execution policy. Osabio's policy graph decides *whether* to sandbox, and the tool executor handles *how*.

### NVIDIA OpenShell

NVIDIA OpenShell (March 2026) provides kernel-level sandboxing for agent tool execution. It treats skills as behavioral units that can be scanned and restricted. Osabio's architecture aligns with this — skills are governed graph nodes, tools execute inside policy-controlled sandboxes.

If OpenShell matures, Osabio can use it as the sandbox backend instead of Docker. The tool interface doesn't change — only the executor.

---

## 8. The Full Agent Stack

```
Humans
  │
  ├─ Osabio UI (chat, feed, graph view, skill library, policy management)
  ├─ Osabio CLI
  └─ MCP (coding agents: Cursor, Claude Code, etc.)
       │
       ▼
  Osabio Server
  ├─ Identity & Auth (OAuth 2.1, DPoP, RAR)
  ├─ Orchestrator (session lifecycle, task assignment)
  ├─ LLM Proxy (the universal control point)
  │   ├─ Tool injection (per-agent: can_use ∩ skill_requires)
  │   ├─ Context injection (graph state + skills + learnings)
  │   ├─ Tool call interception + execution
  │   │   ├─ Local: filesystem, shell, git (sandboxed)
  │   │   ├─ Context: graph read/write
  │   │   └─ Integration: brokered credentials (connected_account → vault)
  │   ├─ Policy enforcement (intent → governs_tool/governs_skill → authorize/deny)
  │   ├─ Spend tracking (token budgets + API call budgets)
  │   └─ Trace recording (every tool call → graph node)
  ├─ Observer (contradiction detection, skill evolution)
  └─ MCP Server (context tools only, for external scripts/CI)
       │
       ▼
  Sandbox (optional, policy-driven)
  ├─ Git worktrees (file isolation — default)
  ├─ Docker containers (process isolation — when policy requires)
  └─ WASM / OpenShell (memory/kernel isolation — future)
```

No external agent framework in this stack. Osabio owns every layer from human interaction to tool execution.

---

## 9. What About OpenClaw Compatibility?

Osabio does not need to implement the OpenClaw Gateway Protocol. The Gateway Protocol was designed for OpenClaw clients talking to an OpenClaw gateway. If Osabio is the runtime, there is no gateway.

However, Osabio can still serve OpenClaw's existing user base through the path that already works: **MCP**.

```
OpenClaw CLI → spawns agent → agent connects to Osabio MCP server
  │
  ├─ get_context (loads graph state)
  ├─ create_observation (logs signals)
  ├─ resolve_decision (checks existing decisions)
  └─ ...all existing MCP tools
```

This requires zero new code. OpenClaw agents call Osabio's MCP server for context and governance. They run their own agent loop and tools. Osabio doesn't need to replace OpenClaw for users who want to keep using it — it just governs them.

The native runtime (Osabio running agents directly via AI SDK) is for users who want Osabio to be the whole stack. MCP compatibility is for users who want Osabio as a sidecar to their existing tools.

Both paths coexist. No Gateway Protocol needed for either.

---

## 10. Comparison: External Framework vs. Native Runtime

| Aspect | OpenClaw through Osabio (Gateway Protocol) | Osabio native (AI SDK + tools) |
|--------|-------------------------------------------|-------------------------------|
| Moving parts | 3 (client + Osabio + OpenClaw runtime) | 1 (Osabio) |
| Protocol coupling | Must track Gateway Protocol v3+ evolution | None — Osabio defines its own tool interface |
| Auth | Two systems bridged (Ed25519 + DPoP) | One system (DPoP) |
| Context injection | Intercept or proxy | Native — Osabio builds the prompt |
| Tool governance | Bridged via exec approval protocol | Native — policy graph evaluates directly |
| Skill injection | Must push skills into external runtime | Native — skills are part of prompt construction |
| Trace recording | Reconstruct from gateway events | Native — Osabio records as it executes |
| Latency | Extra hop (Osabio ↔ OpenClaw) | Direct (Osabio → LLM) |
| Complexity | ~2000 lines of gateway protocol code | ~500 lines of tools |
| Ecosystem access | OpenClaw CLI, web UI, mobile, Mission Control | Osabio UI, Osabio CLI, MCP |

The native runtime is simpler, faster, and more capable. The only trade-off is ecosystem access — but Osabio's MCP server already covers the integration case.

---

## 11. Schema Changes Required

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

### MCP Tool Gateway Tables + Policy Relations

```sql
DEFINE TABLE mcp_tool SCHEMAFULL;
DEFINE FIELD name ON mcp_tool TYPE string;
DEFINE FIELD toolkit ON mcp_tool TYPE string;
DEFINE FIELD description ON mcp_tool TYPE string;
DEFINE FIELD input_schema ON mcp_tool TYPE object FLEXIBLE;
DEFINE FIELD auth_type ON mcp_tool TYPE string
  ASSERT $value IN ["none", "oauth2", "api_key", "bearer"];
DEFINE FIELD risk_level ON mcp_tool TYPE string
  ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD workspace ON mcp_tool TYPE record<workspace>;
DEFINE FIELD status ON mcp_tool TYPE string
  ASSERT $value IN ["active", "disabled"];
DEFINE FIELD created_at ON mcp_tool TYPE datetime;
DEFINE INDEX mcp_tool_workspace ON mcp_tool FIELDS workspace;
DEFINE INDEX mcp_tool_toolkit ON mcp_tool FIELDS toolkit;

DEFINE TABLE auth_config SCHEMAFULL;
DEFINE FIELD toolkit ON auth_config TYPE string;
DEFINE FIELD auth_method ON auth_config TYPE string
  ASSERT $value IN ["oauth2", "api_key", "bearer", "basic"];
DEFINE FIELD oauth_client_id ON auth_config TYPE option<string>;
DEFINE FIELD oauth_client_secret ON auth_config TYPE option<string>;
DEFINE FIELD oauth_scopes ON auth_config TYPE option<array<string>>;
DEFINE FIELD oauth_authorize_url ON auth_config TYPE option<string>;
DEFINE FIELD oauth_token_url ON auth_config TYPE option<string>;
DEFINE FIELD workspace ON auth_config TYPE record<workspace>;
DEFINE FIELD created_at ON auth_config TYPE datetime;
DEFINE INDEX auth_config_toolkit ON auth_config FIELDS toolkit, workspace;

DEFINE TABLE connected_account SCHEMAFULL;
DEFINE FIELD identity ON connected_account TYPE record<identity>;
DEFINE FIELD auth_config ON connected_account TYPE record<auth_config>;
DEFINE FIELD status ON connected_account TYPE string
  ASSERT $value IN ["initiated", "active", "expired", "revoked"];
DEFINE FIELD access_token ON connected_account TYPE option<string>;
DEFINE FIELD refresh_token ON connected_account TYPE option<string>;
DEFINE FIELD token_expires_at ON connected_account TYPE option<datetime>;
DEFINE FIELD api_key ON connected_account TYPE option<string>;
DEFINE FIELD scopes_granted ON connected_account TYPE option<array<string>>;
DEFINE FIELD connected_at ON connected_account TYPE datetime;
DEFINE FIELD last_used_at ON connected_account TYPE option<datetime>;
DEFINE INDEX connected_account_identity ON connected_account FIELDS identity;
DEFINE INDEX connected_account_toolkit ON connected_account FIELDS auth_config, identity;

DEFINE TABLE can_use TYPE RELATION IN identity OUT mcp_tool SCHEMAFULL;
DEFINE FIELD granted_at ON can_use TYPE datetime;
DEFINE FIELD granted_by ON can_use TYPE option<record<identity>>;
DEFINE FIELD max_calls_per_hour ON can_use TYPE option<int>;

-- Policy → Tool governance (which policies govern which tools)
DEFINE TABLE governs_tool TYPE RELATION IN policy OUT mcp_tool SCHEMAFULL;
DEFINE FIELD conditions ON governs_tool TYPE option<string>;
DEFINE FIELD max_per_call ON governs_tool TYPE option<float>;
DEFINE FIELD max_per_day ON governs_tool TYPE option<float>;
DEFINE FIELD time_window ON governs_tool TYPE option<string>;

-- Policy → Skill governance (which policies govern which skills)
DEFINE TABLE governs_skill TYPE RELATION IN policy OUT skill SCHEMAFULL;
DEFINE FIELD conditions ON governs_skill TYPE option<string>;
DEFINE FIELD time_window ON governs_skill TYPE option<string>;
```

The `governs_tool` and `governs_skill` relations let policies target specific tools and skills. During intent evaluation, the authorizer queries:

```sql
-- Find policies that govern this tool
SELECT in AS policy FROM governs_tool WHERE out = $tool;

-- Find policies that govern this skill
SELECT in AS policy FROM governs_skill WHERE out = $skill;
```

Example policy rules:

| Policy | Target | Relation | Rule |
|--------|--------|----------|------|
| "no-destructive-without-approval" | `shell_exec` | `governs_tool` | HITL for `rm`, `drop`, `delete` patterns |
| "read-only-github" | `github.*` tools | `governs_tool` | Block `create_*`, `delete_*` actions |
| "spending-limit" | `stripe.create_charge` | `governs_tool` | max_per_call: 100, max_per_day: 500 |
| "business-hours-only" | `slack.send_message` | `governs_tool` | time_window: "09:00-17:00" |
| "senior-only-security" | `security-audit` skill | `governs_skill` | Only identities with `senior` role |
| "no-prod-deploys-friday" | `deploy-to-production` skill | `governs_skill` | time_window: blocks Fri-Sun |

This creates a full governance graph:

```
identity ──can_use──→ mcp_tool ←──governs_tool── policy
identity ──possesses──→ skill ←──governs_skill── policy
                        skill ──skill_requires──→ mcp_tool
```

The authorizer walks all three edges: does the identity have access (`can_use`/`possesses`)? Do any policies constrain this action (`governs_tool`/`governs_skill`)? Does the skill's required toolset satisfy policy constraints?

### Summary

| Change | Type |
|--------|------|
| Add `'native'` to `agent.agent_type` | Migration |
| Add device fields to `agent` | Migration |
| Add `mcp_tool` table | Migration |
| Add `auth_config` table | Migration |
| Add `connected_account` table | Migration |
| Add `can_use` relation | Migration |
| Add `governs_tool` relation | Migration |
| Add `governs_skill` relation | Migration |
| Add `skill` table + relations | Migration |
| All other tables (`identity`, `agent_session`, `trace`) | Unchanged |

---

## 12. Build Order

| Phase | What | Depends On | Effort |
|-------|------|-----------|--------|
| 1 | Local tool functions (filesystem, shell, git) | — | S |
| 2 | Proxy tool injection (resolve identity → can_use → inject tools) | Proxy + intent system | M |
| 3 | Proxy tool call interception (intercept tool_calls, execute, return results) | Proxy | M |
| 4 | Tool governance (governs_tool → policy check per tool call) | Intent system | M |
| 5 | `mcp_tool` + `can_use` schema + per-agent tool resolution | SurrealDB | S |
| 6 | `auth_config` + `connected_account` tables | SurrealDB | S |
| 7 | OAuth2 flow for connected accounts | Auth layer | L |
| 8 | Credential brokerage in proxy (vault lookup → execute → sanitize) | Connected accounts | M |
| 9 | Integration tool executor (HTTP calls with brokered creds) | Credential brokerage | M |
| 10 | Skill schema + `governs_skill` + migration | SurrealDB | S |
| 11 | Skill CRUD routes | Skill schema | M |
| 12 | Skill discovery (BM25 trigger matching) | BM25 infra | M |
| 13 | Skill + tool co-injection in proxy (`skill_requires` → add tools) | Skills + proxy | M |
| 14 | Skill importer (skills.sh / SKILL.md → graph) | Skill schema | M |
| 15 | Sandboxed tool execution (Docker for shell/filesystem) | Local tools | L |
| 16 | Skill evolution (Observer → skill updates) | Observer + skills | L |
| 17 | Connected accounts UI (OAuth connect flow) | Frontend | L |
| 18 | Tool registry + skill library UI | Frontend | L |
| 19 | Osabio CLI (task-scoped agent sessions) | Proxy + tools | L |

**MVP (phases 1-5)**: Any agent routing through Osabio's proxy gets tools injected per-identity, governed by policies. No MCP gateway, no external framework.

**Integrations (phases 6-9)**: Brokered credentials for third-party tools. Agents call GitHub, Slack, etc. without seeing API keys. Proxy executes with vault-stored credentials.

**Skills (phases 10-14)**: Full skill system — discovery, co-injection of skills + tools in proxy, import from skills.sh.

**Production (phases 15-19)**: Sandboxed execution, skill evolution, UI, dedicated CLI.

---

## Sources

- Osabio orchestrator: `app/src/server/orchestrator/`
- Osabio intent authorizer: `app/src/server/intent/authorizer.ts`
- Osabio learning system: `app/src/server/learning/`
- Osabio context builder: `app/src/server/chat/context.ts`
- Osabio proxy: `app/src/server/proxy/anthropic-proxy-route.ts`
- Osabio SSE registry: `app/src/server/streaming/sse-registry.ts`
- Osabio MCP server: `cli/mcp-server.ts`
- [Composio](https://composio.dev) — MCP gateway, brokered credentials pattern, tool catalog
- [Composio architecture research](docs/research/composio-tool-platform-research.md)
- [Vercel AI SDK](https://sdk.vercel.ai/) — agent loop, tool use, streaming
- [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) — kernel-level agent sandboxing
- [skills.sh](https://skills.sh) — 80k+ SKILL.md behavioral instruction sets
- HiClaw — containerized agent architecture with Matrix coordination
- Paperclip OpenClaw adapter — reference for agent lifecycle management
- Previous research: `docs/research/openclaw-gateway-protocol-integration.md`
- Previous research: `docs/research/openclaw-native-gateway-architecture.md`
