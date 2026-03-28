# Problem Validation: Agent Creation

## Discovery State

```yaml
current_phase: "1"
phase_started: "2026-03-28"
interviews_completed: 6
assumptions_tracked: [A1-A22]
decision_gates_evaluated: []
artifacts_created:
  - docs/feature/agent-creation/discover/problem-validation.md
```

## Problem Statement (Hypothesis)

Users managing autonomous organizations in Brain cannot see, create, or configure agents through the UI. All agent types are hardcoded in the schema, and agent management requires direct database manipulation or code changes.

## Assumption Tracker

| # | Assumption | Category | Impact (x3) | Uncertainty (x2) | Ease (x1) | Risk Score | Status |
|---|-----------|----------|-------------|-------------------|-----------|------------|--------|
| A1 | Users need to see all agents in their workspace at a glance | Value | 2 (6) | 2 (4) | 1 (1) | 11 | Untested |
| A2 | Users need custom agent types beyond the 7 hardcoded ones | Value | 3 (9) | 1 (2) | 2 (2) | 13 | VALIDATED |
| A3 | "Creating an agent" means more than metadata -- it includes behavior config (tools, learnings, authority) | Value | 3 (9) | 2 (4) | 2 (2) | 15 | VALIDATED |
| A4 | Users want to assign specific MCP tools to specific agents | Value | 2 (6) | 2 (4) | 1 (1) | 11 | Untested |
| A5 | Authority scope configuration per agent is a must-have, not nice-to-have | Value | 3 (9) | 2 (4) | 1 (1) | 14 | VALIDATED |
| A6 | The hardcoded agent_type enum is a blocker -- it conflates role with runtime model | Viability | 3 (9) | 1 (2) | 2 (2) | 13 | VALIDATED |
| A7 | An agent listing page is more urgent than agent creation | Value | 2 (6) | 2 (4) | 1 (1) | 11 | Untested |
| A8 | Users will configure agents through the UI rather than code/config files | Usability | 2 (6) | 2 (4) | 1 (1) | 11 | VALIDATED |
| A9 | The primary distinction between agents is runtime model (brain-controlled / sandboxed / programmatic), not role | Value | 3 (9) | 1 (2) | 1 (1) | 12 | VALIDATED |
| A10 | External agents MUST be pre-registered in Brain before connecting -- registration is the gateway | Feasibility | 3 (9) | 1 (2) | 2 (2) | 13 | VALIDATED |
| A11 | Authority scopes are assigned per-agent via `authorized_to` relation at creation time, not keyed on agent_type | Feasibility | 3 (9) | 1 (2) | 3 (3) | 14 | VALIDATED |
| A12 | Each runtime type needs different configuration fields (brain: read-only; sandbox: image/env/agents; external: name+description only) | Value | 2 (6) | 1 (2) | 2 (2) | 10 | VALIDATED |
| A13 | Removing agent_type enum requires migration of authority_scope, identity, proxy, and MCP auth paths | Feasibility | 3 (9) | 1 (2) | 3 (3) | 14 | VALIDATED |
| A14 | The `runtime` field (brain/sandbox/external) replaces agent_type as the system-level discriminator | Value | 3 (9) | 1 (2) | 1 (1) | 12 | VALIDATED |
| A15 | External agents connect via the existing LLM proxy (tool injection, credential brokerage, governance) | Feasibility | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |
| A16 | Agent creation flow produces: agent record + identity record + identity_agent edge + member_of edge (existing pattern from identity-bootstrap.ts) | Feasibility | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |
| A17 | Brain agents are read-only in the UI -- users cannot create, edit, or delete them | Usability | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |
| A18 | Sandbox provider config is workspace-level (single provider per workspace), not per-agent | Feasibility | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |
| A19 | Sandbox agent config (image, env vars, agents to install, snapshot/template) lives on the agent record | Feasibility | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |
| A20 | The agents page doubles as an operational dashboard: session history (active/idle/completed) and spawn controls for sandbox agents | Value | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |
| A21 | Workspace scoping for agents is implicit via identity graph (agent <- identity_agent <- identity <- member_of <- workspace), no workspace field on agent table | Feasibility | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |
| A22 | External agents need only a proxy token to connect -- no callback URL, capabilities declaration, or API endpoint registration | Feasibility | 2 (6) | 1 (2) | 1 (1) | 9 | VALIDATED |

## Interview Evidence

### Interview 1: Primary Developer / Workspace Admin (2026-03-28)

**Key Findings:**

