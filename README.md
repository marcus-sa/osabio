# MVP Build Plan: AI-Native Business Management Platform

**Codename:** Schack Systems / Project Brain
**Date:** February 2026
**Author:** Marcus

---

## 1. Executive Summary

This document outlines the MVP build plan for an AI-native business management platform that transforms unstructured conversations into a structured, living knowledge graph of business decisions, tasks, dependencies, and relationships.

Unlike existing tools that bolt AI onto traditional CRUD interfaces, this platform treats conversation as the primary input method and maintains a persistent graph of organizational state underneath. The core value proposition is cross-project intelligence: automatically surfacing conflicts, dependencies, and opportunities across the entire business context.

### 1.1 Problem Statement

Current AI chat tools (ChatGPT, Claude, etc.) produce great thinking but zero persistent, actionable state. Conversations end as long text threads with no structured outputs feeding into workflows. Existing PM tools (Linear, Notion, Monday) are adding AI as a feature rather than rethinking the core interaction model. No tool currently provides cross-project reasoning — where a decision in Project A automatically surfaces conflicts with Project B.

### 1.2 Solution

A platform with three core views: **chat to think, graph to understand, feed to act.** Users talk naturally about their business, and the system extracts entities (tasks, decisions, people, deadlines, dependencies) into a knowledge graph stored in SurrealDB. The graph enables cross-project conflict detection, dependency tracking, and organizational memory that persists and evolves across all interactions.

### 1.3 Key Differentiators

- Knowledge graph as the product, not the chat
- Cross-project reasoning and conflict detection
- Hybrid storage: structured graph, not raw data (privacy-first)
- Code and commit awareness (GitHub integration)
- Entity mentions and commands as first-class input mechanisms
- MCP server that feeds graph context to coding agents (Claude Code, Cursor, etc.)
- Slack bot as a native input channel — chat where your team already works
- Unified identity layer (IAM) linking people across Slack, GitHub, CRMs, and more

---

## 2. Technology Stack

Every technology choice optimizes for tight integration, minimal moving parts, and the ability to iterate fast during dogfooding.

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Database** | SurrealDB | Graph + vector + document in one system. Eliminates need for Postgres + Pinecone + Neo4j. JS/TS SDK available. |
| **Backend** | TypeScript (Hono) | Same language top-to-bottom. Extraction pipeline is I/O bound (LLM calls), not CPU bound — Node excels here. Hono runs on Node, Deno, Bun, and Cloudflare Workers for future deployment flexibility. Shared types with frontend eliminate serialization bugs. |
| **Chat UI** | Reachat | Same ecosystem as Reagraph (reaviz). Built-in @mentions, /commands, rich text via Tiptap v3. Component catalog for rendering custom entity cards and extraction summaries inline. Suggestions for contextual prompt buttons. Designed for LLM interfaces. |
| **Graph UI** | Reagraph | WebGL graph visualization for React. Path finding, expand/collapse, clustering. Same design language as Reachat. |
| **LLM Layer** | Anthropic / OpenAI API | Powers the extraction pipeline and conversational reasoning. Provider-agnostic architecture. |
| **Streaming** | Vercel AI SDK | Handles LLM streaming protocol between backend and Reachat UI. Native TypeScript — no bridging needed. |
| **MCP SDK** | @modelcontextprotocol/sdk | TypeScript-first SDK for building MCP servers. Same language as backend means the MCP server shares extraction logic and graph queries directly. |
| **Generative UI** | json-render (Vercel Labs) | Constrained generative UI framework. Define a catalog of typed components (Zod schemas), LLM generates JSON that maps to them, streams and renders progressively. Used for the action feed — each feed item (conflict cards, stale commitments, decision reviews) is dynamically composed by the reasoning LLM from graph context, guardrailed to only use components we define. Introduced in Phase 3. |
| **Document Editor** | Tiptap + AI Toolkit | Rich text editor (open-source core, already used inside Reachat for input). AI Toolkit add-on enables LLM agents to make precise, schema-aware edits to documents with streaming, tracked changes, accept/reject diffs, and audit logging. Used for PRD authoring — documents become live projections of graph state, with bidirectional sync between graph entities and document sections. AI edits PRD sections when underlying graph data changes; user edits are extracted back into the graph. Introduced in Phase 3 (PRD flow), expanded in Phase 4. |
| **Styling** | Tailwind + shadcn/ui | Consistent design system. Both Reachat and Reagraph are Tailwind-native. |
| **Testing & Evals** | Evalite + Autoevals + Bun test | Evalite (Vitest-based) for scored LLM evaluations with golden file test cases, tracing, and local web UI. Autoevals (Braintrust) for pre-built LLM scorers (Factuality, ClosedQA). Bun test for deterministic unit tests on all logic around the LLM. Three-layer strategy: unit tests (every commit, no API calls), golden file evals (on prompt changes, ~20 scored cases via Haiku), integration smoke tests (full pipeline). |

### 2.1 Why TypeScript Over Rust

The original plan called for a Rust backend. TypeScript is the better choice for an 8-week MVP build:

- **I/O bound, not CPU bound.** The backend orchestrates: receive message → call embedding API → call LLM → parse JSON → write to SurrealDB → push WebSocket update. This is exactly what Node's event loop handles well. There's no heavy computation to justify Rust's performance overhead.
- **One language, full stack.** Frontend (React), backend (Hono), MCP server, Slack bot SDK, GitHub webhook handlers, Vercel AI SDK — all TypeScript. Zero context switching. Shared type definitions between client and server eliminate an entire class of serialization bugs.
- **Ecosystem density.** Every integration in the MVP has a mature TypeScript library: SurrealDB JS SDK, Octokit (GitHub), Slack Bolt, MCP SDK, Vercel AI SDK. In Rust, several of these would require writing custom HTTP clients or using less-maintained crates.
- **Iteration speed.** During dogfooding, the extraction pipeline prompts and graph schema will change daily. TypeScript's hot-reload and rapid iteration cycle matters more than Rust's compile-time guarantees at this stage.
- **Escape hatch.** If post-MVP scale demands it, specific hot paths (batch extraction, graph traversal) can be rewritten in Rust as isolated services. The architecture doesn't prevent this — it just defers the complexity until it's justified by real load.

### 2.2 LLM Model Strategy & Chat Router

The platform uses different models for different jobs, and routes chat requests through an intent-based router that selects both the **agent mode** (system prompt + tool set) and the **model** (cost/quality tradeoff).

#### Model Assignments

| Job | Model | Rationale |
|-----|-------|-----------|
| **Extraction** (per-message, background) | Claude Haiku 4.5 | Fastest, cheapest. Excellent at structured JSON output. ~$0.25/MTok input / $1.25/MTok output. Runs in background — user never waits. |
| **Chat — Graph lookup** (status, retrieval) | Claude Haiku 4.5 | Simple factual queries against the graph ("what did we decide about auth?", "what tasks are open?") don't need Sonnet-level reasoning. Haiku + graph context is fast and cheap. |
| **Chat — Design Partner** (brainstorm, early-stage) | Claude Sonnet 4.5 | Active co-designer that asks probing questions, challenges assumptions, identifies gaps, helps shape products. Requires judgment and creativity. |
| **Chat — Management Agent** (active projects) | Claude Sonnet 4.5 | Operational assistant using graph query and decision tools. Tracks progress, surfaces conflicts, manages decisions. Default for established projects. |
| **Chat — Deep analysis** (complex reasoning) | Claude Opus 4.5 | Rare premium path for detected high-complexity reasoning: multi-project conflict analysis, architecture trade-off evaluation, strategy synthesis across the full graph. |
| **Reasoning** (feed, conflicts, MCP) | Claude Sonnet 4.5 | Async multi-hop graph reasoning and conflict classification. Latency doesn't matter. |
| **Document editing** (Tiptap AI) | Claude Sonnet 4.5 | PRD generation and schema-aware document edits. |

#### Chat Router

A lightweight intent-based router selects agent mode + model for each chat message. **No extra LLM classification call** — deterministic heuristics only.

**Router inputs:**
- Workspace state (has projects? project status?)
- Conversation state (existing entities, current topic)
- Message text (intent signals)
- User flags (explicit brainstorm request, explicit status request)

**Routing logic:**

```
function routeChatMessage(workspace, conversation, message):

  // 1. Agent mode selection (system prompt + tools)
  if no projects in workspace:
    agentMode = DESIGN_PARTNER
  else if activeProject?.status == "designing":
    agentMode = DESIGN_PARTNER
  else if detectDesignIntent(message):
    // "let's brainstorm", "I have an idea", "what if we...", "help me think through"
    agentMode = DESIGN_PARTNER
  else:
    agentMode = MANAGEMENT_AGENT

  // 2. Model selection (cost/quality)
  if detectLookupIntent(message):
    // "what's the status of", "what did we decide", "show me", "list all"
    model = HAIKU
  else if detectDeepAnalysis(message):
    // "analyze the tradeoffs", "compare approaches across all projects"
    // "what are the second-order effects of"
    model = OPUS
  else:
    model = SONNET  // default fallback

  return { agentMode, model }
```

**Intent detection heuristics (no LLM needed):**

```
LOOKUP_SIGNALS = [
  /^(?:what|show|list|find|get|check)\s+(?:is|are|was|were|the|my|our)/i,
  /\b(?:status|progress|open tasks|active|pending|decided)\b/i,
  /\b(?:remind me|what did we|when did)\b/i,
]

DESIGN_SIGNALS = [
  /\b(?:brainstorm|idea|what if|should we consider|help me think|flesh out|design)\b/i,
  /\b(?:how could|what about|explore|pros and cons|tradeoffs)\b/i,
  /\b(?:I'm thinking|let's figure out|not sure about|new project|new product)\b/i,
]

DEEP_ANALYSIS_SIGNALS = [
  /\b(?:analyze|compare across|second.order|implications|comprehensive|full review)\b/i,
  /\b(?:all projects|entire graph|everything we)\b/i,
]
```

**Ambiguous messages default to Sonnet + current agent mode.** The router is conservative — it only downgrades to Haiku or upgrades to Opus when signals are strong.

#### Agent Modes

Each agent mode defines a **system prompt** and **tool emphasis**, not a different codebase. Both modes share the same graph, tools, and extraction pipeline.

**Design Partner Agent:**

```
System prompt emphasis:
- You are a co-designer helping flesh out ideas and products
- Ask probing questions: who's the user? what's the riskiest assumption?
  how is this different from X? what happens at scale?
- Challenge assumptions constructively
- Identify gaps the user hasn't addressed
- Every question you ask will be stored as a Question entity
- Track which questions have been answered vs still open
- After several turns, summarize: "We've covered X, Y, Z.
  Still open: A, B, C. Want to tackle any of these now?"
- PROACTIVE TASK GENERATION: When you identify gaps, unresolved
  questions, or areas needing investigation, suggest concrete tasks.
  Examples:
  - User mentions pricing but hasn't researched it →
    suggest "Research pricing models for [domain]" (category: research)
  - User picks a technology but flags risk →
    suggest "Evaluate fallback options for [tech]" (category: research)
  - User describes a feature without implementation plan →
    suggest "Design wireframes for [feature]" (category: design)
  - User mentions needing to reach potential users →
    suggest "Identify 10 target users for early feedback" (category: sales)
  Tasks should be specific, actionable, and tagged with a category.
  Present them as suggestions the user can accept, modify, or dismiss.
  Accepted tasks become Task entities in the graph.

Tool emphasis:
- search_entities (find related prior art in graph)
- check_constraints (does this conflict with existing decisions?)
- create_provisional_decision (capture design decisions as they emerge)

Active during:
- Workspace with no projects
- Projects with status: "designing"
- Explicit brainstorm requests
```

**Management Agent:**

```
System prompt emphasis:
- You are an operational assistant for active projects
- Answer questions from graph context
- Surface conflicts and dependencies proactively
- Help manage decisions: resolve, check constraints, create provisional, confirm
- Reference specific entities by name
- Be concise and actionable

Tool emphasis:
- All graph query tools
- All decision tools (resolve, check_constraints, create_provisional, confirm)
- get_project_status (proactive status summaries)

Active during:
- Projects with status: "active" or "building"
- Status checks and operational questions
- Default mode when intent is unclear and projects exist
```

