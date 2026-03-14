# Brain

**The operating system for autonomous organizations.**

Your agents have amnesia. They can't talk to each other. You spend 80% of your time as a high-paid secretary, copy-pasting context between them. Brain is the self-correcting knowledge graph that gives your agents shared memory, governed autonomy, and verifiable intent.

---

## The Problem

You are the integration layer between your AI agents.

You already use AI agents. Your coding agent writes your code. Your chat assistant helps you think through architecture. Your editor agent autocompletes. But none of them share context.

- Copy error logs from CI into your coding agent
- Relay architecture decisions from a chat into your codebase
- Manually track what was decided, what's blocked, what changed
- Re-explain project state every time you start a new session
- Context-switch between tools, losing continuity at every step

Every agent you add makes it worse. Brain fixes this — not by replacing your agents, but by giving them shared memory.

## Architecture

Why a graph, not a message bus. Most platforms try "agent swarms" — agents messaging agents. That creates a game of telephone where instructions get distorted. The graph is the single source of truth.

```text
Human Layer
  → Web Chat / Feed / Graph View / Learning Library / Terminal

Agent Layer
  → Architect / Strategist / Management / Coding (MCP) / Design Partner / Observer

Graph Layer
  → Projects / Decisions / Tasks / Observations / Features / Questions
  → Suggestions / Conversations / Commits / Intents / Learnings
  → Objectives / Behaviors / Traces / Policies

Auth Layer
  → OAuth 2.1 / RAR (RFC 9396) / DPoP (RFC 9449) / Better Auth IdP

Integration Layer
  → GitHub / Slack / Git Hooks / MCP Protocol / ERC-8004
```

| Approach | Agent swarms / message buses | Knowledge graph (Brain) |
|----------|------------------------------|------------------------|
| Logic | Scripted workflows (if A, do B) | State-based graph (emergent logic) |
| Memory | Ephemeral, session-based | Persistent, pruned, versioned |
| Coordination | Agents message agents (telephone game) | Agents read/write to shared truth |
| Verification | Assumes API calls work | Continuous telemetry (reality grounding) |
| Autonomy | "Let it rip" (high risk of loops) | Authority scopes (risk-managed) |
| Over time | Performance degrades | System gets smarter via learnings |
| Security | Sandbox isolation (the "box") | Governance graph + sandbox (the "brain") |
| Auditing | Log-based (text dumps) | Graph-based (hierarchical traces, machine-readable) |

## Specialized Agents

Each agent has a role, a domain, and authority scopes. They coordinate through the knowledge graph — not through you.

- **Architect** — Technical decisions, system design, architecture constraints. Checks implementations against what was decided. Resolves conflicts between competing approaches.
- **Strategist** — Market positioning, pricing, GTM, competitive response. Challenges product decisions against business viability.
- **Management** — Task tracking, priority management, execution velocity. Flags blocked work, stale decisions, and resource conflicts.
- **Coding Agents (via MCP)** — Your existing tools (Cursor, Aider, Codex, Claude Code) connected to the graph. Context injected on session start. Decisions, observations, and questions flow back automatically.
- **Design Partner** — Brainstorms product ideas, asks probing questions, identifies gaps. Shapes vague ideas into structured projects, features, and decisions.
- **Observer** — Continuously scans the graph for contradictions between decisions, stale tasks, status drift, and cross-project conflicts. Findings are verified through LLM reasoning pipelines with confidence scoring and evidence tracking. A peer review layer cross-validates observations to prevent false positives. Synthesizes recurring patterns into actionable suggestions. Proposes learnings from root cause analysis so the system self-corrects.

## How Coordination Works

No agent messages another agent. They write structured signals to the knowledge graph. The graph makes it visible to the right agent at the right time.

1. **Coding agent notices a contradiction.** While implementing rate limiting, a coding agent detects that `src/billing/api.ts` uses REST — but the graph has a confirmed decision to standardize on tRPC. It logs an observation.
2. **Architect agent sees it on next context load.** The Architect checks the observation against constraints. Confirms the contradiction is real. Generates a suggestion: "Migrate billing API to tRPC, or revisit the standardization decision."
3. **Suggestion surfaces in your feed.** You see the suggestion with full provenance — the observation, the contradicted decision, the Architect's reasoning. You accept it. A migration task is created with one click.
4. **Next coding session picks up the task.** The migration task appears in the coding agent's context. It decomposes into subtasks, works through them, and status rolls up automatically. No human copied anything between tabs.

