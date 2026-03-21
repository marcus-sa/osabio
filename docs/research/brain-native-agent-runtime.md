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

## 5. MCP Tool Gateway: Brokered Credentials + Intent Governance

Brain should expose **all** tools — filesystem, shell, git, and third-party integrations — through a single MCP gateway. Agents never see API keys. Every tool call passes through the intent system. This is Composio's architectural insight applied to a knowledge graph backend.

### The Brokered Credentials Pattern

The core security principle: **LLMs must never see raw credentials**. An agent that can read its own system prompt can leak any API key embedded in it. The solution is credential brokerage — Brain holds the secrets, agents hold tool handles.

```
Agent calls: github.create_issue({ repo: "brain", title: "Bug fix" })
  │
  ├─ Agent sends tool call to Brain (no credentials attached)
  │
  ├─ Brain MCP gateway:
  │   ├─ 1. Identify agent (DPoP-bound identity)
  │   ├─ 2. Lookup connected account (agent's GitHub OAuth token)
  │   ├─ 3. Refresh token if expired
  │   ├─ 4. Create intent: { action: "github:create_issue", requester: identity }
  │   ├─ 5. Evaluate against policy graph
  │   ├─ 6. Execute API call with brokered credentials
  │   └─ 7. Return sanitized result (no tokens in response)
  │
  └─ Agent receives: { issue_number: 42, url: "..." }
      (never saw the GitHub token)
```

### Schema: Tool Registry + Connected Accounts

The `mcp_tool` table (already referenced by `skill_requires`) becomes the tool registry. Connected accounts store per-identity credentials:

```sql
-- Tool definitions (the catalog)
DEFINE TABLE mcp_tool SCHEMAFULL;
DEFINE FIELD name ON mcp_tool TYPE string;                    -- "github.create_issue"
DEFINE FIELD toolkit ON mcp_tool TYPE string;                 -- "github"
DEFINE FIELD description ON mcp_tool TYPE string;
DEFINE FIELD input_schema ON mcp_tool TYPE object FLEXIBLE;   -- JSON Schema for parameters
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

-- Auth configs (how to authenticate with a service — reusable across identities)
DEFINE TABLE auth_config SCHEMAFULL;
DEFINE FIELD toolkit ON auth_config TYPE string;               -- "github"
DEFINE FIELD auth_method ON auth_config TYPE string
  ASSERT $value IN ["oauth2", "api_key", "bearer", "basic"];
DEFINE FIELD oauth_client_id ON auth_config TYPE option<string>;
DEFINE FIELD oauth_client_secret ON auth_config TYPE option<string>;  -- encrypted at rest
DEFINE FIELD oauth_scopes ON auth_config TYPE option<array<string>>;
DEFINE FIELD oauth_authorize_url ON auth_config TYPE option<string>;
DEFINE FIELD oauth_token_url ON auth_config TYPE option<string>;
DEFINE FIELD workspace ON auth_config TYPE record<workspace>;
DEFINE FIELD created_at ON auth_config TYPE datetime;

DEFINE INDEX auth_config_toolkit ON auth_config FIELDS toolkit, workspace;

-- Connected accounts (per-identity credentials for a service)
DEFINE TABLE connected_account SCHEMAFULL;
DEFINE FIELD identity ON connected_account TYPE record<identity>;
DEFINE FIELD auth_config ON connected_account TYPE record<auth_config>;
DEFINE FIELD status ON connected_account TYPE string
  ASSERT $value IN ["initiated", "active", "expired", "revoked"];
DEFINE FIELD access_token ON connected_account TYPE option<string>;   -- encrypted at rest
DEFINE FIELD refresh_token ON connected_account TYPE option<string>;  -- encrypted at rest
DEFINE FIELD token_expires_at ON connected_account TYPE option<datetime>;
DEFINE FIELD api_key ON connected_account TYPE option<string>;        -- encrypted at rest
DEFINE FIELD scopes_granted ON connected_account TYPE option<array<string>>;
DEFINE FIELD connected_at ON connected_account TYPE datetime;
DEFINE FIELD last_used_at ON connected_account TYPE option<datetime>;

DEFINE INDEX connected_account_identity ON connected_account FIELDS identity;
DEFINE INDEX connected_account_toolkit ON connected_account FIELDS auth_config, identity;

-- Which tools an identity is authorized to use
DEFINE TABLE can_use TYPE RELATION IN identity OUT mcp_tool SCHEMAFULL;
DEFINE FIELD granted_at ON can_use TYPE datetime;
DEFINE FIELD granted_by ON can_use TYPE option<record<identity>>;
DEFINE FIELD max_calls_per_hour ON can_use TYPE option<int>;
```

### How It Differs from Composio

