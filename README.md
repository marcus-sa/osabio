# Brain

**Stop being the glue between your AI agents.**

Brain is a shared coordination layer for humans and AI agents. Agents write decisions, tasks, observations, and suggestions to one knowledge graph so context survives across sessions and tools.

---

## The Problem

Most teams are still the integration layer between disconnected agents.

You manually:
- copy error logs and decisions between tools,
- re-explain architecture and project state every session,
- track what changed, what is blocked, and what conflicts,
- reconcile contradictions between implementation and prior decisions.

## Architecture

Brain coordinates through a graph, not agent-to-agent messaging.

```text
Human Layer
  -> Web Chat / Feed / Graph View / Terminal

Agent Layer
  -> Architect / Strategist / Management / Coding Agents / Observer

Graph Layer
  -> Projects / Decisions / Tasks / Observations / Features / Questions / Suggestions / Conversations / Commits

Integration Layer
  -> GitHub / Slack / Git Hooks / OAuth 2.1
```

## Specialized Agents

- Architect: enforces technical decisions and architecture constraints
- Strategist: challenges plans against market and business realities
- Management: tracks priorities, blockers, and execution flow
- Coding agents via MCP: your existing coding tools with shared context
- Design partner: shapes raw ideas into structured project artifacts
- Observer: surfaces stale decisions, conflicts, and missing coverage

## How Coordination Works

1. A coding agent detects a contradiction and writes an observation to the graph.
2. The Architect agent reads that signal and proposes an action.
3. The suggestion appears in your feed with evidence and provenance.
4. You accept it, and the next coding session receives the updated context automatically.

## Key Concepts

- Decisions: proposed by agents, confirmed by humans
- Observations: cross-agent signals for conflicts, risks, and gaps
- Suggestions: actionable proposals grounded in graph evidence
- Projects, features, tasks: hierarchical work planning and execution
- Questions: explicit unknowns instead of hidden assumptions
- Commits: code changes linked to intent and decisions
- Identity: one person across platform, GitHub, Slack, and terminal
- Authority scopes: controlled autonomy (`auto`, `provisional`, `propose`, `blocked`)

## Open Source

- Full source access to graph engine, MCP server, prompts, and extraction pipeline
- No vendor lock-in for your data model
- Extensible agent roles, tools, observation categories, and UI components

## Self-Hosted

- Docker Compose workflow for quick setup
- Single-process Bun runtime with SurrealDB
- Works offline for graph/feed/local tooling
- LLM features can run via local models or networked providers
- Bring your own provider keys; no Brain relay layer required

## Tech Stack

- Runtime + server: Bun (`Bun.serve`) + TypeScript
- Landing page: static `index.html` + handcrafted CSS + vanilla JavaScript
- App frontend: React 19 + TanStack Router + Zustand
- Graph UI: Reagraph + Reaviz
- Agent orchestration: Vercel AI SDK (`ai`)
- Model providers: OpenRouter and Ollama
- Database: SurrealDB (document + graph + vector)
- Protocol: Model Context Protocol (MCP)

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
bun test --env-file=.env tests/smoke/
bun run eval
bun run eval:watch
bun migrate
```

## Repository Map

```text
app/
  server.ts                     # Bun entrypoint
  src/client/                   # chat/feed/graph UI
  src/server/                   # runtime, routes, agents, tools, graph/extraction domains
cli/                            # brain CLI + MCP server
schema/
  surreal-schema.surql          # base schema
  migrations/                   # versioned migrations
tests/
  unit/                         # deterministic unit tests
  smoke/                        # integration tests
evals/                          # model eval suites + scorers
```

## Contribution Principles

- Never emit/persist domain `null`; omit absent optional fields
- Fail fast on invalid state
- Use `RecordId` objects internally for Surreal IDs
- Keep schema changes in versioned migration files and apply with `bun migrate`

## Status

Early-stage and actively developed.