## Key Concepts

- **Decisions** — Every decision is tracked — who made it, why, and what alternatives were considered. Agents propose. Humans confirm.
- **Observations** — Agents surface contradictions, gaps, patterns, and risks as they work. Observations accumulate and compound into actionable suggestions.
- **Suggestions** — Agents tell you what you should be thinking about. Accept a suggestion and it becomes a task, decision, or feature — with full trace back to the evidence.
- **Projects, Features & Tasks** — Work breaks down hierarchically. Agents decompose tasks at runtime. Status rolls up automatically.
- **Questions** — When an agent doesn't know, it asks instead of guessing. You answer. The answer becomes a decision in the graph.
- **Conversations** — Every chat produces structured knowledge. Conversations group by project automatically.
- **Commits** — Code is linked to the decisions and tasks it implements. Contradictions are caught before they land.
- **Intents** — Every agent action starts as an intent — a structured request in the graph. Intents carry the full authorization context and are evaluated against authority scopes before execution.
- **Authority Scopes** — Control what each agent can do without asking. Start restrictive. Expand trust over time.
- **Learnings** — Behavioral rules injected into agent prompts at runtime via JIT loading with token budgets. Learnings follow a lifecycle (`proposed` → `active` → `deactivated`) and can be created by humans, suggested by agents, or proposed by the Observer from root cause analysis. Three-layer collision detection prevents duplicates. Pattern detection identifies recurring issues and suggests learnings automatically. The Learning Library UI lets you browse, filter, approve, edit, and deactivate learnings across all agents.
- **Objectives** — Strategic goals that give agent work direction. Objectives link to projects, features, and tasks — providing alignment context for every intent. Progress is computed by graph-traversing linked intents. The Observer audits for orphaned decisions and stale objectives via coherence scans.
- **Behaviors** — Measurable behavioral expectations attached to objectives. Each behavior has a scoring function (LLM-evaluated or definition-matched), trend analysis (drift, improvement, flat-line detection), and a bridge to the learning system that proposes corrective learnings when scores decline. Behaviors feed into policy enforcement — the Authorizer checks behavior scores before granting intent authorization. Workspace admins define behavior definitions with configurable scoring criteria, thresholds, and remediation guidance.
- **Identity** — One person across all tools. Your Slack, GitHub, and terminal sessions all resolve to the same identity.
- **Agent Sessions** — Every session is remembered. The next agent knows what the last one did.
- **Traces** — Every agent execution is a graph-native call tree. Subagent spawns, tool calls, and decisions form a hierarchical trace you can traverse, query, and audit. Forensic debugging is a graph query, not grep.
- **Policies** — Deterministic governance rules stored as graph nodes, not prompt text. Each policy carries typed rules, scopes, and approval requirements. The Authorizer evaluates intents against the policy graph before minting tokens — no prompt rewriting needed.

## Reliability: Solving the Three Drifts

Autonomous systems don't fail from lack of intelligence. They fail from drift — slow divergence between what the system believes and what's actually true.

- **Context Drift** — Decisions made in v1.0 become poison for v2.0. Brain uses temporal decay — nodes that aren't referenced lose weight over time. The Observer continuously scans for contradictions between decisions, verifies them with LLM reasoning, and synthesizes patterns into learnings that prevent repeat mistakes.
- **Authority Drift** — Too autonomous = dangerous. Too locked down = a dashboard. Brain uses tiered authority scopes — from zero-human atomic actions to multi-model consensus for high-stakes moves. Agents operate within risk budgets, not permission checkboxes.
- **Reality Drift** — If the Brain only reads its own graph, it's a delusion engine. The Observer performs truth audits — verifying claims against actual state through LLM verification pipelines with confidence scoring. Peer review cross-validates findings. When reality diverges from the graph, the system triggers a desync alert.

## Verifiable Autonomy

Most autonomous platforms are black boxes. Brain is a signed logic trace. Every decision, every dollar, every line of code has a provenance chain back to the intent that authorized it.