#### Agent-Generated Questions as Graph Entities

When the Design Partner agent asks a question, it becomes a Question entity in the graph:

```
{
  kind: "question",
  text: "Who is the target user for this platform?",
  status: "asked",              // asked → answered → deferred → resolved
  asked_by: "design_agent",
  asked_in: message:xyz,        // the message where the agent asked
  answered_in?: message:abc,    // set when user answers
  answer_summary?: string,      // extracted from user's response
  project?: project:id,
  priority: "blocking" | "important" | "exploratory"
}
```

**Status lifecycle:**
- `asked` → agent posed the question, awaiting user response
- `answered` → user responded in conversation, answer extracted and linked
- `deferred` → user explicitly said "later" or moved on, surfaces in feed
- `resolved` → answer confirmed and linked to a Decision or other entity

**Deferred questions become backlog items.** They appear in the feed. The agent tracks unanswered questions and can resurface them: "You still haven't addressed how multi-tenancy will work — want to tackle that now?"

When the user answers a previously asked question in a later conversation, the extraction pipeline links the answer back to the original Question entity via `resolved_from` on the `extraction_relation` edge.

#### Telemetry

Every routed chat message logs:

```
{
  message_id,
  detected_intent: "lookup" | "design" | "management" | "deep_analysis" | "ambiguous",
  agent_mode: "design_partner" | "management",
  selected_model: "haiku" | "sonnet" | "opus",
  fallback: boolean,           // true if ambiguous → Sonnet
  latency_ms: number,
  input_tokens: number,
  output_tokens: number,
  estimated_cost_usd: number,
  tools_called: string[],
  entities_extracted: number    // from parallel extraction
}
```

This data drives future routing optimization: which intents are misclassified, where is Haiku sufficient, how often does Opus actually help, what's the cost distribution across agent modes.

**Architecture principle:** Extraction and chat are separate LLM calls with a shared graph context step. User sends a message → router selects agent mode + model → system builds graph context (see Chat Agent Graph Awareness in 3.2) → selected model streams response with tools → simultaneously, Haiku processes the same message for entity extraction in the background. If extraction fails or is slow, the chat experience is unaffected. Agent-generated questions are written to the graph by the chat handler after the response streams.

**Provider agnosticism:** The Vercel AI SDK abstracts model providers. If pricing shifts or a competitor model outperforms on extraction (e.g., GPT-4o-mini, Gemini Flash), swap models without changing the pipeline. The extraction prompt uses strict JSON schemas with Zod validation — if the model returns malformed JSON, retry once, then drop silently. Better to miss an extraction than block the pipeline.

### 2.3 Tiptap AI Toolkit: Documents as Graph Projections

Tiptap is already in the stack via Reachat (which uses Tiptap v3 for its rich text input). The AI Toolkit add-on extends this to full document editing with LLM-powered precision editing.

**Core capability:** Define a custom document schema (sections, custom nodes for decisions, dependencies, constraints). The LLM can then make targeted edits to specific sections — streaming changes, showing diffs, with accept/reject workflow. Every edit is auditable.

**How it fits the platform:**

A PRD is a projection of a subgraph into document form. The knowledge graph holds decisions, dependencies, tasks, and constraints as entities. Tiptap + AI Toolkit enables:

1. **Graph → Document:** Render a Feature's subgraph as a structured Tiptap document. Sections map to entity types: goals (from decisions), constraints (from dependencies), open questions (from Question nodes), task breakdown (from linked tasks).
2. **AI updates document from graph changes:** When the graph changes (e.g., a dependency is resolved, a new decision is extracted from chat), the reasoning LLM edits the relevant PRD section via Tiptap AI Toolkit. The user sees tracked changes and can accept/reject.
3. **Document → Graph (bidirectional sync):** When the user manually edits the PRD (adding a constraint, answering a question), the extraction pipeline processes those edits back into the graph — creating or updating entity nodes.
4. **Schema-aware custom nodes:** Define Tiptap nodes that map to graph entity types: `DecisionBlock`, `DependencyBlock`, `QuestionBlock`. These render as interactive components within the document, linked directly to their graph nodes.

**Why not just regenerate markdown:** Regenerating a full document loses user edits, has no diff visibility, and provides no audit trail. Tiptap AI Toolkit gives surgical edits with full transparency — the same UX model that makes Cursor trusted for code editing, applied to business documents.

**Phasing:** Introduced in Phase 3 (PRD questioning flow outputs to Tiptap document). Expanded in Phase 4 (bidirectional sync, custom nodes, multi-document support).

### 3.1 Core Data Model

SurrealDB serves as the single data layer combining three capabilities in one system:

- **Document storage:** raw conversations, messages, and notes with full text
- **Vector embeddings:** semantic search and RAG retrieval across all content
- **Graph relationships:** entities linked by typed, weighted edges

#### Entity Hierarchy

The data model distinguishes between **workspace-level entities** and **project-level entities**. Every entity ultimately traces back to a Workspace, which is the multi-tenant boundary and the root of the entire graph.

```
Workspace (e.g., "Marcus's Brain")
  ├── Person (workspace-scoped, works across projects)
  ├── Conversation (workspace-scoped, can touch multiple projects)
  ├── Meeting (workspace-scoped, subtype of Conversation)
  ├── Initiative (optional strategic goal, e.g., "Expand into EU", "Reduce churn by 30%")
  │    └── Project (serves the initiative)
  └── Project (standalone, no initiative parent)
       └── Feature (e.g., "Extraction Pipeline", "Graph View")
            └── Task / Decision / Question
```

**Scoping rules:**

- **Workspace-level:** Person, Conversation, Meeting, Initiative. These are never scoped to a single project. A person works across projects. A conversation can produce entities in multiple projects. An Initiative groups projects under a strategic goal.
- **Project-level:** Feature, Task, Decision, Question. These belong to a specific project (or feature within a project). The extraction pipeline determines project assignment — users never pick a project before chatting.
- **Write-time enforcement:** `workspaceId` is required on every API write (hard multi-tenant boundary). `projectId` is never required on conversations or people. Project assignment on extracted entities is resolved by the extraction pipeline with confidence scores. Low-confidence assignments are surfaced for user confirmation.
- **Search/context APIs:** Default to workspace-wide. Optional `projectId` filter as a query parameter, not a write constraint. MCP server can scope context to a specific project when a coding agent requests it.

Cross-project intelligence means traversing across Projects *within* a Workspace. The conflict detection engine traverses across all Projects within the same Workspace.

For Phase 1 dogfooding: one Workspace, one Project ("AI-Native Business Management Platform"). But the schema supports multiple from day one — trivial to add now, painful to retrofit later.

#### Entity Types (Graph Nodes)

| Entity | Scope | Description | Key Properties |
|--------|-------|-------------|----------------|
| **Workspace** | Root | Top-level container and multi-tenant boundary. Everything lives inside a workspace. One user can have multiple workspaces (e.g., separating businesses). | name, owner, created_at |
| **Person** | Workspace | A team member or stakeholder. Workspace-scoped because people work across projects. Linked to entities in any project via OWNS, DECIDED_BY, ASSIGNED_TO edges. **Person nodes are authoritative identity records — they are only created through explicit actions (workspace creation, IAM integration, manual invite), never inferred from chat extraction.** When the extraction pipeline detects a name in conversation that doesn't match an existing Person node, it stores the reference as an unresolved string attribute (e.g., `decided_by: "Sarah"`) and optionally surfaces a suggestion: "You mentioned Sarah — want to add her to the workspace?" which triggers the IAM flow. | name, role, contact info, identities[] |
| **Conversation** | Workspace | A chat session or message thread. Workspace-scoped because a single conversation can produce entities across multiple projects. Never requires a projectId. | messages[], embedding, source, timestamp |
| **Meeting** | Workspace | A meeting with transcript (subtype of Conversation). Same scoping rules as Conversation. | title, attendees[], transcript_ref, calendar_event_ref, source_provider, recorded_at |
| **Initiative** | Workspace | A strategic goal or objective the business is working towards. Groups related Projects under a shared purpose. Examples: "Expand into EU market", "Reduce churn by 30%", "Launch self-serve billing". Optional — not every Project needs an Initiative parent. Enables strategic rollup: "what's the status of the EU expansion?" aggregates across all child Projects. The Initiative's description_entries auto-update as child Projects, Decisions, and Features progress. Introduced as an entity type in Phase 1, but active use expected from Phase 3+ when cross-project intelligence makes rollups valuable. | name, status, description_entries[], target_metric, deadline |
| **Project** | Workspace/Initiative | A bounded initiative or workstream. Can optionally belong to an Initiative (the strategic goal it serves). Multiple Projects can serve the same Initiative. Projects without an Initiative parent are standalone. | name, status, description_entries[], created_at |
| **Feature** | Project | A distinct capability or component within a project. Maps to a PRD. Natural grouping layer between Project and Task. | name, status, description_entries[], prd (progressive), owner |
| **Task** | Project/Feature | An actionable commitment with an owner | title, description_entries[], owner, deadline, status, priority, category |
| **Decision** | Project/Feature | A ratified choice with context | summary, rationale, decided_by, decided_at, status (extracted / proposed / confirmed / superseded) |
| **Question** | Project/Feature | An unanswered question or open item | text, assigned_to, status, context |
| **Learning** | Workspace | A behavioral modification for an agent. Human-created learnings are active immediately. Agent-suggested learnings require human approval before activation. Active learnings are injected into the target agent's system prompt during context build. Analogous to CTX's "persistent memory" or Claude Code plugin "instincts," but stored as graph entities with provenance and approval flow. Introduced in Phase 4. | text, target_agent, suggested_by, status (active / pending_approval / dismissed), source_conversation |
| **Suggestion** | Workspace/Project | A proactive observation or recommendation from an agent. Unlike Tasks (work to do), Suggestions are "here's something you should consider" — they may become Tasks, Decisions, Features, or Projects upon acceptance. Agents generate Suggestions by observing graph patterns: stale decisions, missing coverage, cross-project conflicts, priority drift, single points of failure. Suggestions surface in the feed for human review. Accepted Suggestions convert to other entity types with full provenance. This is the building block for an autonomous OS — agents don't just respond to input, they actively observe and propose improvements. Introduced in Phase 3. | text, category (optimization / risk / opportunity / conflict / missing / pivot), rationale, suggested_by, confidence, status (pending / accepted / dismissed / deferred / converted), converted_to, converted_kind, evidence[], scope (task / feature / project / workspace), target, description_entries[] |
| **AgentSession** | Project | A logged coding agent session. Every Claude Code / Cursor / Aider session that connects via the MCP plugin produces a AgentSession entity on session end. Contains a structured summary of what happened: decisions made, questions asked, tasks progressed, files changed. Linked to all entities the agent interacted with via PRODUCED (→ Decision), ASKED (→ Question), and PROGRESSED (→ Task) edges. Makes implementation activity a first-class queryable part of the graph. Introduced in Phase 3. | agent, repo, started_at, ended_at, summary, decisions_made[], questions_asked[], tasks_progressed[], files_changed[] |

#### Living Descriptions (Projects, Features, and Tasks)

Project, Feature, and Task descriptions are **append-only timelines** that auto-update as the graph evolves. Each entry captures what changed, why, and what triggered the change.

**Description entry model:**

```typescript
interface DescriptionEntry {
  text: string;           // the updated description paragraph
  reasoning: string;      // why this edit was made
  triggered_by: string[]; // entity IDs that caused the update (decision, feature, commit, task)
  created_at: datetime;
  model: string;          // which LLM generated it
}

// Project.description_entries and Feature.description_entries are arrays
// The "current description" is the latest entry's text
// The full array is the evolution history
```

**SurrealDB schema:**