1. **The agent_type enum conflates two orthogonal concerns.** The user identified that the current 7-value enum mixes role/purpose (architect, observer, management) with runtime hosting model (mcp, code_agent). These are independent dimensions -- an architect agent could be brain-controlled, sandboxed, or programmatic.

2. **Three runtime models emerged as the real taxonomy:**
   - **Brain-controlled** -- Managed internally by Brain (chat agent, observer, PM agent). Brain owns the lifecycle.
   - **Sandboxed** -- Spawned by the orchestrator in isolated environments (Docker, E2B, Daytona). Brain manages spawn/stream/review but the agent runs externally.
   - **Programmatic** -- Externally written/controlled by the user (Vercel AI SDK, LangChain, etc.). Connects to Brain via MCP or API. Brain does not manage the runtime.

3. **Role/purpose should be free-form, not enumerated.** The agent's name and description carry the semantic meaning. There is no reason to restrict what an agent "is" to 7 predetermined categories.

4. **The hardcoded enum creates real friction.** Every new agent type requires a schema migration, code changes in authority resolution, proxy policy evaluation, MCP auth, and identity bootstrap. This is a multiplicative cost that blocks extensibility.

**Evidence Quality:** Direct past behavior from the primary developer. Not future intent -- this is based on lived experience building and extending the agent system across multiple iterations. The frustration with the enum emerged from concrete attempts to add new agent capabilities.

**Commitment Signal:** The user explicitly asked for the enum to be removed entirely, not just extended -- a strong signal of pain severity.

**Codebase Corroboration (past behavior, not opinion):**
- `authority.ts` resolves permissions through 4 fallback layers, all keyed on `agent_type` string matching
- `authority_scope` table seeds 45+ rows of hardcoded per-type permissions
- `agent-activator.ts` queries agents by `agent_type`
- `proxy/policy-evaluator.ts` filters policies by `agent_type`
- `mcp/auth.ts` reads `agent_type` from JWT claims
- `auth/config.ts` hardcodes `"code_agent"` in OAuth token minting

Impact radius of removing `agent_type`: 6+ server modules, schema, seed data, JWT claims.

### Interview 2: Runtime Field Design (2026-03-28)

**Question:** What field replaces agent_type to distinguish brain/sandbox/external?

**Answer:** A new `runtime` field with three values:
- `brain` -- Brain manages lifecycle internally (observer, chat agent, PM agent)
- `sandbox` -- Brain spawns and manages via Sandbox Agent (Docker, E2B, Daytona)
- `external` -- User-managed, connects to Brain via MCP/API

**Key Insight:** This cleanly separates HOW an agent runs (runtime) from WHAT it does (name, description, learnings, authority). The current enum mixes both. Runtime is a system concern; role is a user concern.

**Evidence Quality:** This is not speculation -- it maps directly to three existing code paths: brain-controlled agents in `agents/`, sandboxed agents via `orchestrator/`, and external agents via `mcp/` and `proxy/`. The user is naming a distinction that already exists in the codebase but was not modeled in the schema.

### Interview 3: External Agent Registration (2026-03-28)

**Question:** How do programmatic/external agents register with Brain?

**Answer:** "It would connect via the LLM proxy -- but the agent itself would still have to be registered in Brain first."

**Key Insights:**

1. **Registration is a hard prerequisite.** External agents cannot connect to the governance model without a pre-existing agent record + identity in Brain. This makes the "create agent" flow the gateway for all non-brain agents.

2. **The connection mechanism already exists.** The LLM proxy (`proxy/anthropic-proxy-route.ts`) already handles tool injection, credential brokerage, and intent-gated governance. External agents plug into this, they do not need a new protocol.

3. **The registration flow creates the governance surface.** When you register an external agent, you are creating: an `agent` record, an `identity` record (type: agent), an `identity_agent` edge, a `member_of` edge to the workspace. This is the existing pattern from `identity-bootstrap.ts` lines 140-186.

**Evidence Quality:** The user described the existing proxy as the connection point, which is corroborated by `proxy/tool-executor.ts` (line 572: `can_use` rate limit check) and `proxy/tool-injector.ts` (line 46: tools resolved from `can_use` edges). The proxy already resolves identity, checks authority, and governs tool access. The missing piece is a user-facing registration flow.

**Commitment Signal:** The user framed registration as a hard prerequisite ("would still have to be registered first"), not a nice-to-have.

---

## Interview 1: Dogfooding (Primary Developer / Workspace Admin)

### Round 1 Questions (Completed)

Questions 1-3 answered. Key insight: the agent_type enum should be removed entirely. The meaningful distinction is runtime model (brain-controlled / sandboxed / programmatic), not role. See Interview Evidence above.

