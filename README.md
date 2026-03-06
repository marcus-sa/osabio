# Brain

**Brain is an agent-native business operating system.**

It turns conversation, implementation, and decisions into a living knowledge graph that both humans and agents can use as shared memory.

Instead of repeating context every session, teams and coding agents read from and write to the same graph of:
- projects and features,
- tasks and dependencies,
- decisions and constraints,
- open questions,
- observations and suggestions.

## The Bet

Most AI workflows are stateless. Great outputs, weak continuity.

Brain is built on a different assumption:
- chat is the interface,
- graph is the memory,
- feed is the governance layer,
- agents are collaborators, not isolated tools.

## Product Loop

Brain is organized around four surfaces:

1. `Chat` — think, plan, decide, and delegate with tool-using agents.
2. `Graph` — inspect relationships, provenance, dependencies, and conflicts.
3. `Feed` — review what requires human judgment (blocking/review/awareness).
4. `MCP` — bring the same context into coding agents (Claude Code, Cursor, Aider, Codex).

## What Brain Unlocks

- Persistent multi-agent memory across sessions
- Cross-project reasoning on top of shared context
- Decision governance (provisional -> confirmed)
- Better handoffs between product, engineering, and autonomous agents
- Fewer repeated prompts and fewer “why did we choose this?” dead ends

## Capability Map

### Core Platform

- Conversational workspace bootstrap and ongoing planning
- Knowledge graph entities for projects/features/tasks/decisions/questions/observations/suggestions
- Provenance-aware linking from messages, documents, and commits
- Governance feed with tiered prioritization
- Interactive graph views (workspace/project/focused)

### Agent System

- Thin orchestration chat agent with tool calling
- PM subagent for planning, organization, and dependency tracking
- Analytics subagent for graph-level analysis and aggregation
- Shared tool layer for search, status, decision workflows, observations, suggestions, and work-item creation

### Coding-Agent Integration

- Built-in MCP server (`brain mcp`)
- CLI workflow (`brain init`, hooks, repo mapping, session lifecycle)
- Agent session capture and graph updates through MCP endpoints

### Unified IAM (Identity + Authority)

- Identity resolution to unify one person across chat, GitHub, Slack, calendar, and MCP identities
- Authority model to control what each actor can do (create provisional decisions, confirm decisions, create tasks, resolve observations, etc.)
- Person-first attribution so actions are traceable to human or agent context

### Direction

Brain is designed as a long-lived business memory layer, not a point solution. Ongoing focus areas include deeper autonomous workflows, richer context packets, and broader integrations (commits, docs, external systems) without breaking the graph-first core.

## Architecture

```text
Human + Agent Inputs
  -> Chat Orchestrator (tools + subagents)
      -> PM Agent / Analytics Agent
      -> Graph Query + Write Layer
  -> Governance Feed (blocking/review/awareness)
  -> Graph UI (entities, edges, provenance)

Coding Agents
  -> MCP stdio server (brain mcp)
  -> Authenticated MCP HTTP API
  -> Same SurrealDB knowledge graph

Identity + Authority
  -> Unified IAM layer (person resolution + scoped permissions)
  -> Human and agent actions attributed to person/workspace context
```

### Stack

- Runtime: Bun + TypeScript
- Frontend: React + TanStack Router
- Agent orchestration: Vercel AI SDK
- Database: SurrealDB (document + graph + vector)
- Protocol: Model Context Protocol (MCP)

## Self-Hosting

Brain is intentionally self-host-friendly.

### Infrastructure footprint

- **Required datastore:** SurrealDB
- **No Redis / no Kafka / no separate vector DB required**
- App runtime: single Bun server process

SurrealDB can be run:
- as a standalone service (recommended), or
- embedded when you want a tighter single-node deployment model.

### Inference options

Brain supports both hosted and local inference:
- OpenRouter (hosted)
- Ollama (local)

For local/private deployments, you can run Brain + SurrealDB + Ollama on one machine.

## IAM: Unified Identity + Authority

Brain includes IAM as a core platform layer, not an add-on.

IAM solves two hard problems:
- **Identity resolution:** unify many external identities into one `person` entity
- **Authority controls:** enforce who can perform which actions, under what conditions

### Core concepts