```sql
DEFINE FIELD description_entries ON TABLE project TYPE array<object>;
DEFINE FIELD description_entries.*.text ON TABLE project TYPE string;
DEFINE FIELD description_entries.*.reasoning ON TABLE project TYPE string;
DEFINE FIELD description_entries.*.triggered_by ON TABLE project TYPE array<record>;
DEFINE FIELD description_entries.*.created_at ON TABLE project TYPE datetime DEFAULT time::now();
DEFINE FIELD description_entries.*.model ON TABLE project TYPE string;
-- Same schema for feature and task tables
```

**Auto-update triggers (handled in backend after entity changes):**

| Trigger | Applies to | Description entry generated | Example |
|---------|-----------|---------------------------|---------|
| Decision confirmed in project | Project | Incorporate the decision into project description | "Uses JWT with refresh tokens for session management." |
| Feature created in project | Project | Add the feature's scope to project description | "Includes user authentication with login, registration, and password reset." |
| Feature marked complete | Project | Update project description with implementation details | "Auth middleware deployed with rate limiting." |
| Task completed | Feature, Project | Refine description with implementation specifics | "Rate limiting set to 100 req/min per user using token bucket." |
| Commit linked to decision | Project, Feature | Add implementation context | "JWT implementation uses RS256 signing." |
| Decision affects task scope | Task | Update task description with new constraints or approach | "Approach changed: use token bucket instead of sliding window per Decision: Rate limiting strategy." |
| Dependency task completed | Task | Refine task with information from completed dependency | "Auth middleware is ready — implement refresh token rotation against the new JWT endpoint at /api/auth/refresh." |
| Constraint discovered | Task | Add constraint to task description | "Must handle concurrent refresh requests — Decision: Use mutex on token rotation." |
| Project progress changes | Initiative | Rollup child project status into initiative description | "EU expansion 40% complete — GDPR compliance shipped, payment integration in progress, localization not started." |
| Project added to initiative | Initiative | Update initiative scope | "Now includes localization project alongside GDPR compliance and payment integration." |
| Multiple related changes | All | Batch into single entry | Combines several task completions into one coherent description update |

**Generation:** After a triggering event, queue a description update job. The job queries the current description (latest entry), the triggering entity, and relevant context from the graph, then prompts the LLM (Haiku) to generate a new description entry that incorporates the new information. The LLM sees: current description, what changed, and why — it produces a refined description and a one-line reasoning string.

**Description timeline view (UI):** The entity detail panel (Phase 2) and the OS desktop entity window (Phase 4) show the description timeline. Each entry is expandable to show reasoning and the triggering entities (clickable links to those decisions, tasks, commits). The current description is the top-level summary; the timeline below shows how it got there.

```
Project: Auth System
Current: "User authentication system using JWT with refresh 
tokens. Auth middleware deployed with rate limiting at 100 
req/min. Supports login, registration, and password reset."

▼ Description History
  📝 Mar 3 — Added rate limiting details
     Reasoning: Tasks completed: Implement auth middleware, 
     Configure rate limiting
     → task:auth-middleware, task:rate-limiting

  📝 Mar 1 — Added JWT decision context  
     Reasoning: Decision confirmed: Use JWT with refresh tokens
     → decision:jwt-auth

  📝 Feb 28 — Initial description
     Reasoning: Project created from onboarding conversation
     → conversation:onboarding
```

**Phasing:**
- Phase 1: Static description string on projects/features (manual or from extraction)
- Phase 2: Description entry array schema, entity detail panel shows description history
- Phase 3: Auto-update triggers fire on decision/feature/task/commit changes, LLM generates entries

#### Relationship Types (Graph Edges)

| Edge | Connects | Properties |
|------|----------|------------|
| **HAS_PROJECT** | Workspace → Project | added_at |
| **HAS_INITIATIVE** | Workspace → Initiative | added_at |
| **SERVES** | Project → Initiative | added_at (a project serves a strategic initiative — multiple projects can serve the same initiative, and a project can serve multiple initiatives) |
| **HAS_FEATURE** | Project → Feature | added_at |
| **HAS_TASK** | Feature → Task | added_at |
| **OWNS** | Person → Task / Project / Feature | assigned_at |
| **DEPENDS_ON** | Task → Task, Feature → Feature | type (blocks, needs, soft) |
| **DECIDED_IN** | Decision → Conversation | message_ref |
| **BELONGS_TO** | Task / Decision / Question → Feature / Project | added_at |
| **CONFLICTS_WITH** | Decision → Decision, Feature → Feature | description, severity |
| **IMPLEMENTED_BY** | Decision → Commit/PR | commit_sha, pr_url |
| **SUPERSEDED_BY** | Decision → Decision | reason, superseded_at |
| **ATTENDED_BY** | Meeting → Person | role (organizer, attendee, optional) |
| **MEMBER_OF** | Person → Workspace | role (owner, member), joined_at |
| **BRANCHED_FROM** | Conversation → Conversation | branched_at, context_entities[] |
| **TOUCHED_BY** | Project → Conversation | first_mention_at, entity_count (derived from extraction — computed when entities extracted from a conversation are linked to a project) |
| **SUGGESTS_FOR** | Suggestion → any entity | The target entity the suggestion is about (optional — workspace-scoped suggestions may not target a specific entity) |
| **EVIDENCED_BY** | Suggestion → any entity[] | Graph entities that support / triggered this suggestion |
| **CONVERTED_TO** | Suggestion → Task / Decision / Feature / Project | When a suggestion is accepted and converted to another entity type |
| **PRODUCED** | AgentSession → Decision | Decision created during this agent session |
| **ASKED** | AgentSession → Question | Question raised during this agent session |
| **PROGRESSED** | AgentSession → Task | Task whose status changed during this agent session |
| **ANSWERED_BY** | Question → Decision | When a question's answer becomes a confirmed decision |

### 3.2 Extraction Pipeline

The extraction pipeline is the system's core intelligence layer. Every incoming message (chat, commit, or eventually external source) is processed through an LLM that outputs structured graph updates.

#### Pipeline Flow

1. User sends a message in chat or a commit is pushed to GitHub
2. Message is stored as a document in SurrealDB with vector embedding
3. LLM extraction prompt processes the message with surrounding context
4. Extraction outputs structured JSON: entities found, relationships identified, state changes
5. Graph is updated: new nodes created, edges added or modified, conflicts detected
6. If conflicts or notable relationships found, surface them in the user's feed

#### Extraction Prompt Strategy

The extraction prompt receives the **full conversation context** plus relevant graph context and extracts entities from the **current user message only**. It outputs structured JSON with high-confidence extractions. The system errs on the side of missing things rather than creating noise — building trust over time as accuracy proves out.

**Extraction input model:**

```
{
  conversationSummary?   // compressed summary of older messages (when history > 15 messages)
  existingEntities       // entities already extracted from this conversation (graph nodes)
  recentMessages         // last 10-15 messages verbatim (all roles, for context)
  currentMessage         // the specific user message being extracted (role: 'user')
  graphContext           // workspace entities from vector search + graph traversal
}
```

The full conversation history enables **reference resolution**: when a user says "Yes, let's go with that" or "the first option" or "what we discussed earlier," the extraction prompt resolves the reference to its concrete meaning using the conversation history. This applies identically to web chat and Slack threads — the Slack bot receives thread history via the Slack API and passes it through the same extraction input model.

**Token budget strategy for long conversations:** Don't pass every message verbatim. Recent messages (last 10-15) are included verbatim. Older messages are summarized. The graph itself acts as compressed history — entities extracted from earlier messages already exist as nodes, so even summarized messages retain their semantic content through the entity references in `existingEntities`.

**Critical rules:**

- **Only extract from user messages.** Never run extraction on assistant-generated responses — this creates feedback loops where the system re-extracts its own paraphrases of already-captured entities. The conversation history includes assistant messages for *context*, but entities are only created from user messages.
- **Resolve references, don't parrot.** When the user confirms or references something from prior context ("yes", "let's go with that", "sounds good", "the first option"), resolve the reference to produce a descriptive entity name. The entity name should be the resolved concept (e.g., "Use SurrealDB for the graph layer"), not the user's literal words ("let's go with that"). The evidence field captures the user's actual words. The `resolved_from` field links to the original message where the concept was first stated.
- **Person references are resolved, not created.** When a name is detected, match it against existing Person nodes in the workspace. If a match is found, create the appropriate relationship edges (OWNS, DECIDED_BY, etc.). If no match is found, store as an unresolved string attribute on the related entity (e.g., `decided_by_name: "Sarah"`) and flag for a suggestion: "You mentioned Sarah — want to add her to the workspace?" Person nodes are only created through IAM (workspace creation, OAuth, manual invite), never inferred from extraction.
- **Placeholder filtering.** The prompt includes negative examples of non-entities ("my project", "the thing", "this idea"). A server-side blocklist provides a deterministic safety net, dropping known placeholder phrases before persistence.
- **Confidence-gated display.** Store entities at ≥0.6 confidence. Display inline EntityCards at ≥0.85 confidence only. Entities between 0.6–0.85 are stored silently for later corroboration or review.
- **Actionability guard for Tasks.** The prompt distinguishes Tasks (actionable commitments with implicit owner and concrete action verb) from goals/descriptions ("transform conversations into a knowledge graph"). A server-side heuristic checks for action verb presence and reclassifies goal-like text to Feature.
- **Task category classification.** Every Task entity gets a `category` field, LLM-inferred during extraction (not user-assigned). Categories: `engineering` (build, implement, fix, deploy), `research` (investigate, evaluate, compare, explore), `marketing` (outreach, content, positioning, launch), `operations` (setup, configure, process, admin), `design` (wireframe, prototype, UX, visual), `sales` (outreach, demo, pitch, negotiate). The category enables feed filtering ("show all research tasks"), graph clustering by business function, and priority views grouped by category.
- **Adoption-only tool filtering.** Tools/technologies mentioned as competitors or references ("existing PM tools like Linear, Notion") are not extracted. Only tools with adoption signals in the evidence ("we use", "built with", "stored in") create entity nodes.

**Evidence provenance model on `extraction_relation` edges:**

```
{
  evidence: string,           // user's exact words from current message
  evidence_source: MessageId, // the current message being extracted
  resolved_from?: MessageId,  // the earlier message where the referenced concept originated (if different)
  from_text: string,          // resolved entity name
  confidence: number,
  extracted_at: Date,
  model: string               // 'haiku-4.5'
}
```

This provides full provenance: the user confirmed a decision in message 12 (`evidence_source`), but the concept originated in message 1 (`resolved_from`). The complete chain is traceable.

Explicit entity references via @mentions and #project tags bypass the extraction pipeline entirely and create direct graph links, ensuring zero-loss for intentional references.

#### Chat Agent Graph Awareness

The chat agent (Sonnet) needs graph awareness to have useful conversations — "what did we decide about auth?" should return a real answer from the knowledge graph, not "I don't have access to that information." This is achieved through a phased approach: system prompt injection first, graph query tools later.

**Phase 1 — System prompt injection:**

Before each Sonnet call, the system queries the graph and injects relevant context into the system prompt. No tool calling needed — the agent simply *knows* things.

```
async function buildChatContext(conversation, latestMessage, workspaceId):
  1. conversationEntities  → entities already extracted from this conversation
  2. relevantEntities      → semantic search across workspace (top 20-30 entities matching latest message)
  3. projectContext        → active decisions, tasks, open questions for mentioned projects
  4. crossProjectConflicts → entities from OTHER projects that relate to current conversation
  
  → Inject all into system prompt as structured context
```

This covers ~90% of use cases: "what did we decide about X?", "what tasks are open?", "remind me about the auth approach." The answer is already in the injected context window. No tool calling latency, no orchestration complexity.

Cross-project intelligence surfaces naturally here: if the semantic search returns entities from other projects that relate to the current conversation, they're included in the context. The agent can say "By the way, this conflicts with a decision in Project B" — not because it ran a conflict detection tool, but because the conflicting entity was in its context window.

**Phase 2 — Graph query + decision tools:**