### Round 2 Questions (Completed)

Questions 1-2 (registration) and runtime field answered. See Interviews 2 and 3 above.
Key validations: runtime field (brain/sandbox/external), external agents must pre-register, connection via existing LLM proxy.

### Round 3 Questions (Completed)

Authority model, configuration, and scope questions answered. See Interviews 4-6 below.

Key validations: authority scopes assigned per-agent at creation time via `authorized_to`, brain agents read-only, sandbox config on agent record, provider config at workspace level.

---

### Interview 4: Authority Model Without agent_type (2026-03-28)

**Question:** With agent_type gone, how does authority resolution work? What replaces the 45+ seeded rows?

**Answer:** Authority scopes are assigned per-agent at creation time via the existing `authorized_to` relation (`identity -> authority_scope`). Brain agents keep their current seed defaults. Custom agents (sandbox/external) get scopes configured in the creation form.

**Key Insights:**

1. **Per-identity overrides are the primary mechanism.** The `authorized_to` relation (migration 0020) already supports per-identity authority overrides. For custom agents, these are not "overrides" -- they are the primary assignment. The creation flow creates `authorized_to` edges for each action the agent is permitted.

2. **Brain agents retain seed defaults.** The existing `authority_scope` rows keyed on agent_type (observer, architect, etc.) continue to work for brain-controlled agents. These are read-only and not configurable through the UI.

3. **No template inheritance for custom agents.** Custom agents start with explicitly configured scopes, not inherited defaults. This avoids implicit permission escalation.

**Concrete scenario:** A "compliance auditor" (runtime: external) is created with `create_observation: auto` and `create_decision: propose` authority scopes. When it connects via the proxy and calls `create_observation`, `checkAuthority()` hits Layer 1 (per-identity override via `authorized_to`) and returns `auto`. If it tries `confirm_decision`, no override exists and it falls through to Layer 4 (fail-safe: `blocked`).

**Evidence Quality:** Direct design decision from the primary developer. Corroborated by existing `authorized_to` relation schema (migration 0020) which already implements per-identity overrides. The creation flow extends this pattern rather than inventing a new one.

**Codebase Corroboration:**
- `authority.ts` Layer 1 already queries `authorized_to WHERE in = $identity AND out.action = $action` -- this path works for custom agents without modification
- `authority_scope` migration (0011) seeds defaults keyed on `agent_type` -- these persist for brain agents
- `authorized_to` migration (0020) defines `TYPE RELATION IN identity OUT authority_scope` with unique index on `(in, out)`

### Interview 5: Configuration Per Runtime Type (2026-03-28)

**Question:** What configuration does each runtime type need at creation time?

**Answers:**

1. **Brain agents cannot be created from the UI.** They are code-deployed (observer, PM agent, chat agent). The UI displays them as read-only cards. Validates A17.

2. **Sandbox agent config lives on the agent record.** The values determine what gets passed to the Sandbox Agent SDK at spawn time. Based on the Sandbox Agent SDK docs (sandboxagent.dev/docs/deploy), the common fields across providers are:
   - `image` (optional -- providers have defaults like `rivetdev/sandbox-agent:0.4.2-full`)
   - `env_vars` (key-value pairs to inject into the sandbox)
   - `agents` (which coding agents to pre-install: `claude`, `codex`, etc.)
   - `snapshot` / `template` (provider-specific optimization -- Daytona snapshots, E2B templates)

3. **Sandbox provider is workspace-level, not per-agent.** A workspace picks one provider (local, e2b, daytona, docker) and all sandbox agents use it. Config lives in workspace settings alongside existing fields like `evidence_enforcement`.

4. **External agents need only name + description + runtime + authority scopes.** A proxy token is issued at registration. No callback URL, capabilities declaration, or API endpoint needed. The proxy handles everything when the agent connects.

**Evidence Quality:** Design decisions corroborated by existing code:
- `dependencies.ts` already boots Sandbox Agent SDK from config (`config.sandboxAgentEnabled`)
- `sandbox-adapter.ts` defines `CreateSessionRequest` with `env` field for passing env vars
- Workspace settings route (`workspace-routes.ts:712-868`) already handles GET/PUT for workspace-level config
- Proxy token flow exists in `proxy/` routes

**Sandbox Agent SDK Provider Comparison (from docs):**