- One `person`, many identities (`platform`, `github`, `slack`, `google`, `mcp`, etc.)
- Person records are created through explicit identity actions (workspace owner, OAuth link, invite), not LLM extraction
- Resolution chain:
1. exact provider ID match
2. email match
3. candidate suggestion flow for ambiguous display-name matches
4. unresolved reference when no safe match exists

### Agent auth patterns

1. **Platform-managed agents**: first-class actors operating under workspace-defined authority
2. **User-local agents**: tools like Claude Code/Cursor operating as an extension of a specific human with scoped permissions

### Authority model

Authority is action-scoped and actor-scoped, with permission levels such as:
- `auto`
- `provisional`
- `propose`
- `blocked`

This enables governance patterns like:
- agents can create provisional decisions,
- humans confirm final decisions,
- high-risk actions can be blocked or forced through review.

### IAM rollout shape

1. **Phase 1 (MVP):** core person identity, authority scopes, enforcement in chat tools and MCP write routes
2. **Phase 2:** OAuth 2.1 for MCP auth, richer multi-source identity linking, configurable authority UI
3. **Phase 3:** multi-user workspaces and role-based access

## Quickstart

### 1. Prerequisites

- Bun `>=1.3`
- Docker (for SurrealDB)
- Either:
  - OpenRouter API key, or
  - local Ollama runtime + models

### 2. Install dependencies

```bash
bun install
```

### 3. Start SurrealDB

```bash
docker compose up -d surrealdb surrealdb-init
```

`surrealdb-init` imports `schema/surreal-schema.surql` into `brain/app`.

### 4. Configure environment

#### Option A: OpenRouter profile

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

#### Option B: Ollama profile (local inference)

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

### 5. Apply migrations

```bash
bun migrate
```

### 6. Run the app

```bash
bun run dev
```

Open `http://localhost:3000`.

## API At A Glance

- `POST /api/workspaces` create workspace + bootstrap conversation
- `POST /api/chat/messages` send message (supports file attachments)
- `GET /api/chat/stream/:messageId` stream events (token/extraction/assistant/done)
- `GET /api/workspaces/:workspaceId/feed` governance feed
- `GET /api/graph/:workspaceId` graph overview/project/focused views
- `GET /api/entities/search` full-text entity search
- `POST /api/mcp/:workspaceId/context` intent-based MCP context resolution

## MCP + CLI

Brain ships a CLI and MCP server:

```bash
bun run build:cli
# compiled binary: ./brain
```

Initialize a repository:

```bash
BRAIN_SERVER_URL=http://localhost:3000 \
BRAIN_WORKSPACE_ID=<workspace-id> \
brain init
```

`brain init` configures:
- repo auth (`~/.brain/config.json`)
- `.mcp.json` (`brain mcp`)
- `.claude/settings.json` hooks
- `CLAUDE.md` integration block
- Brain slash commands + git hooks

Run MCP directly:

```bash
brain mcp
```

## Useful Scripts

```bash
bun run dev                         # run app with watch
bun run start                       # run app
bun run typecheck                   # TS checks
bun test tests/unit/                # deterministic unit tests
bun test --env-file=.env tests/smoke/  # smoke/integration tests
bun run eval                        # eval suite (real model calls)
bun run eval:watch                  # eval watch mode
bun migrate                         # apply schema migrations
```

## Repository Map

```text
app/
  server.ts                     # Bun entrypoint
  src/client/                   # chat/feed/graph UI
  src/server/                   # runtime, routes, agents, tools, graph/extraction domains
cli/                            # brain CLI + MCP stdio server
schema/
  surreal-schema.surql          # base schema
  migrations/                   # versioned schema migrations
tests/
  unit/                         # deterministic tests
  smoke/                        # server + db integration tests
evals/                          # model eval suites + scorers
```

## Contribution Principles

- No `null` in domain data; omit absent optional fields instead
- Fail fast on invalid state; avoid silent fallback masking
- Use `RecordId` objects for Surreal identifiers internally
- Keep schema changes in versioned `schema/migrations/*.surql` and apply with `bun migrate`

## Status

Brain is actively developed and intentionally opinionated. We prioritize shipping a coherent agent-native operating model over bolting AI onto legacy CRUD patterns.