When the injected context doesn't cover the user's question — "find all decisions across every project that mention SurrealDB", "what depends on the auth migration?", "show me the full dependency chain" — the agent needs to query the graph dynamically. And when the user asks the agent to make or evaluate decisions — "should I use Postgres or SurrealDB?", "does this conflict with anything?" — the agent needs the same decision tools that coding agents use via MCP (section 3.4).

**Read tools** (graph queries):

```
search_entities({ query, kinds?, project? })        → semantic search across graph
get_entity_detail({ entityId })                       → full details + relationships for one entity
get_project_status({ projectId })                     → active tasks, recent decisions, open questions
get_conversation_history({ query, projectId? })       → search past conversations about a topic
```

**Reason tools** (decision inference):

```
resolve_decision({ question, options?, context })     → infer answer from graph context, return rationale + sources + confidence
check_constraints({ proposed_action, project })       → check proposed action against existing decisions and constraints
```

**Write tools** (decision delegation):

```
create_provisional_decision({ name, rationale, context, options_considered })
  → create provisional decision, surface in feed for human review
confirm_decision({ decision_id })
  → ONLY available to the chat agent (not MCP), because the human is present in the conversation
     and can confirm inline: "Yes, go with that" → agent calls confirm_decision
```

The chat agent has a unique advantage over coding agents: the human is in the conversation. A coding agent creates provisional decisions and moves on; the human reviews later in the feed. The chat agent can present its reasoning, show sources, and ask "Should I confirm this?" — turning a provisional decision into a confirmed one in the same conversational turn. This makes the chat the primary decision governance surface, not just a thinking environment.

The system prompt still provides ambient awareness (current conversation and project state). Tools let the agent go deeper when needed. The agent decides when to use tools based on whether the injected context contains the answer.

**Phase 3 — Unified tool interface:**

The same graph query and decision tools the chat agent uses internally become the MCP tools exposed to coding agents externally. One tool interface, two consumers — with one key difference: coding agents via MCP can create `provisional` and `inferred` decisions but cannot confirm. The chat agent can call `confirm_decision` because the human is present to authorize it.

```
Chat agent (Sonnet)  ─→ graph query + decision tools ←─  Coding agents (via MCP)
                                    ↓
                              SurrealDB graph
                                    ↓
                           Feed (review surface)
```
```

The `resolve_decision` and `create_provisional_decision` MCP tools (section 3.4) are also available to the chat agent, enabling it to answer questions like "should I use REST or tRPC?" by reasoning over the graph — the same way a coding agent would via MCP.

### 3.3 Data Strategy: Store the Graph, Not the Raw Data

The system stores extracted entities, relationships, and metadata in the knowledge graph, but does not warehouse raw communications from external sources. For example, a Slack message that contains a decision becomes a Decision node with a summary, participants, and a reference link back to Slack. The full message body stays in Slack.

**This hybrid approach provides three key benefits:**

- **Privacy:** no sensitive raw data stored; the graph is a semantic index, not a data warehouse
- **Compliance:** easier GDPR/data retention story since original content stays in source tools
- **Sales enablement:** "we don't store your messages, we build a map of your decisions"

### 3.4 MCP Server: Context and Decision Delegation for Coding Agents

Inspired by [ActiveMemory/ctx](https://github.com/ActiveMemory/ctx), the platform exposes an MCP (Model Context Protocol) server that gives coding agents (Claude Code, Cursor, Copilot, Aider) rich project context from the knowledge graph. Where ctx persists context as flat markdown files, our approach serves live, structured context from the graph — decisions, architecture choices, active tasks, open questions, and known constraints — dynamically scoped to whatever the agent is working on.

Beyond read-only context, the MCP server enables agents to **resolve and delegate decisions** back to the graph. Coding agents constantly hit decision points during implementation — "JWT or session-based auth?", "REST or tRPC for this endpoint?", "PRD doesn't specify rate limiting strategy — which approach?" — and currently they either guess, ask the human (breaking flow), or stall. With decision delegation, the agent queries the graph for an answer or creates a provisional decision and keeps moving.

**Three tiers of MCP capability:**

**Tier 1 — Read (context lookup):**
Agent asks: "What was decided about auth approach?" MCP queries the graph, returns: `Decision: JWT with refresh tokens, decided 2 days ago, confidence 0.92`. Agent proceeds. No human involvement.

**Tier 2 — Reason (decision inference):**
Agent asks: "Should this API use REST or tRPC?" MCP queries the graph — finds the project uses tRPC everywhere, finds a Decision "standardize on tRPC for internal APIs," finds a constraint "minimize new dependencies." MCP returns: "Use tRPC. Rationale: existing project standard, explicit decision to standardize, aligns with dependency constraint." Decision is logged as a new node with `status: inferred, inferred_by: mcp, based_on: [decision:tRPC-standard, constraint:minimize-deps]`.

**Tier 3 — Write (provisional decisions):**
Agent hits something genuinely unresolved: "PRD doesn't specify rate limiting strategy." MCP checks graph — no existing decision or constraint covers this. MCP creates a provisional Decision: `rate_limiting: token_bucket, status: provisional, decided_by: agent, rationale: "best fit for bursty API traffic based on [feature:real-time-sync]", options_considered: [token_bucket, sliding_window, fixed_window]`. Decision appears in the feed as a `DecisionReview` card for human confirmation. Agent proceeds without stalling.

**Decision status model:**

| Status | Meaning | Created by | Can be overridden |
|--------|---------|-----------|-------------------|
| `confirmed` | Human explicitly decided | Human via chat/feed | Only by human |
| `provisional` | Agent decided, awaiting review | Agent via MCP | Yes — human confirms, overrides, or refines |
| `inferred` | Derived from existing graph context | MCP reasoning | Yes — human can override |
| `contested` | Conflicts with another decision | System (conflict detection) | Requires human resolution |
| `superseded` | Replaced by a newer decision | System (when new decision overrides) | N/A |

**Governance rule:** Agents can create `provisional` and `inferred` decisions but can never set status to `confirmed`. Only humans confirm decisions. This keeps the human as the authority while letting agents move fast on implementation details.

**MCP tools:**

```
# Tier 1 — Read
get_project_context({ project, scope })
get_active_decisions({ project, area? })
get_task_dependencies({ task_id })
get_architecture_constraints({ project, area? })

# Tier 2 — Reason
resolve_decision({
  question: "REST or tRPC for user API?",
  options: ["REST", "tRPC"],
  context: { project, feature? }
})
→ { decision, confidence, rationale, status: "inferred", sources[] }

check_constraints({
  proposed_action: "Add Redis dependency for caching",
  project
})
→ { conflicts[], proceed: bool, notes }