| Provider | SDK import | Key config | Notes |
|----------|-----------|-----------|-------|
| Local | `sandbox-agent/local` | `port`, `log`, `env` | Dev only, subprocess |
| E2B | `@e2b/code-interpreter` | `template`, `create.envs` | Auto-provisions, snapshots for perf |
| Daytona | `@daytonaio/sdk` | `create.envVars`, snapshot name | Tier 3+ required, `rivetdev/sandbox-agent` default image |
| Docker | `dockerode` | `Image`, `Env`, `HostConfig` | Not recommended for production isolation |

### Interview 6: Agents Page Scope (2026-03-28)

**Question:** What is the interaction model for the agents page?

**Answer:** The agents page is both a registry and an operational dashboard.

**Agent card behavior by runtime:**

| Runtime | Card shows | Actions |
|---------|-----------|---------|
| Brain | Name, description, authority scopes | View only |
| Sandbox | Name, config, session list (active/idle/completed) | Spawn session, edit, delete |
| External | Name, description, connection status | Edit, delete |

**Session list per sandbox agent:**
- Active sessions (`spawning`/`active`) -- live status
- Idle sessions (`idle`) -- waiting for human input, with resume/feedback action
- Completed/aborted/error sessions -- historical

**Key insight:** The session list reuses the existing `agent_session` table which already has `orchestrator_status` (`spawning | active | idle | completed | aborted | error`). No new schema needed for session tracking.

**Evidence Quality:** Direct design decision. Corroborated by existing `agent_session` schema (surreal-schema.surql:201-231) which already tracks `orchestrator_status`, `stream_id`, `last_event_at`, `error_message`, and `last_feedback`. The UI surfaces data that already exists in the graph.

---

## Proposed Schema Changes

### Agent table (replace current)

```sql
DEFINE TABLE agent SCHEMAFULL;
DEFINE FIELD name ON agent TYPE string;
DEFINE FIELD description ON agent TYPE option<string>;
DEFINE FIELD runtime ON agent TYPE string ASSERT $value IN ['brain', 'sandbox', 'external'];
DEFINE FIELD model ON agent TYPE option<string>;
DEFINE FIELD managed_by ON agent TYPE record<identity>;
DEFINE FIELD created_at ON agent TYPE datetime;

-- Sandbox-specific config (ignored for brain/external)
DEFINE FIELD sandbox_config ON agent TYPE option<object>;
DEFINE FIELD sandbox_config.image ON agent TYPE option<string>;
DEFINE FIELD sandbox_config.env_vars ON agent TYPE option<object> FLEXIBLE;
DEFINE FIELD sandbox_config.agents ON agent TYPE option<array<string>>;
DEFINE FIELD sandbox_config.snapshot ON agent TYPE option<string>;
DEFINE FIELD sandbox_config.template ON agent TYPE option<string>;
```

### Workspace settings addition

```sql
-- Add to workspace table
DEFINE FIELD settings.sandbox_provider ON workspace TYPE option<string>
  ASSERT $value IS NONE OR $value IN ['local', 'e2b', 'daytona', 'docker'];
DEFINE FIELD settings.sandbox_provider_config ON workspace TYPE option<object> FLEXIBLE;
```

### Agent creation flow (transactional)

```
1. CREATE agent { name, description, runtime, model?, sandbox_config?, managed_by, created_at }
2. CREATE identity { type: "agent", ... }
3. RELATE identity -> identity_agent -> agent
4. RELATE identity -> member_of -> workspace
5. For each authority scope: RELATE identity -> authorized_to -> authority_scope
```

### Dropped field

```sql
-- REMOVE FIELD agent_type ON agent;
-- agent_type replaced by: name (role identity) + runtime (system discriminator)
```

## Impact Radius

Removing `agent_type` requires changes in:

| Module | Current usage | Migration path |
|--------|--------------|----------------|
| `iam/authority.ts` | 4-layer fallback keyed on `agent_type` | Layer 2-3 fall through to Layer 1 (`authorized_to`) for custom agents; brain agents retain seed rows |
| `authority_scope` seed data | 45+ rows keyed on agent_type strings | Keep for brain agents, custom agents use `authorized_to` only |
| `reactive/agent-activator.ts` | Queries `agent.agent_type` for LLM classification | Query `agent.name` + `agent.description` instead |
| `proxy/policy-evaluator.ts` | Filters policies by `agent_type` | Filter by agent identity or runtime |
| `mcp/auth.ts` | Reads `agent_type` from JWT claims | Read agent identity, resolve runtime from agent record |
| `auth/config.ts` | Hardcodes `"code_agent"` in OAuth token minting | Resolve from agent record at token mint time |
| `agent_session.agent` field | Stores `agent_type` string | Store agent record ID or name |
| Learning system | `WHERE agent_type = $type` | Target by agent record ID or name |