| Aspect | Composio | Brain |
|--------|----------|-------|
| **Tool registry** | Cloud-hosted catalog (1000+ pre-built) | Graph-native (`mcp_tool` nodes in SurrealDB) |
| **Credential storage** | Proprietary vault (cloud) | `connected_account` table (self-hosted, encrypted) |
| **Authorization** | External policy engine (unclear implementation) | Intent system + policy graph (existing, versioned) |
| **Audit trail** | Gateway logs | Graph-native traces (hierarchical, queryable) |
| **Tool discovery** | Action name lookup | BM25 search + skill-based discovery |
| **Governance** | Rate limits + HITL | Rate limits + HITL + policy graph + authority scopes + RAR |
| **Deployment** | Cloud (Composio hosts execution) | Self-hosted (Brain hosts everything) |
| **Custom tools** | Limited (pre-built catalog) | First-class (define any tool as a graph node) |

Brain's advantage: the tool gateway is not a separate service — it's part of the knowledge graph. Tool definitions, credentials, permissions, policies, and audit trails are all graph nodes connected by edges. A query can answer "which tools did agent X use on task Y, authorized by policy Z, using credentials from account W."

### Tool Categories

Brain's MCP gateway exposes three categories of tools:

#### Local Tools (no credentials needed)

Filesystem, shell, git — these execute on Brain's host or in a sandbox. No brokered credentials, but still governed by intents:

| Tool | Risk Level | Default Policy |
|------|-----------|---------------|
| `read_file` | low | Auto-approve |
| `write_file` | low | Auto-approve |
| `edit_file` | low | Auto-approve |
| `glob` | low | Auto-approve |
| `grep` | low | Auto-approve |
| `shell_exec` | medium | Policy-dependent (safe commands auto-approve, destructive commands require approval) |
| `git_commit` | medium | Auto-approve |
| `git_push` | high | Require approval |

#### Context Tools (Brain-native, no credentials)

Graph operations that read/write Brain's knowledge graph:

| Tool | Risk Level |
|------|-----------|
| `get_context` | low |
| `search_entities` | low |
| `create_observation` | low |
| `resolve_decision` | low |
| `create_decision` | medium |
| `update_task_status` | medium |

These already exist as MCP tools. No change needed.

#### Integration Tools (brokered credentials)

Third-party service integrations where Brain holds the API keys:

| Toolkit | Example Tools | Auth Type |
|---------|--------------|-----------|
| GitHub | `create_issue`, `create_pr`, `merge_pr`, `add_comment` | OAuth2 |
| Slack | `send_message`, `create_channel`, `list_channels` | OAuth2 |
| Linear | `create_issue`, `update_status`, `list_projects` | API key |
| Stripe | `create_charge`, `list_invoices`, `refund` | API key |
| Gmail | `send_email`, `search_inbox`, `create_draft` | OAuth2 |
| Custom API | Any REST endpoint defined as an `mcp_tool` node | Bearer / API key |

Each integration tool call flows through:
1. Identity resolution (who is calling)
2. Connected account lookup (their credentials for this service)
3. Token refresh (if OAuth, automatic)
4. Intent creation + policy evaluation
5. API call with brokered credentials
6. Sanitized response (strip any credential artifacts)
7. Trace recording (tool call → trace node in graph)

### The MCP Gateway as Single Endpoint

Instead of agents configuring N separate MCP servers, Brain exposes one:

```json
{
  "mcpServers": {
    "brain": {
      "command": "brain",
      "args": ["mcp"],
      "env": {
        "BRAIN_SERVER_URL": "http://localhost:3000",
        "BRAIN_WORKSPACE_ID": "<workspace-id>"
      }
    }
  }
}
```

This single MCP server provides:
- All local tools (filesystem, shell, git)
- All context tools (graph read/write)
- All integration tools (GitHub, Slack, Linear, etc.)
- Skill-aware tool provisioning (skills declare which tools they need)
- Policy enforcement on every call
- Credential brokerage for all integration tools
- Full trace recording

One connection. All tools. No API keys exposed.

### Connected Account Lifecycle

```
1. Admin configures auth_config for "github" toolkit:
   → OAuth2 client_id, client_secret, scopes
   → Stored encrypted in Brain's database

2. Identity connects their GitHub account:
   → Brain initiates OAuth2 flow
   → User authorizes in browser
   → Brain receives access_token + refresh_token
   → Stored in connected_account (encrypted)
   → Status: "active"

3. Agent calls github.create_issue:
   → Brain looks up connected_account for this identity + toolkit
   → Token expired? Auto-refresh using refresh_token
   → Execute API call with fresh token
   → Update last_used_at

4. Token revoked externally:
   → Next API call fails with 401
   → Brain marks connected_account status: "expired"
   → Agent receives error: "GitHub connection expired, re-authorize"
   → User re-authorizes via Brain UI
```

### Why This Must Be in Brain (Not a Sidecar)

If tool execution lives outside Brain:
- Credentials are in two places (Brain + sidecar) — larger attack surface
- Tool calls bypass the intent system — no policy enforcement
- Traces are disconnected — can't link tool calls to decisions and tasks
- Spend tracking is blind to tool costs (API calls with rate limits)
- The Observer can't detect tool misuse patterns