- **Governance telemetry** — Every decision is a node with a UUID, author, timestamp, and reasoning. Auditors can query the graph directly.
- **Signed intent chains** — When an agent spends money or merges code, the graph records which intent authorized it, which authority scope permitted it, and which human approved it.
- **Hierarchical traces** — Agent executions are graph-native call trees. A subagent spawn becomes a root trace; each tool call, message, and decision is a child node. Traverse the full execution path with a graph query — from intent to final action.
- **Policy-as-graph** — Governance rules are structured nodes with typed rules, scopes, and approval requirements. The Authorizer evaluates intents against the policy graph before minting tokens — deterministic, auditable, and updateable without touching a single prompt.
- **The "Judge" pattern** — High-stakes actions go through an Authorizer Agent that validates intents against policy constraints before minting scoped tokens. The worker never sees master keys.

## Open Source

The knowledge graph that coordinates your agents shouldn't be a black box you rent. It should be infrastructure you own, inspect, and extend.

- **Full source access** — Graph engine, MCP server, agent prompts, extraction pipeline. Every line.
- **No vendor lock-in** — Your data lives in your SurrealDB instance. Export anytime. Migrate anytime.
- **Extend everything** — Custom agent types, observation categories, feed cards, MCP tools.
- **Community-driven** — Agent prompts, authority scope templates, and integrations contributed by users.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Graph | SurrealDB |
| Backend | Bun (`Bun.serve`) · TypeScript |
| Frontend | React · Tiptap · Reagraph |
| Auth | Better Auth · OAuth 2.1 · RAR · DPoP |
| LLM | Provider-agnostic (OpenRouter · Ollama · BYO keys) |
| Agents | MCP Server · Git Hooks |

## Connect in 60 Seconds

```bash
# One-time workspace setup
$ brain init
# Opens browser → authenticate → approve scopes
# ✓ Connected to workspace

# Start a task-scoped session
$ brain start task:implement-rate-limiting
# Context: 3 decisions, 2 constraints, 1 open question
# Task status: todo → in_progress

# Or just open your MCP-compatible coding agent
$ codex
# SessionStart → project context loaded
# 4 decisions · 2 tasks · 1 recent observation
```

## Quickstart

### 1) Prerequisites

- Bun `>=1.3`
- Docker (for SurrealDB)
- Either:
  - OpenRouter credentials, or
  - Ollama runtime + local models

### 2) Install dependencies

```bash
bun install
```

### 3) Start SurrealDB

```bash
docker compose up -d surrealdb surrealdb-init
```

### 4) Configure environment

#### OpenRouter profile

```bash
OPENROUTER_API_KEY=your_openrouter_key
CHAT_AGENT_MODEL=<chat-model-id>
EXTRACTION_MODEL=<extraction-model-id>
ANALYTICS_MODEL=<analytics-model-id>
PM_AGENT_MODEL=<pm-model-id>
OBSERVER_MODEL=<observer-model-id>
BEHAVIOR_SCORER_MODEL=<behavior-scorer-model-id>
OPENROUTER_EMBEDDING_MODEL=<embedding-model-id>
EMBEDDING_DIMENSION=1536
EXTRACTION_STORE_THRESHOLD=0.6
EXTRACTION_DISPLAY_THRESHOLD=0.85
SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_USERNAME=root
SURREAL_PASSWORD=root
SURREAL_NAMESPACE=brain
SURREAL_DATABASE=app
PORT=3000
```

#### Ollama profile

```bash
INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
CHAT_AGENT_MODEL=<ollama-chat-model>
EXTRACTION_MODEL=<ollama-extraction-model>
ANALYTICS_MODEL=<ollama-analytics-model>
PM_AGENT_MODEL=<ollama-pm-model>
OBSERVER_MODEL=<ollama-observer-model>
BEHAVIOR_SCORER_MODEL=<ollama-behavior-scorer-model>
EMBEDDING_MODEL=<ollama-embedding-model>
EMBEDDING_DIMENSION=1536
EXTRACTION_STORE_THRESHOLD=0.6
EXTRACTION_DISPLAY_THRESHOLD=0.85
SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_USERNAME=root
SURREAL_PASSWORD=root
SURREAL_NAMESPACE=brain
SURREAL_DATABASE=app
PORT=3000
```

### 5) Apply migrations