# Tier 3 — Write
create_provisional_decision({
  name: "Use token bucket for rate limiting",
  rationale: "Best fit for bursty API traffic",
  context: { project, feature? },
  options_considered: string[]
})
→ { decision_id, status: "provisional", review_required: true }
```

**Constraint checking** is particularly powerful: before an agent adds a dependency, changes an approach, or deviates from the spec, it checks the graph for conflicts. The graph knows about decisions made in other projects, constraints defined months ago, and dependency relationships the agent can't see from its code context alone. This is cross-project intelligence applied to agent governance.

**How it works (read path):**

- When a coding agent starts a session, it calls the MCP server with the current repo/project scope
- The server queries SurrealDB, traverses the graph for relevant nodes, and returns a token-budgeted context packet (similar to ctx's `--budget` flag)
- As the agent makes commits, those flow back through the GitHub integration and update the graph — closing the loop

**Why this matters:** Coding agents today start near-zero every session. They re-discover architecture decisions, repeat past mistakes, and lack awareness of business context. By feeding them the knowledge graph, every agent session inherits the full decision history and project state. The agent knows *why* things were built a certain way, not just *how*. With decision delegation, agents also stop stalling on unresolved questions — they make provisional decisions, log them, and the human reviews them in the feed alongside all other pending items.

**Context packet includes:**
- Active decisions and their rationale (including provisional ones from other agents)
- Current task being worked on + dependencies
- Architecture constraints and patterns established
- Recent changes and their context
- Open questions that might affect implementation

**Distribution: Claude Code Plugin (not shell scripts)**

Inspired by [ActiveMemory/ctx v0.6.0](https://ctx.ist/blog/2026-02-16-ctx-v0.6.0-the-integration-release/), the MCP server ships as a **Claude Code marketplace plugin** — not as standalone hook scripts or manual `.claude/hooks/` wiring. ctx's journey from six shell scripts to a two-command plugin install validates this approach: shell scripts are fine for prototyping but wrong for distribution.

The plugin bundles hooks + skills together in a single installable package:

```
Install:
/plugin marketplace add [our-org]/brain
/plugin install brain@[our-org]-brain
```

The plugin's `hooks.json` wires into Claude Code's event system:

```json
{
  "SessionStart": [
    {"command": "brain system load-project-context"}
  ],
  "PreToolUse": [
    {"matcher": ".*", "command": "brain system check-constraints"}
  ],
  "PostToolUse": [
    {"matcher": "Write|Edit", "command": "brain system log-changes"}
  ],
  "UserPromptSubmit": [
    {"command": "brain system inject-context"}
  ],
  "Stop": [
    {
      "type": "prompt",
      "prompt": "Review the conversation for unlogged architecture decisions, unresolved questions, or constraints that should be captured in the knowledge graph. If items are missing, respond with {\"decision\": \"block\", \"reason\": \"Before stopping, log these to the knowledge graph: [list items]\"}. If everything is captured, respond with {\"decision\": \"approve\"}."
    }
  ],
  "SessionEnd": [
    {"command": "brain system capture-session-summary"}
  ]
}
```

Hook behavior:
- `SessionStart` — calls `get_project_context`, injects full decision/constraint state as `additionalContext`
- `PreToolUse` — before every tool call, checks for constraint conflicts via the graph
- `PostToolUse` on `Write|Edit` — logs file changes back to the graph as implementation activity
- `UserPromptSubmit` — enriches every user message with relevant graph context
- `Stop` — prompt-based hook (runs on Haiku) that catches unlogged decisions before session ends
- `SessionEnd` — captures session summary and any final state

Skills ship alongside hooks in the plugin (e.g., `resolve-decision`, `check-constraints`, `create-provisional-decision`), versioned together so there's no drift between what the CLI expects and what the plugin provides.

Key design principles (learned from ctx):
- `brain init` is tool-agnostic — it sets up the graph connection, nothing else. No `.claude/` scaffolding.
- The plugin gives you Claude Code integration. They compose; they don't depend.
- Updates are automatic — pull the plugin, hooks and skills update together.
- Hooks no-op gracefully when the graph connection isn't configured (no errors on fresh clones).

**Complementary with ctx:** Users can run both plugins simultaneously — ctx for session-level memory and local file-based context, our plugin for cross-project business intelligence and decision governance. The `SessionStart` hook injects from both sources.

### 3.5 Slack Bot: Native Input Channel

The platform includes a Slack bot that functions as a direct interface to the knowledge graph, allowing teams to interact with the system where they already work rather than requiring them to context-switch to a separate app.

**Capabilities:**

- **Conversational:** Chat with the bot in DMs or mention it in channels. It has full access to the knowledge graph for answering questions ("what did we decide about pricing?", "what's blocking the API migration?")
- **Passive ingestion:** With permission, the bot monitors designated channels and extracts decisions, tasks, and commitments into the graph. This is where the noise-filtering problem is critical — Slack is ~90% noise, so extraction confidence thresholds must be higher than for direct chat
- **Active commands:** `/brain status project-x` to get a project summary, `/brain decide "use GraphQL for reporting API"` to explicitly record a decision, `/brain task @marcus "implement auth flow" by Friday` to create a tracked task
- **Notifications:** The bot surfaces cross-project conflicts and feed items directly in Slack — hard conflicts as DMs, soft tensions in a dedicated channel

**Architecture:** The Slack bot is a thin client that authenticates via the IAM layer (see 3.7), maps Slack user IDs to Person nodes in the graph, and routes messages through the same extraction pipeline as the web chat. For thread-based conversations, the bot retrieves the full thread history via the Slack API and passes it through the same extraction input model used for web chat (see Extraction Prompt Strategy in 3.2) — `recentMessages` contains the thread history, `currentMessage` is the latest message. This ensures reference resolution ("the first option", "what we discussed") works identically across web chat and Slack threads. Messages processed via Slack get a `source: slack` tag with a reference link back to the original message.

### 3.6 Meeting Intelligence: Transcripts as Graph Input

Meetings are where the highest-density decisions happen — and where they're most likely to be lost. The platform integrates with meeting tools to ingest transcripts and extract structured graph updates.

**Supported Providers (phased):**

| Phase | Provider | Integration Method |
|-------|----------|--------------------|
| Post-MVP | Google Meet | Google Calendar API + Meet transcript export (auto-generated docs in Google Drive) |
| Post-MVP | Zoom | Zoom webhook for recording/transcript events, or cloud recording API |
| Future | Microsoft Teams | Graph API for meeting transcripts |
| Future | Fireflies.ai / Otter.ai | Webhook or API integration as a provider-agnostic fallback |

**Extraction Pipeline for Transcripts:**

Meeting transcripts are significantly different from chat messages — they're long, multi-speaker, and contain a mix of discussion, tangents, and actual decisions. The extraction pipeline for transcripts uses a specialized prompt strategy:

1. **Pre-processing:** Transcript is chunked by speaker turns and topic shifts (using the LLM itself or simple heuristics like silence gaps and topic keywords)
2. **First pass — summary extraction:** LLM generates a structured meeting summary: attendees, topics discussed, decisions made, action items assigned, open questions raised
3. **Second pass — graph mapping:** Each extracted item is matched against existing graph entities. New decisions link to the meeting Conversation node. Action items become Tasks with owners resolved via IAM. Open questions become Question nodes
4. **Speaker attribution:** Speaker labels in the transcript are resolved to Person nodes via IAM identity matching (e.g., "Marcus" in the transcript → Person:marcus via name/voice matching or calendar invite attendee list)
5. **Reference linking:** Each extracted entity stores a timestamp reference into the transcript, so users can jump to the exact moment a decision was made

**Calendar-Aware Context:**

By integrating with Google Calendar (or other providers), the system knows *which* meetings relate to *which* projects. A meeting titled "CARF Platform Sprint Review" auto-links its transcript extractions to the CARF Platform project. Calendar events also provide attendee lists, which pre-populate speaker → Person node mapping before the transcript even arrives.

**Key Design Decisions:**

- Transcripts are processed asynchronously (batch, not real-time) — they arrive after the meeting ends
- Raw transcript text is **not stored** in the graph (consistent with the "store the graph, not the raw data" principle). Only extracted entities, summaries, and timestamp references are stored. The full transcript stays in Google Drive / Zoom cloud
- Users get a notification in the feed after a meeting is processed: "3 decisions, 5 action items, and 2 open questions extracted from your CARF Sprint Review"
- One-click confirm/dismiss for each extracted item, since meeting extraction confidence is lower than direct chat

### 3.7 Identity & Access Management (IAM)

A unified identity layer that links a single Person node in the graph to their identities across all connected external systems. This is foundational infrastructure — without it, "Marcus on Slack" and "marcus-dk on GitHub" and "Marcus W. in HubSpot" are three unrelated strings.

**Identity Resolution:**

- Each Person node has an `identities` array: `[{provider: "slack", id: "U12345"}, {provider: "github", id: "marcus-dk"}, {provider: "hubspot", id: "contact_789"}]`
- When the system ingests a commit from `marcus-dk` on GitHub, it resolves to the same Person node as `@Marcus` mentioned in a Slack thread
- This enables cross-source queries: "show me everything Marcus committed this week alongside the Slack discussions that led to those changes"

**Supported Providers (phased):**

| Phase | Provider | Identity Signal |
|-------|----------|-----------------|
| MVP | Platform (native) | Email / username at signup |
| MVP | GitHub | GitHub username via OAuth |
| Post-MVP | Slack | Slack user ID via bot installation |
| Post-MVP | Google Workspace | Google account via OAuth (Calendar, Meet, Drive) |
| Post-MVP | Linear / Jira | User ID via OAuth |
| Future | Zoom | Zoom user ID via OAuth |
| Future | CRMs (HubSpot, Salesforce) | Contact/user ID via OAuth |
| Future | Microsoft 365 | MS account via OAuth (Teams, Calendar, Outlook) |

**Permissions Model:**
- IAM also governs what graph data each person can see — critical for when the system ingests from multiple Slack channels or repos with different access levels
- Permissions inherit from the source: if you can't see a Slack channel, you can't see graph nodes extracted from it
- Admin controls for who can connect new data sources and who can see cross-project intelligence

### 3.8 Testing Strategy: Evaluating a Probabilistic System

Testing an LLM-backed extraction pipeline requires a fundamentally different approach than testing deterministic code. The output is probabilistic — same input can produce slightly different extractions across runs. The strategy uses three layers, each with different scope, cost, and frequency.

**Layer 1 — Deterministic unit tests (Bun test)**

Test everything *around* the LLM without calling it. This is ~70% of the test surface:

- Schema validation (extraction output matches Zod schema)
- Placeholder blocklist (reject "my project", accept "My Project Manager Tool")
- Confidence gating (store ≥0.6, display ≥0.85)
- Person resolution (match existing → relationship edge, no match → `_name` string, never create Person)
- Evidence validation (evidence snippet on `extraction_relation` edge must appear in source user message text)
- Dedup logic (merge >0.95 similarity, POSSIBLE_DUPLICATE 0.80–0.95, independent <0.80)
- Component block generation (correct EntityCard/ExtractionSummary JSON from extraction results)
- Message role filtering (only `role: 'user'` triggers extraction)

Run on every commit. Zero API cost. Fast.

**Layer 2 — Golden file evals (Evalite + Autoevals)**

~20 curated input messages with scored expected outputs. Assertions are loose (type match + name similarity + confidence range), not exact strings. Covers:

- Entity extraction basics (decisions, tasks, questions, features, projects)
- Person handling invariants (no phantom Person creation, unresolved names stored as strings)
- Placeholder rejection (generic phrases filtered, real names pass)
- Evidence grounding (each entity traceable to user message text)
- Document chunk extraction (multi-entity paragraphs, similar concept dedup)

Custom scorers: entity precision, entity recall, no-phantom-persons, evidence-grounded, no-placeholders. Plus Autoevals Factuality scorer for checking entity names are grounded in input.

Run on prompt changes. Calls real Haiku API. Cached in Evalite watch mode. Cost: negligible (~20 Haiku calls).

**Layer 3 — Integration smoke tests**

End-to-end Bun script hitting the full running stack: create workspace → send message → wait for extraction → verify entities in SurrealDB with correct types, edges, evidence, embeddings → verify no phantom Person nodes → verify component blocks generated → cleanup.

Run before deployments and during dogfooding spot-checks.

**Layer 4 — Eval scoring (post-Phase 1)**

Once enough dogfooding data accumulates, build a larger eval set (100–200 examples) from real conversations, scored on precision, recall, entity type accuracy, relationship accuracy, and false positive rate for Person nodes. Run weekly. Real conversations during dogfooding become the best eval examples — label them as you go.

**Tools:**

| Tool | Role | When |
|------|------|------|
| Bun test | Deterministic unit tests | Every commit |
| Evalite | Scored LLM evals with golden files, tracing, local web UI | On prompt changes |
| Autoevals | Pre-built LLM scorers (Factuality, ClosedQA) | Used within Evalite evals |

---

## 4. Build Phases

The MVP is structured as four two-week phases, designed for dogfooding from day one. Each phase produces a usable increment that informs the next.

---

### Phase 1: Chat + Extraction Loop (Weeks 1–2)

**Goal: Chat interface connected to LLM with real-time entity extraction into SurrealDB.**

1. **SurrealDB setup:** Define schema for all entity types and relationship edges, starting from the Workspace root. Configure vector index (HNSW) for embeddings on message and entity nodes. Write SurrealQL functions for entity retrieval and graph traversal.
2. **TypeScript backend API (Hono):** REST/WebSocket endpoints for chat messages, streaming LLM responses, and graph queries. SurrealDB JS SDK integration. Message persistence and embedding generation (OpenRouter). Shared type definitions with frontend.
3. **Extraction pipeline v1:** LLM prompt (Haiku 4.5) that takes the full conversation context (recent messages verbatim, older messages summarized, existing extracted entities) and extracts from the current user message only. Outputs structured JSON with entities and relationships. Reference resolution: pronouns and callbacks ("that approach", "the first option") resolve to concrete concepts using conversation history. Initial focus on tasks, decisions, and questions. Confidence scoring to filter noise. Extracted relationships stored as `extraction_relation` edges with `{from_text, evidence, evidence_source, resolved_from?, confidence, model}` — full provenance chain from user words to resolved entity name to originating message. Entity and message nodes embedded via OpenRouter for semantic search.
4. **Reachat frontend:** Chat textarea with LLM streaming (Sonnet 4.5). Configure @mention support with entity search against SurrealDB. Two key Reachat features used from day one:

   **Component catalog:** Register custom components that the LLM can render inline in chat messages. Extracted entities appear as rich interactive cards inside the conversation, not just text. Phase 1 catalog:
   - `EntityCard` — extracted entity with type icon, name, status, confidence indicator. Rendered inline when the system confirms extractions.
   - `ExtractionSummary` — batch of EntityCards after document upload or multi-entity extraction. Shows entity count and relationship count.
   - `DuplicatePrompt` — "Did you mean the same 'auth feature'?" with merge/keep action buttons. Surfaces `POSSIBLE_DUPLICATE` entity relations for user resolution.
   - `OnboardingSummary` — end-of-onboarding graph summary showing all captured entities grouped by type, with a confirm/continue action.

   **Suggestions:** Clickable prompt buttons rendered below system messages. The LLM returns suggestions alongside each response. Used throughout onboarding to guide the conversation without forcing form-filling:
   - After first message: "I'll describe my project" / "I have a document to upload" / "I'm running multiple projects"
   - After project captured: "Just me for now" / "I have a small team" / "Let me tell you about key decisions"
   - After threshold met: "Looks good, let's go" / "I want to add more context" / "Show me what you extracted"
   - Post-onboarding in normal chat, suggestions shift to contextual actions: "Create a task for this" / "Add as a decision" / "What depends on this?"

   **Conversation sidebar:** List of conversations grouped by project (derived from `TOUCHED_BY` edges computed during extraction). Auto-generated conversation titles from first extraction or first few messages. New conversation button. Unlinked conversations (no extracted entities or multi-project) grouped separately. Debug panel (collapsed by default) toggleable for entity list and extraction log during dogfooding.
5. **Workspace onboarding conversation:** Creating a workspace collects two fields (workspace name, owner name), creates the root nodes (`workspace:xyz` + `person:owner` + `MEMBER_OF` edge), and drops the user into chat. The chat router (section 2.2) automatically selects the **Design Partner agent** because no projects exist yet. The Design Partner doesn't just record what the user says — it actively helps flesh out the product or business by asking probing questions, challenging assumptions, and identifying gaps. Every question the agent asks becomes a Question entity in the graph (`status: "asked"`, `asked_by: "design_agent"`). When the user answers, the Question updates to `status: "answered"` with the response linked. When the user defers ("I'll figure that out later"), the Question stays `status: "deferred"` and surfaces in the feed as a pending item. Each answer is extracted in real-time and rendered inline using the component catalog. Suggestions guide each turn. Onboarding completes when the graph reaches minimum threshold (≥1 project + ≥1 decision or question — the owner Person already exists from workspace creation) or after 7 guided turns — at which point the system renders an `OnboardingSummary` component showing captured entities and open questions. The router then switches to Management Agent mode for projects with `status: "active"`, while projects still in `status: "designing"` continue using the Design Partner. The user can always trigger Design Partner mode explicitly ("let's brainstorm about X").
6. **Document upload for graph seeding:** Users can optionally drop a document (markdown or plain text in Phase 1) into the onboarding chat to bootstrap a dense initial graph. The document is chunked respecting section boundaries, each chunk runs through Haiku extraction with the same structured JSON output, and entities are deduplicated against existing nodes (embedding similarity + LLM context of current graph state). A plan document like a 400-line MVP spec might yield 50–100 nodes in one shot — features, decisions, dependencies, risks, tech choices — all with relationships. After ingestion, the system summarizes what it extracted and continues the conversation with smarter follow-up questions based on gaps or ambiguities in the document ("Your plan mentions SurrealDB but flags a maturity risk — have you evaluated fallbacks?"). The document doesn't replace the onboarding conversation, it accelerates it. All extracted nodes link back to the source document as provenance. This is not a separate UI — it's a file attachment in the chat, like any messaging app.
7. **Testing infrastructure:** Three-layer testing strategy using Evalite, Autoevals, and Bun test:

   **Layer 1 — Deterministic unit tests (Bun test, every commit, no API calls):** Test all logic around the LLM without calling it. Schema validation (Zod), placeholder blocklist filtering, confidence gating (store ≥0.6, display ≥0.85), person resolution (match existing → edge, no match → `_name` string field, never create Person), evidence validation (evidence on `extraction_relation` edge must appear in source user message), dedup logic (merge >0.95, POSSIBLE_DUPLICATE 0.80–0.95, independent <0.80), component block generation, message role filtering (only extract from `role: 'user'`).

   **Layer 2 — Golden file evals (Evalite + Autoevals, on prompt changes):** ~20 curated input/expected pairs scored by custom scorers: entity precision, entity recall, no-phantom-persons, evidence-grounded, no-placeholders. Uses real Haiku API but cached in watch mode. Covers entity extraction basics, person handling invariants, placeholder rejection, evidence grounding, and document chunk extraction. Autoevals Factuality scorer for checking entity names are grounded in input text.

   **Layer 3 — Integration smoke tests (Bun script, full pipeline):** Hit the running stack end-to-end: health check → create workspace → send message → wait for extraction → assert entity exists with correct type, extraction_relation edge, evidence field, embedding vector → assert no phantom Person nodes → assert component block generated → cleanup.
8. **Dogfooding checkpoint:** Run the onboarding conversation for the dogfooding workspace ("AI-Native Business Management Platform"), uploading this MVP plan as the seed document. Start using the tool to plan and track building the tool itself. Every architecture decision becomes a graph node.

*Deliverable: A working chat with two agent modes — Design Partner (co-designer for early-stage projects, asks probing questions stored as Question entities) and Management Agent (operational assistant for active projects with graph query and decision tools). An intent-based router selects agent mode and model (Haiku for lookups, Sonnet for design/management, Opus for deep analysis) using deterministic heuristics with telemetry. The chat builds a knowledge graph from conversations with extracted entities rendered as rich inline components. Suggestions guide the user. Conversation sidebar groups chats by project. Workspace onboarding uses the Design Partner to flesh out the product, not just record what the user says. Document upload accelerates graph seeding.*

---

### Phase 2: Graph View + Focused Navigation (Weeks 3–4)

**Goal: Visual graph exploration with focused entity views and bidirectional chat-graph linking.**

1. **Reagraph integration:** Render SurrealDB graph data as interactive nodes and edges. Implement focused view: click an entity, see its immediate relationships. Node sizing by activity/importance.
2. **Entity detail panels:** Click a node to see its full context: related conversations, decisions, tasks, open questions. Link back to the original chat message where it was created.
3. **Chat → Graph navigation:** Clicking an inline annotation in chat navigates to that node in the graph. Clicking a conversation reference in the graph jumps to that chat message.
4. **Search and filter:** Full-text and semantic search across the graph. Filter by entity type, project, person, date range.
5. **Chat agent graph + decision tools:** Upgrade the chat agent from system prompt injection only to dynamic graph query tools (`search_entities`, `get_entity_detail`, `get_project_status`, `get_conversation_history`) plus decision tools (`resolve_decision`, `check_constraints`, `create_provisional_decision`, `confirm_decision`). The chat agent can infer decisions from graph context, create provisional decisions, and — uniquely — confirm decisions inline because the human is present in the conversation. Same tool interface later exposed via MCP in Phase 3 (minus `confirm_decision` for coding agents).
5. **Extraction pipeline v2:** Iterate on extraction quality based on real dogfooding data. Tune confidence thresholds. Add relationship strength scoring.
6. **Conversation branching:** Select a message range or click "branch from here" to create a focused sub-conversation. Creates a new Conversation with `BRANCHED_FROM` edge to parent. Branch carries forward relevant graph context (parent's extracted entities pre-loaded for high-confidence project/feature resolution). Branched conversations display as nested under their parent in the sidebar.
7. **Conversation drift detection:** After each extraction, the system checks whether newly extracted entities share any `entity_relation` or project ancestry with the conversation's earlier entities. If the last 3–4 messages produce entities belonging to a different project cluster than the conversation's existing entities, the system surfaces a contextual suggestion: "This seems like a separate thread — branch into a new conversation about [detected topic]?" The suggestion names the new topic based on the most recent extracted entities. If ignored, the system doesn't nag — the entities still get extracted and linked to the correct projects regardless. This is a UX quality signal, not a functional gate. Reinforces the anti-bloat strategy: shorter, focused conversations that map cleanly to projects and produce better graph provenance.

*Deliverable: Two connected views (chat + graph) with bidirectional navigation. The chat agent has full graph query and decision tools — it can search the graph, infer decisions from context, create provisional decisions, and confirm them inline with human approval. Conversation branching enables focused sub-threads. Drift detection suggests branching when conversations become unfocused. The graph is useful for understanding project state at a glance.*

---

### Phase 3: GitHub Integration + Cross-Project Intelligence (Weeks 5–6)

**Goal: Code-aware graph with cross-project conflict detection, IAM foundation, and the action feed.**

1. **GitHub webhook integration:** Ingest commits, PRs, and issues. Extract decisions from commit messages and PR descriptions. Link commits to existing decision nodes (closing the decision → implementation loop).
2. **IAM foundation:** Implement the Person identity resolution layer. Link GitHub usernames to Person nodes via OAuth. Build the identities array model so that a single Person can be resolved across providers. This is prerequisite infrastructure for Slack and all future integrations.
3. **Drift detection:** Compare decisions made in chat with actual code implementations. Flag divergences: "team decided approach A but code implements approach B."
4. **Cross-project reasoning engine:** When a new decision or change is added to any project, traverse the graph for related entities across all projects. Classify results into hard conflicts, soft tensions, and opportunities.
5. **Action feed view (json-render):** The third core view: a daily-driver feed showing what changed, what needs attention, stale commitments, cross-project conflicts, and decisions awaiting input. Built using json-render: define a catalog of feed components (`ConflictCard`, `StaleCommitment`, `DecisionReview`, `QuestionPrompt`, `DependencyAlert`, `SuggestionCard`) with typed props via Zod schemas. The reasoning LLM queries the graph, then generates JSON that maps to these components — each feed item is dynamically composed from graph context but guardrailed to the catalog. Feed items stream and render progressively.
6. **PRD questioning flow (Tiptap AI Toolkit):** AI asks structured questions to flesh out a Feature. Unanswered questions become tracked Question nodes linked to that Feature and assigned to relevant people. The PRD is rendered as a Tiptap document — a live projection of the Feature's subgraph with custom nodes for decisions, dependencies, constraints, and questions. As the graph updates (new decisions from chat, resolved dependencies from commits), the reasoning LLM edits the PRD via Tiptap AI Toolkit, showing tracked changes the user can accept or reject. User edits to the document are extracted back into the graph (bidirectional sync). Features can be created by branching from chat or explicitly via commands.
7. **MCP server v1 + Claude Code plugin:** Expose Tier 1 read tools (`get_project_context`, `get_active_decisions`) plus Tier 2 reasoning tools (`resolve_decision`, `check_constraints`) that coding agents can call. Token-budgeted context packets from the graph. `resolve_decision` queries existing decisions and constraints to answer agent questions; `check_constraints` validates proposed actions against the graph before the agent proceeds. Ship as a Claude Code marketplace plugin (not shell scripts) — hooks + skills bundled, two-command install, automatic updates. `SessionStart` hook injects graph context, `Stop` hook (prompt-based, Haiku) catches unlogged decisions, `PostToolUse` on Write|Edit logs implementation activity back to graph. Test with Claude Code during dogfooding — use it while building the platform itself.
8. **Background suggestion engine:** Implement the Suggestion entity type and the observer agents that generate them. Suggestions are proactive: agents analyze the graph without being asked and surface observations for human review.

   **Trigger patterns (when to generate suggestions):**
   - **On graph change:** After any entity creation/update, run a lightweight analysis (Haiku) checking for local issues: does this new decision conflict with anything? Does this task have an unresolved dependency? Is this feature missing an owner?
   - **Periodic sweep (daily/configurable):** A scheduled analysis agent scans the full workspace graph for systemic patterns:
     - Provisional decisions older than 2 weeks → Suggestion(category: "risk", "Stale provisional decision: [X]. Confirm or revisit.")
     - Features with no tasks → Suggestion(category: "missing", "Feature [X] has no implementation tasks.")
     - Tasks blocked for >1 week → Suggestion(category: "risk", "Task [X] has been blocked for [N] days. Consider unblocking or reassigning.")
     - Projects with no activity in 2+ weeks → Suggestion(category: "risk", "Project [X] appears stalled.")
     - Cross-project entity overlap (two projects touching the same domain concept) → Suggestion(category: "opportunity", "Projects [A] and [B] both involve [domain]. Consider shared infrastructure.")
     - Decision patterns contradicting stated priorities → Suggestion(category: "pivot", "80% of recent decisions are about [X] but stated priority is [Y].")
     - Dependency chains longer than 3 hops with no owner → Suggestion(category: "risk", "Long dependency chain: [A] → [B] → [C] → [D] with no single owner.")
     - Single points of failure (multiple features depending on one undecided/unimplemented entity) → Suggestion(category: "risk", "[N] features depend on [X] which has no fallback.")
   
   **Generation flow:**
   ```
   Trigger fires (graph change or periodic sweep)
     → Observer agent queries relevant graph subgraph
     → LLM (Haiku) analyzes patterns, generates candidate suggestions
     → Dedup against existing pending suggestions (semantic similarity)
     → New Suggestion entities created with status: "pending"
     → Suggestions appear in feed as SuggestionCard components
   ```
   
   **Feed integration:** SuggestionCard component shows: category icon, suggestion text, rationale (expandable), evidence entities (clickable links), confidence score, and action buttons: Accept (opens conversion flow — pick target type: task/decision/feature/project, pre-filled from suggestion), Dismiss (with optional reason), Defer (moves to "deferred" status, resurfaces after configurable interval).
   
   **Conversion flow:** When a Suggestion is accepted:
   1. User picks target type (task, decision, feature, project) — pre-selected based on suggestion category
   2. New entity created with fields pre-filled from suggestion text and rationale
   3. Suggestion status → "converted", `converted_to` → new entity ID, `converted_kind` → entity type
   4. CONVERTED_TO edge created for provenance
   5. New entity inherits EVIDENCED_BY edges as RELATES_TO edges
   
   **Category → default conversion mapping:**
   - optimization → Task (category: engineering)
   - risk → Decision (status: proposed) or Task (category: engineering)
   - opportunity → Feature or Project
   - conflict → Decision (to resolve the conflict)
   - missing → Task (category: research) or Feature
   - pivot → Decision (to confirm or reject the reorientation)
   
   **Agent-specific suggestion patterns:**
   - Architect agent: gaps in business model, competitive positioning, target user clarity
   - Management agent: stale decisions, blocked tasks, priority drift, missing owners
   - Code agent (via MCP): technical debt, duplication across repos, missing tests, security patterns
   - Research agent: market changes, competitor moves, adjacent opportunities

*Deliverable: Three connected views (chat, graph, feed). GitHub activity enriches the graph. Cross-project conflicts are automatically surfaced. MCP server provides coding agents with live project context. IAM resolves identities across GitHub and the platform. Background suggestion engine proactively surfaces risks, opportunities, and improvements from graph analysis — agents observe and propose without being asked.*

---

### Phase 4: Polish, Slack Bot, and Early Access (Weeks 7–8)

**Goal: Stable product with Slack integration, ready for early adopter testing beyond dogfooding.**

1. **Slack bot:** Deploy bot that can be added to workspaces. DM conversations with full graph access. Channel monitoring with high-confidence extraction. Slash commands for explicit actions (`/brain decide`, `/brain task`, `/brain status`). Identity resolution linking Slack users to Person nodes via IAM.
2. **Project branching UX:** Refine the flow from chat → project creation. Natural escalation: select a conversation chunk, AI suggests creating a project. Smooth transition without mode-switching.
3. **MCP server v2 (plugin update):** Add Tier 3 write tools: `create_provisional_decision` for agents to make provisional decisions when the graph has no existing answer, `ask_question` for agents to raise questions that surface in the feed for human (or agent) answers — answered questions auto-create confirmed Decision entities linked via ANSWERED_BY edge, and `update_task_status` for agents to report progress. Add AgentSession logging: every agent session produces a AgentSession entity in the graph on session end, linked to all decisions, questions, and tasks the agent touched (via PRODUCED, ASKED, PROGRESSED edges). Provisional decisions surface in the feed as `DecisionReview` cards, questions surface as `QuestionCard` with answer input. Expand Tier 1 read tools with `get_task_dependencies`, `get_architecture_constraints`, `get_recent_changes`. Governance enforcement: agents can create `provisional` and `inferred` decisions but never `confirmed` — only humans confirm. The question → answer → decision flow means coding agents don't need to guess: they ask, the human answers, and the answer becomes a confirmed decision in the graph. Plugin update ships automatically to existing Claude Code users. Publish equivalent MCP server config for Cursor and other MCP-compatible agents.
4. **Notification system:** Configurable alerts for hard conflicts (immediate), soft tensions (daily digest), and opportunities (weekly summary). Delivered via email, in-app feed, and Slack bot.
5. **Onboarding flow:** First-run experience that guides users through a first conversation, shows the extraction working, and demonstrates the graph building in real time. Include GitHub OAuth and optional Slack bot installation.
6. **Performance and reliability:** Load testing on SurrealDB with realistic graph sizes. Optimize extraction pipeline latency. Error handling and retry logic.
7. **Early access deployment:** Cloud deployment, authentication, multi-tenant isolation. Waitlist and invite system.
8. **Agent learnings and behavioral tuning:** Implement the Learning entity type for persistent agent behavior modifications. Two creation paths: (1) Human tells an agent to behave differently ("stop suggesting research tasks for things I've already decided") → Learning created with `status: "active"`, immediately injected into target agent's system prompt. (2) An agent suggests a learning for another agent ("Design Partner should check existing tasks before suggesting new ones") → Learning created with `status: "pending_approval"`, surfaces in the feed as a `LearningReview` card for human approval. Active learnings are queried during `buildChatContext` and appended as a "Learnings" section in the agent's system prompt. Dismissed learnings are never re-suggested. This closes the agent improvement loop — agents get better over time based on both human feedback and cross-agent observation.

*Deliverable: A polished MVP with web chat, graph, feed, Slack bot, GitHub integration, and MCP server for coding agents. Agent learnings enable persistent behavioral tuning from human feedback and cross-agent suggestions. Ready for 10–20 early access users. Core loop proven through 6+ weeks of dogfooding.*

---

## 5. UI Specification

### 5.1 View Architecture

The platform has three core views, each serving a distinct purpose in the user's workflow:

| View | Purpose | Primary Actions |
|------|---------|-----------------|
| **Chat** | Think and create. Natural language input for discussing projects, making decisions, and brainstorming. | Send messages, @mention entities, /commands, branch to projects, highlight AI responses. |
| **Graph** | Understand relationships. Visual exploration of entities, connections, and overall business state. | Click to focus, expand/collapse, path finding, filter by type/project, search. |
| **Feed** | Act on what matters. Synthesized daily view of changes, conflicts, decisions needing input, stale commitments. | Acknowledge, delegate, resolve conflicts, jump to related chat/graph context. |

> **Design principle:** Chat to think, graph to understand, feed to act.

**UI Evolution: Tabs → OS Desktop**

The view architecture evolves across phases from a tabbed layout to a spatial operating system:

**Phase 1-2 (Tabs):** Three views behind tab navigation (Chat | Graph). Simple, familiar, validates core functionality. Chat is the primary view, graph is the second view. Components are built as self-contained, embeddable units — a chat component takes a `conversationId` and renders, a detail panel takes an `entityId` and renders. This is intentional: the components will be re-hosted inside floating windows later without rewriting logic.

**Phase 3 (Tabs + Feed):** Third tab added (Feed). Three tabs start to feel cramped — the user wants to see the feed while chatting, or reference the graph while reviewing a task. The tab model begins to show its limits.

**Phase 4-5 (OS Desktop):** The graph becomes the persistent desktop. Chat, tasks, entity details, and feed items become floating, draggable, resizable windows on top of it. The mental model shifts from "navigate between views" to "arrange your workspace."

```
┌──────────────────────────────────────────────────────────────┐
│  [Graph / Desktop]                                            │
│                                                               │
│    ○ Auth System ──── ○ JWT Decision                         │
│         \                  \                                  │
│          ○ User Login ──── ○ Rate Limiting                   │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │ 💬 Auth Design    │  │ 📋 Task: JWT Auth │                 │
│  │ @design-partner   │  │ ⚙️ engineering    │                 │
│  │                   │  │ ☐ Research libs   │                 │
│  │ > should we use   │  │ ☐ Implement MW   │                 │
│  │   JWT or sessions?│  │ ☐ Write tests    │                 │
│  │                   │  │                   │                 │
│  │ [_][□][✕]        │  │ [_][□][✕]        │                 │
│  └──────────────────┘  └──────────────────┘                  │
│                                                               │
│           ┌──────────────────┐                                │
│           │ 📢 Feed (3 items) │                               │
│           │ 🔴 Conflict: rate │                               │
│           │ 🟡 Review: JWT    │                               │
│           │ 🟢 Agent done     │                               │
│           │ [_][□][✕]        │                                │
│           └──────────────────┘                                │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 💬 Auth │ 📋 JWT │ 💬 Billing │ 📢 Feed           [+]  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**OS Desktop concepts:**