If tool execution lives inside Brain:
- One credential vault, one policy enforcement point, one audit trail
- Every tool call is a graph event — observable, traceable, governable
- Skills can declare tool requirements and Brain verifies availability before activation
- Rate limits and budgets are enforced at the same layer as token spend

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

The 80k+ skills in the `skills.sh` ecosystem are SKILL.md files (YAML frontmatter + Markdown body). Brain can import them:

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

## 8. The Full Agent Stack

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
  MCP Tool Gateway (single endpoint, brokered credentials)
  ├─ Local Tools
  │   ├─ Filesystem (read, write, edit, glob, grep)
  │   ├─ Shell (exec with policy-governed sandboxing)
  │   └─ Git (status, diff, log, commit)
  ├─ Context Tools
  │   └─ Brain Graph (get_context, create_observation, resolve_decision)
  └─ Integration Tools (credentials never exposed to agent)
      ├─ GitHub (create_issue, create_pr, merge_pr)
      ├─ Slack (send_message, list_channels)
      ├─ Linear, Stripe, Gmail, Custom APIs
      └─ Auth: connected_account → auth_config → vault
       │
       ▼
  Sandbox (optional, policy-driven)
  ├─ Git worktrees (file isolation — default)
  ├─ Docker containers (process isolation — when policy requires)
  └─ WASM / OpenShell (memory/kernel isolation — future)
```

No external agent framework in this stack. Brain owns every layer from human interaction to tool execution.

---

## 9. What About OpenClaw Compatibility?

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

## 10. Comparison: External Framework vs. Native Runtime

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
| 1 | Filesystem tools (read, write, edit, glob, grep) | AI SDK | S |
| 2 | Shell tool (exec with timeout, cwd) | — | S |
| 3 | Git tools (status, diff, log, commit) | — | S |
| 4 | Tool governance (policy check before execution) | Intent system | M |
| 5 | Orchestrator integration (tools registered in agent loop) | Orchestrator | M |
| 6 | `mcp_tool` table + tool registry schema | SurrealDB | S |
| 7 | `auth_config` + `connected_account` tables | SurrealDB | S |
| 8 | OAuth2 flow for connected accounts | Auth layer | L |
| 9 | Credential brokerage (vault lookup → execute → sanitize) | Connected accounts | M |
| 10 | `can_use` authorization (tool access per identity) | Tool registry | M |
| 11 | Integration tool executor (HTTP calls with brokered creds) | Credential brokerage | M |
| 12 | Skill schema + migration | SurrealDB | S |
| 13 | Skill CRUD routes | Skill schema | M |
| 14 | Skill discovery (BM25 trigger matching) | BM25 infra | M |
| 15 | Skill injection into context builder | Context builder | M |
| 16 | Skill → tool provisioning (`skill_requires` → `can_use`) | Skills + tools | M |
| 17 | Skill importer (skills.sh / SKILL.md → graph) | Skill schema | M |
| 18 | Sandboxed shell execution (Docker) | Shell tool | L |
| 19 | Skill evolution (Observer → skill updates) | Observer + skills | L |
| 20 | Connected accounts UI (OAuth connect flow) | Frontend | L |
| 21 | Tool registry + skill library UI | Frontend | L |
| 22 | Brain CLI (task-scoped agent sessions) | Orchestrator + tools | L |

**MVP (phases 1-5)**: Brain runs agents with local tools (filesystem, shell, git), governed by policies. No external framework.

**Tool Gateway (phases 6-11)**: MCP tool registry with brokered credentials. Agents call GitHub, Slack, etc. without seeing API keys. Every call through the intent system.

**Skills (phases 12-17)**: Full skill system — discovery, injection, tool provisioning, import from skills.sh.

**Production (phases 18-22)**: Sandboxed execution, skill evolution, UI, dedicated CLI.

---

## Sources

- Brain orchestrator: `app/src/server/orchestrator/`
- Brain intent authorizer: `app/src/server/intent/authorizer.ts`
- Brain learning system: `app/src/server/learning/`
- Brain context builder: `app/src/server/chat/context.ts`
- Brain proxy: `app/src/server/proxy/anthropic-proxy-route.ts`
- Brain SSE registry: `app/src/server/streaming/sse-registry.ts`
- Brain MCP server: `cli/mcp-server.ts`
- [Composio](https://composio.dev) — MCP gateway, brokered credentials pattern, tool catalog
- [Composio architecture research](docs/research/composio-tool-platform-research.md)
- [Vercel AI SDK](https://sdk.vercel.ai/) — agent loop, tool use, streaming
- [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) — kernel-level agent sandboxing
- [skills.sh](https://skills.sh) — 80k+ SKILL.md behavioral instruction sets
- HiClaw — containerized agent architecture with Matrix coordination
- Paperclip OpenClaw adapter — reference for agent lifecycle management
- Previous research: `docs/research/openclaw-gateway-protocol-integration.md`
- Previous research: `docs/research/openclaw-native-gateway-architecture.md`