```bash
bun migrate
```

### 6) Run the app

```bash
bun run dev
```

Open `http://localhost:3000`.

## API at a Glance

- `POST /api/workspaces` create workspace + bootstrap conversation
- `POST /api/chat/messages` send message (supports file attachments)
- `GET /api/chat/stream/:messageId` stream events
- `GET /api/workspaces/:workspaceId/feed` governance feed
- `GET /api/graph/:workspaceId` graph views
- `GET /api/entities/search` full-text entity search
- `POST /api/mcp/:workspaceId/context` intent-based MCP context resolution
- `POST /api/workspaces/:workspaceId/observer/scan` trigger Observer graph scan
- `GET /api/workspaces/:workspaceId/observer/observations` list Observer findings
- `GET /api/workspaces/:workspaceId/learnings` list learnings (filterable by status, type, agent)
- `POST /api/workspaces/:workspaceId/learnings` create a learning
- `PUT /api/workspaces/:workspaceId/learnings/:id` edit a learning
- `POST /api/workspaces/:workspaceId/learnings/:id/approve` approve a proposed learning
- `POST /api/workspaces/:workspaceId/learnings/:id/dismiss` dismiss a proposed learning
- `POST /api/workspaces/:workspaceId/learnings/:id/deactivate` deactivate an active learning
- `POST /api/workspaces/:workspaceId/objectives` create an objective
- `GET /api/workspaces/:workspaceId/objectives` list objectives
- `GET /api/workspaces/:workspaceId/objectives/:id` get objective detail
- `PUT /api/workspaces/:workspaceId/objectives/:id` update an objective
- `DELETE /api/workspaces/:workspaceId/objectives/:id` delete an objective
- `GET /api/workspaces/:workspaceId/objectives/:id/progress` get objective progress
- `POST /api/workspaces/:workspaceId/behaviors` create a behavior
- `GET /api/workspaces/:workspaceId/behaviors` list behaviors
- `PUT /api/workspaces/:workspaceId/behaviors/:id` update a behavior
- `DELETE /api/workspaces/:workspaceId/behaviors/:id` delete a behavior
- `POST /api/workspaces/:workspaceId/behaviors/score` score a behavior
- `POST /api/workspaces/:workspaceId/behaviors/definitions` create a behavior definition
- `GET /api/workspaces/:workspaceId/behaviors/definitions` list behavior definitions
- `PUT /api/workspaces/:workspaceId/behaviors/definitions/:id` update a behavior definition
- `DELETE /api/workspaces/:workspaceId/behaviors/definitions/:id` delete a behavior definition

## MCP + CLI

Build CLI:

```bash
bun run build:cli
# outputs ./brain
```

Initialize repo integration:

```bash
BRAIN_SERVER_URL=http://localhost:3000 \
BRAIN_WORKSPACE_ID=<workspace-id> \
brain init
```

`brain init` sets up:
- `~/.brain/config.json` auth entry
- `.mcp.json` server registration
- `.claude/settings.json` hooks
- `CLAUDE.md` integration block
- Brain slash commands and git hooks

Run MCP directly:

```bash
brain mcp
```

## Useful Scripts

```bash
bun run dev
bun run start
bun run typecheck
bun test tests/unit/
bun test --env-file=.env tests/acceptance/
bun run eval
bun run eval:watch
bun migrate
```

## Repository Map

```text
app/
  server.ts                     # Bun entrypoint
  src/client/                   # chat/feed/graph/learning-library UI
  src/server/
    observer/                   # graph scanning, LLM verification, peer review, synthesis
    agents/observer/            # observer agent orchestration + prompt
    learning/                   # learning CRUD, collision detection, pattern detection
    objective/                  # objective CRUD, alignment evaluator, progress tracking
    behavior/                   # behavior telemetry, scorer, definitions, trend analysis
    chat/                       # chat agent, tools, context
    extraction/                 # extraction pipeline
cli/                            # brain CLI + MCP server
schema/
  surreal-schema.surql          # base schema
  migrations/                   # versioned migrations
tests/
  unit/                         # deterministic unit tests
  acceptance/                   # acceptance tests (in-process server + isolated DB)
evals/                          # model eval suites + scorers (incl. observer evals)
```

## Status

Early-stage and actively developed.