- **Graph as desktop:** The knowledge graph is always visible as the background workspace. Not a separate view — the environment everything lives in. Double-click a node to open a detail window, right-click for context menu.
- **Floating windows:** Chat conversations, task lists, entity detail panels, feed — all render as draggable, resizable, minimizable windows. Multiple can be open simultaneously. Each window is a self-contained component (built in Phase 1-2).
- **Taskbar / dock:** Bottom bar shows all open and minimized windows with icons and titles. Click to restore. [+] button spawns a new chat, task, or note.
- **Window types:**
  - 💬 Chat window — a conversation with an agent. Multiple can be open (Design Partner in one, Management Agent in another).
  - 📋 Task/Entity window — detail view of any entity. Editable fields, relationships, provenance.
  - 📢 Feed window — the governance surface. Can be pinned or floating.
  - 📊 Status window — project status dashboard (Phase 5).
- **Spatial persistence:** Window positions, sizes, and open/minimized state persist across sessions. Your workspace layout is remembered.
- **Graph interaction opens windows:** Double-click a Decision node → Decision detail window opens. Double-click a Project node → Project status window opens. Right-click → context menu with "Open chat about this", "View dependencies", "Show provenance".
- **The [+] floating action button** (visible in all phases) creates new items: new chat, new task, new note. In OS mode it spawns a new window at the cursor position.

**Why this works for the agent-native vision:** In Phase 4-5, each chat window can be a different agent conversation. You see agents working in parallel — one window shows the Design Partner brainstorming billing, another shows the coding agent's task progress. The feed window surfaces cross-agent conflicts. @mention an agent in any chat window to delegate. The OS layout makes multi-agent coordination spatial and visible, not hidden behind tabs.

**Architecture requirement for Phase 1-2:** All components must be self-contained and embeddable. A `<ChatWindow conversationId={id} />` renders a complete chat experience. A `<EntityDetail entityId={id} />` renders a complete entity view. A `<FeedPanel />` renders the feed. These components know nothing about whether they're in a tab, a floating window, or a modal. The window management layer (Phase 4) wraps them without changes.

### 5.2 Conversation Navigation & History

Unlike ChatGPT/Claude where chat history is a flat list of hundreds of conversations, conversations here are organized by the knowledge graph. The graph *is* the navigation layer for chat history.

**Sidebar structure:**

```
Workspace Name
├── Projects (grouped by extraction)
│   ├── Schack Systems
│   │   ├── Active conversations (2)
│   │   └── Recent activity summary
│   └── Consulting
│       └── Active conversations (1)
├── Unlinked conversations (3)
└── [+ New conversation]
```

Conversations are grouped under projects they touched, derived from `TOUCHED_BY` edges (computed automatically when extracted entities link to a project). Conversations that didn't produce extractions or touched multiple projects equally appear in "Unlinked." No user-assigned folders or categories.

**Anti-bloat strategy:**

1. **Graph-based grouping** — conversations cluster under projects automatically via extraction. No manual organization.
2. **Auto-generated titles** — after a conversation's first extraction (or first few messages), the system generates a descriptive title. No "New Chat (47)" syndrome.
3. **Natural archiving** — conversations where all extracted entities are resolved (tasks completed, decisions confirmed) fade from the "active" sidebar view. Still accessible via graph provenance links, just deprioritized.
4. **Graph-powered search** — "find where we discussed SurrealDB" is a graph query (find entity nodes mentioning SurrealDB → follow `extraction_relation` edges to source conversations), not keyword search through conversation titles.
5. **Conversation summaries** — after a conversation goes inactive (no new messages for X hours), the system generates a one-line summary stored on the Conversation node. Sidebar shows summaries on hover.
6. **Branching reduces scope** — instead of one mega-conversation covering 15 topics, branching encourages focused conversations. Each is shorter, more findable, and more useful as graph provenance.
7. **Drift detection prompts branching** — when the extraction pipeline detects that recent messages are producing entities unrelated to the conversation's earlier entity cluster (different project, no shared relationships), the system suggests branching via a contextual suggestion pill: "This seems like a separate thread — branch into a new conversation about [detected topic]?" Non-intrusive — if ignored, extraction continues correctly regardless.

**Conversation branching:**

The user is chatting about one topic, realizes a sub-problem deserves its own focused thread, and branches:

1. User selects a message range or clicks "branch from here"
2. Creates a new Conversation node with `BRANCHED_FROM` edge to parent
3. The new conversation carries forward relevant graph context — entities from the parent conversation are pre-loaded so the extraction pipeline has high-confidence project/feature resolution from the first message
4. Branched conversations display as nested under their parent in the sidebar
5. Both conversations remain active — the parent continues for the original topic
6. The system can also *suggest* branching when it detects conversation drift — this surfaces as a suggestion pill, not a modal or interruption

**Phasing:**

- **Phase 1:** Conversation list in sidebar, grouped by project (via `TOUCHED_BY`). Auto-generated titles. New conversation button.
- **Phase 2:** Branching with `BRANCHED_FROM` edges. Nested sidebar display. Branch carries forward parent context. Drift detection suggests branching when conversations become unfocused.
- **Phase 3:** Auto-archiving. Graph-powered conversation search. Conversation summaries. Inactive conversation deprioritization.

### 5.3 Chat View Details

- Clean textarea with Reachat's rich text input (Tiptap v3)
- Trigger characters: `@` for people/entities, `#` for projects/features, `/` for commands
- @mention search queries SurrealDB graph in real-time via onSearch callback
- Extracted entities appear as subtle inline annotations (not intrusive, but visible)
- AI responses can be highlighted/selected to branch into projects, features, or tasks
- Conversation branching: select a chunk of chat → "make this a feature" or "make this a project"
- PRD mode: AI asks structured questions to flesh out a Feature, unanswered ones become tracked Question nodes
- Decision status: decisions extracted from casual chat land as `proposed` with a one-click confirm/dismiss

### 5.3 Graph View Details

- Default: focused view showing one entity + immediate relationships (not full graph)
- Click to navigate: selecting a node refocuses the view around that entity
- Hierarchical navigation: Project → Features → Tasks drill-down as the natural browsing path
- Expand/collapse for progressive exploration of the graph
- Node sizing by activity level, importance, or centrality
- Edge labels showing relationship type and strength
- Cross-project edges highlighted distinctly (e.g. Feature in Project A conflicts with Feature in Project B)
- Timeline view: how the graph evolved over time, when decisions were made
- Full graph as a power-user feature, not the default landing

### 5.4 Feed View Details

Powered by **json-render**: each feed item is generated by the reasoning LLM from graph context, constrained to a catalog of typed feed components.

**Feed component catalog (json-render):**

| Component | Props | Use Case |
|-----------|-------|----------|
| `ConflictCard` | severity, decision_a, decision_b, projects[], suggested_resolution | Two decisions or features in tension across projects |
| `StaleCommitment` | entity, last_activity, days_stale, owner, suggested_action | Task or decision that hasn't progressed |
| `DecisionReview` | decision, status, context, confirm/dismiss actions | Extracted decision awaiting human confirmation |
| `QuestionPrompt` | question, feature, context, input_field | Unanswered PRD question needing input |
| `DependencyAlert` | blocked_task, blocking_task, projects[], estimated_impact | Cross-project dependency detected |
| `DriftAlert` | decision, expected_implementation, actual_implementation, commit_ref | Code diverges from a chat decision |
| `DailyDigest` | changes[], decisions_made, tasks_completed, new_questions | Summary card for daily/weekly rollup |

**Feed behavior:**
- The reasoning LLM traverses the graph periodically and on relevant events (new commit, new decision, stale threshold hit)
- It generates json-render JSON selecting the appropriate component and populating props from graph data
- Feed items stream and render progressively — users see items appear as the LLM processes them
- Each item links back to relevant chat message and graph node
- Actionable: acknowledge, delegate, resolve, or snooze from the feed directly
- Actions from feed items write back to the graph (confirming a decision, resolving a conflict, answering a question)

---

## 6. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Extraction quality:** too much noise or missed entities | 🔴 High | Start with high-confidence-only extraction. Explicit @mentions bypass pipeline. Three-layer testing strategy (section 3.8): deterministic unit tests for guardrails, Evalite golden file evals for regression detection on prompt changes, integration smoke tests for pipeline health. Iterate aggressively during dogfooding. Trust is earned over weeks, not shipped on day one. |
| **SurrealDB maturity:** production readiness concerns | 🟡 Medium | SurrealDB 3.0 just shipped. MVP scale is small. Have a migration path to Postgres + pgvector + Apache AGE if needed, but the multi-model advantage justifies the risk. |
| **Graph visualization overwhelm:** too many nodes | 🟡 Medium | Default to focused view, never full graph. Progressive disclosure via expand/collapse. Smart filtering and clustering. |
| **LLM cost at scale:** extraction pipeline runs on every message | 🟡 Medium | Use Haiku 4.5 for extraction (~$0.25/MTok), Sonnet 4.5 for reasoning and chat (see section 2.2). Batch non-urgent extractions. Cache common patterns. Provider-agnostic architecture allows swapping to cheaper models if needed. |
| **Schema evolution:** graph schema will change during dogfooding | 🟢 Low | SurrealDB is schema-flexible. Keep everything malleable in the first month. Don't over-engineer the data model before real usage data. |
| **Competitive overlap:** Rezonant and similar tools | 🟢 Low | Rezonant focuses on PM-to-engineering handoff. Our differentiator is the knowledge graph and cross-project intelligence. Different core value proposition. |
| **Slack noise ratio:** 90% of Slack messages are not actionable | 🟡 Medium | Higher confidence thresholds for Slack extraction than direct chat. Start with explicit commands only, add passive monitoring once extraction quality is proven. Let teams opt-in channels. |
| **Identity resolution complexity:** matching users across systems | 🟡 Medium | Start simple: OAuth-based linking (GitHub, Slack) with manual confirmation. Don't attempt fuzzy matching by name/email initially. Build on explicit connections first. |
| **MCP adoption:** coding agents may not support MCP well yet | 🟢 Low | Claude Code already supports MCP natively. Cursor and others are adding support. Even without MCP, the context packet can be served as a file (like ctx does) as a fallback. |

---

## 7. Success Metrics

MVP success is measured by dogfooding utility and early access engagement, not vanity metrics.

### 7.1 Dogfooding Phase (Weeks 1–6)

- **Extraction accuracy:** >80% of manually verified decisions and tasks are captured
- **Daily active usage:** the tool is genuinely used to track building itself
- **Graph utility:** the graph view surfaces at least one non-obvious connection per week
- **Schema stability:** graph schema changes decrease over time (converging on the right model)

### 7.2 Early Access Phase (Weeks 7–8+)

- 10–20 early access users onboarded
- **Retention:** >60% weekly active usage after 2 weeks
- **Cross-project value:** at least 3 users report the system surfacing a conflict or dependency they would have missed
- **Trust metric:** users act on feed suggestions without manual verification >50% of the time
- **MCP adoption:** at least 5 agent sessions using graph context via MCP during dogfooding, with measurable reduction in context re-explanation
- **Slack engagement:** at least 3 early access users connect the Slack bot; >50% of their graph interactions happen via Slack rather than the web UI
- **Identity coverage:** >90% of Person nodes have at least 2 linked provider identities

---

## 8. Timeline Summary

| Phase | Focus | Key Deliverable | Timeline |
|-------|-------|-----------------|----------|
| **Phase 1** | Chat + Extraction Loop | Working chat that builds a knowledge graph | Weeks 1–2 |
| **Phase 2** | Graph View + Navigation | Two connected views with bidirectional linking | Weeks 3–4 |
| **Phase 3** | GitHub + IAM + MCP + Cross-Project Intelligence | Three views, code awareness, conflict detection, MCP server v1, identity resolution | Weeks 5–6 |
| **Phase 4** | Slack Bot + Polish + Early Access | Full platform with Slack bot, expanded MCP, stable for 10–20 early users | Weeks 7–8 |

### What to Build First

Day 1 starts with the tightest possible loop: **chat input → LLM extraction → SurrealDB write → read it back and display.** Get this loop working in 2–3 days, then layer everything else on top. The first conversation in the system should be about building the system itself.

---

## 9. Future Vision: Agent-Native Business Operations

The MVP is designed for AI-assisted human workflows — a human chats, the system extracts structure, and the graph provides intelligence. But the architecture naturally extends to a system where autonomous agents operate the business, coordinated through the knowledge graph.

This is the bigger play: **the graph becomes the shared memory and coordination layer between agents**, not just between humans. Agents today fail at coordination because they have no shared state. Each runs in isolation. The knowledge graph solves this — every agent reads and writes to the same living model of the business.

### 9.1 The Solo Founder Use Case

A one-person business running on agents. The founder sets strategy, defines boundaries, and governs — agents handle execution.

| Agent | Scope | Graph Interaction |
|-------|-------|-------------------|
| **Customer Support** | Handle tickets, answer questions, process returns | Reads: product decisions, known issues, shipping policies, customer history. Writes: support tickets resolved, recurring complaints (as Question nodes), escalations to feed |
| **Sales & Outreach** | Lead follow-ups, proposal drafting, pipeline management | Reads: CRM person nodes, active campaigns, product features, pricing decisions. Writes: deal stage updates, meeting summaries, commitment nodes |
| **Development** | Pick up tasks, write code, submit PRs | Reads: task nodes via MCP, architecture decisions, dependencies, feature specs. Resolves: queries graph for implementation decisions via `resolve_decision`, checks proposed changes against constraints via `check_constraints`. Writes: commits, PR links, implementation status, provisional technical decisions via `create_provisional_decision` when graph has no existing answer |
| **Finance & Ops** | Invoice processing, expense tracking, anomaly detection | Reads: vendor nodes, budget decisions, contract terms. Writes: payment status, flagged anomalies, budget alerts |
| **Marketing & Content** | Social posts, blog drafts, campaign execution | Reads: product features, brand decisions, audience insights. Writes: content published, campaign performance, engagement data |
| **Scheduling & Admin** | Meeting coordination, email triage, calendar management | Reads: person nodes, project timelines, priority decisions. Writes: meetings scheduled (→ Meeting nodes), emails triaged, follow-ups created |

### 9.2 Agent Authority Model

The decision status system (`confirmed`, `provisional`, `inferred`, `contested`, `superseded` — see section 3.4) becomes the agent governance layer. Agents create `provisional` or `inferred` decisions via the MCP server; only humans can set status to `confirmed`. Each agent has a defined authority scope — actions within scope create `provisional` decisions that auto-surface in the feed for lightweight review, actions outside scope land as explicit review items requiring confirmation before other agents act on them.

**Authority boundaries are configurable per agent:**

- **Auto-provisional:** routine implementation decisions within defined parameters (e.g., dev agent choosing between two equivalent libraries, support agent issuing refunds under $50). Created as `provisional`, batched for daily review.
- **Propose:** actions that need human sign-off before proceeding (e.g., support agent wants to offer a custom discount, sales agent wants to commit to a non-standard delivery date). Agent stalls until human confirms.
- **Escalate:** situations the agent recognizes are outside its competence (e.g., angry customer threatening legal action, production outage detected)

The human's daily workflow becomes: open the feed, review proposed decisions from agents, approve/reject/adjust, and refine authority boundaries over time. As trust builds, the boundary expands and fewer items need human review.

### 9.3 Agent Coordination via the Graph

The real power is agents coordinating through shared state without explicit orchestration:

- **Sales agent** commits to delivering Feature X by March 15 → creates a Decision node with a deadline
- **Dev agent** sees the new dependency via graph traversal → checks task estimates → flags a conflict: "Feature X depends on the API migration which is blocked until March 20"
- **System** surfaces this as a hard conflict in the feed before anyone is disappointed
- **Human** resolves it: pushes the sales commitment or reprioritizes the API migration
- **Both agents** see the updated graph and adjust their behavior accordingly

No agent talks to another agent directly. They coordinate through the graph. This is simpler, more auditable, and more robust than agent-to-agent messaging.

### 9.4 From MVP to Agent-Native

The path is incremental, not a rewrite:

| Stage | Mode | Human Role |
|-------|------|------------|
| **MVP (now)** | Human-driven, AI-assisted | Does the work, AI extracts and organizes |
| **Post-MVP** | Human-directed, AI-executing | Directs the work, agents handle routine execution |
| **Future** | Human-governing, agent-operating | Sets strategy and boundaries, agents run day-to-day operations |

Every piece of the MVP feeds into this: the graph is the coordination layer, IAM resolves agent actions to the right context, the feed is the human governance interface, MCP is the agent access protocol, and the decision status system is the authority model.

The key insight is that **you don't need to build an "agent platform" — you need to build a great knowledge graph with clear interfaces, and agents naturally plug in.** The graph is the platform.

### 9.5 Market Positioning

This positions the product uniquely:

- **vs. agent frameworks (CrewAI, AutoGen, LangGraph):** Those are orchestration tools for developers. This is a business operations layer that non-technical founders can use. The graph provides the memory and coordination that those frameworks lack.
- **vs. vertical AI agents (AI SDRs, AI support bots):** Those are siloed. Each handles one function with no awareness of the rest of the business. The graph connects them into a coherent whole.
- **vs. traditional PM/business tools:** Those assume humans do the work. This assumes agents do the work and humans govern.

The wedge is solo founders and tiny teams who are already using AI heavily but lack a system to coordinate it all. They're currently duct-taping ChatGPT + Zapier + Notion + individual AI tools. This replaces the entire stack with a unified, graph-coordinated system.

---

> *Start building. Start dogfooding. Let the data tell you what matters.*