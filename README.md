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

### 2.1 Why TypeScript Over Rust

The original plan called for a Rust backend. TypeScript is the better choice for an 8-week MVP build:

- **I/O bound, not CPU bound.** The backend orchestrates: receive message → call embedding API → call LLM → parse JSON → write to SurrealDB → push WebSocket update. This is exactly what Node's event loop handles well. There's no heavy computation to justify Rust's performance overhead.
- **One language, full stack.** Frontend (React), backend (Hono), MCP server, Slack bot SDK, GitHub webhook handlers, Vercel AI SDK — all TypeScript. Zero context switching. Shared type definitions between client and server eliminate an entire class of serialization bugs.
- **Ecosystem density.** Every integration in the MVP has a mature TypeScript library: SurrealDB JS SDK, Octokit (GitHub), Slack Bolt, MCP SDK, Vercel AI SDK. In Rust, several of these would require writing custom HTTP clients or using less-maintained crates.
- **Iteration speed.** During dogfooding, the extraction pipeline prompts and graph schema will change daily. TypeScript's hot-reload and rapid iteration cycle matters more than Rust's compile-time guarantees at this stage.
- **Escape hatch.** If post-MVP scale demands it, specific hot paths (batch extraction, graph traversal) can be rewritten in Rust as isolated services. The architecture doesn't prevent this — it just defers the complexity until it's justified by real load.

### 2.2 LLM Model Strategy

The platform uses different models for different jobs, optimizing for cost, latency, and intelligence where each matters most.

| Job | Model | Rationale |
|-----|-------|-----------|
| **Extraction** (per-message) | Claude Haiku 4.5 | Fastest, cheapest. Excellent at structured JSON output, entity classification, and relationship detection. At ~$0.25/MTok input / $1.25/MTok output, affordable to run on every message. Extraction runs in background — user never waits for it. |
| **Chat conversation** (user-facing) | Claude Sonnet 4.5 | The user is chatting with the system — this is the product experience. Sonnet provides the quality users expect at reasonable cost. |
| **Reasoning** (feed, conflicts, MCP context) | Claude Sonnet 4.5 | Multi-hop graph reasoning, conflict classification ("is this actually a conflict?"), and context synthesis require real judgment. Runs async so latency doesn't matter. |
| **Document editing** (Tiptap AI) | Claude Sonnet 4.5 | PRD generation and document edits need quality. Schema-aware edits require understanding document structure and graph context simultaneously. |

**Architecture principle:** Extraction and chat are separate LLM calls. User sends a message → Sonnet streams a conversational response immediately → simultaneously, Haiku processes the same message for entity extraction in the background. If extraction fails or is slow, the chat experience is unaffected.

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
  └── Project (e.g., "Schack Systems", "Consulting", "whack.gg")
       └── Feature (e.g., "Extraction Pipeline", "Graph View")
            └── Task / Decision / Question
```

**Scoping rules:**

- **Workspace-level:** Person, Conversation, Meeting. These are never scoped to a single project. A person works across projects. A conversation can produce entities in multiple projects. This is what enables cross-project intelligence.
- **Project-level:** Feature, Task, Decision, Question. These belong to a specific project (or feature within a project). The extraction pipeline determines project assignment — users never pick a project before chatting.
- **Write-time enforcement:** `workspaceId` is required on every API write (hard multi-tenant boundary). `projectId` is never required on conversations or people. Project assignment on extracted entities is resolved by the extraction pipeline with confidence scores. Low-confidence assignments are surfaced for user confirmation.
- **Search/context APIs:** Default to workspace-wide. Optional `projectId` filter as a query parameter, not a write constraint. MCP server can scope context to a specific project when a coding agent requests it.

Cross-project intelligence means traversing across Projects *within* a Workspace. The conflict detection engine traverses across all Projects within the same Workspace.

For Phase 1 dogfooding: one Workspace, one Project ("AI-Native Business Management Platform"). But the schema supports multiple from day one — trivial to add now, painful to retrofit later.

#### Entity Types (Graph Nodes)

| Entity | Scope | Description | Key Properties |
|--------|-------|-------------|----------------|
| **Workspace** | Root | Top-level container and multi-tenant boundary. Everything lives inside a workspace. One user can have multiple workspaces (e.g., separating businesses). | name, owner, created_at |
| **Person** | Workspace | A team member or stakeholder. Workspace-scoped because people work across projects. Linked to entities in any project via OWNS, DECIDED_BY, ASSIGNED_TO edges. | name, role, contact info, identities[] |
| **Conversation** | Workspace | A chat session or message thread. Workspace-scoped because a single conversation can produce entities across multiple projects. Never requires a projectId. | messages[], embedding, source, timestamp |
| **Meeting** | Workspace | A meeting with transcript (subtype of Conversation). Same scoping rules as Conversation. | title, attendees[], transcript_ref, calendar_event_ref, source_provider, recorded_at |
| **Project** | Workspace | A bounded initiative or workstream within a workspace | name, status, description, created_at |
| **Feature** | Project | A distinct capability or component within a project. Maps to a PRD. Natural grouping layer between Project and Task. | name, status, description, prd (progressive), owner |
| **Task** | Project/Feature | An actionable commitment with an owner | title, owner, deadline, status, priority |
| **Decision** | Project/Feature | A ratified choice with context | summary, rationale, decided_by, decided_at, status (extracted / proposed / confirmed / superseded) |
| **Question** | Project/Feature | An unanswered question or open item | text, assigned_to, status, context |

#### Relationship Types (Graph Edges)

| Edge | Connects | Properties |
|------|----------|------------|
| **HAS_PROJECT** | Workspace → Project | added_at |
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

The extraction prompt receives the current message plus relevant graph context (via vector search + graph traversal). It outputs structured JSON with high-confidence extractions only. The system errs on the side of missing things rather than creating noise — building trust over time as accuracy proves out.

Explicit entity references via @mentions and #project tags bypass the extraction pipeline entirely and create direct graph links, ensuring zero-loss for intentional references.

### 3.3 Data Strategy: Store the Graph, Not the Raw Data

The system stores extracted entities, relationships, and metadata in the knowledge graph, but does not warehouse raw communications from external sources. For example, a Slack message that contains a decision becomes a Decision node with a summary, participants, and a reference link back to Slack. The full message body stays in Slack.

**This hybrid approach provides three key benefits:**

- **Privacy:** no sensitive raw data stored; the graph is a semantic index, not a data warehouse
- **Compliance:** easier GDPR/data retention story since original content stays in source tools
- **Sales enablement:** "we don't store your messages, we build a map of your decisions"

### 3.4 MCP Server: Context for Coding Agents

Inspired by [ActiveMemory/ctx](https://github.com/ActiveMemory/ctx), the platform exposes an MCP (Model Context Protocol) server that gives coding agents (Claude Code, Cursor, Copilot, Aider) rich project context from the knowledge graph. Where ctx persists context as flat markdown files, our approach serves live, structured context from the graph — decisions, architecture choices, active tasks, open questions, and known constraints — dynamically scoped to whatever the agent is working on.

**How it works:**

- The MCP server exposes tools like `get_project_context`, `get_active_decisions`, `get_task_dependencies`, `get_architecture_constraints`
- When a coding agent starts a session, it calls the MCP server with the current repo/project scope
- The server queries SurrealDB, traverses the graph for relevant nodes, and returns a token-budgeted context packet (similar to ctx's `--budget` flag)
- As the agent makes commits, those flow back through the GitHub integration and update the graph — closing the loop

**Why this matters:** Coding agents today start near-zero every session. They re-discover architecture decisions, repeat past mistakes, and lack awareness of business context. By feeding them the knowledge graph, every coding session inherits the full decision history and project state. The agent knows *why* things were built a certain way, not just *how*.

**Context packet includes:**
- Active decisions and their rationale
- Current task being worked on + dependencies
- Architecture constraints and patterns established
- Recent changes and their context
- Open questions that might affect implementation

### 3.5 Slack Bot: Native Input Channel

The platform includes a Slack bot that functions as a direct interface to the knowledge graph, allowing teams to interact with the system where they already work rather than requiring them to context-switch to a separate app.

**Capabilities:**

- **Conversational:** Chat with the bot in DMs or mention it in channels. It has full access to the knowledge graph for answering questions ("what did we decide about pricing?", "what's blocking the API migration?")
- **Passive ingestion:** With permission, the bot monitors designated channels and extracts decisions, tasks, and commitments into the graph. This is where the noise-filtering problem is critical — Slack is ~90% noise, so extraction confidence thresholds must be higher than for direct chat
- **Active commands:** `/brain status project-x` to get a project summary, `/brain decide "use GraphQL for reporting API"` to explicitly record a decision, `/brain task @marcus "implement auth flow" by Friday` to create a tracked task
- **Notifications:** The bot surfaces cross-project conflicts and feed items directly in Slack — hard conflicts as DMs, soft tensions in a dedicated channel

**Architecture:** The Slack bot is a thin client that authenticates via the IAM layer (see 3.7), maps Slack user IDs to Person nodes in the graph, and routes messages through the same extraction pipeline as the web chat. Messages processed via Slack get a `source: slack` tag with a reference link back to the original message.

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

---

## 4. Build Phases

The MVP is structured as four two-week phases, designed for dogfooding from day one. Each phase produces a usable increment that informs the next.

---

### Phase 1: Chat + Extraction Loop (Weeks 1–2)

**Goal: Chat interface connected to LLM with real-time entity extraction into SurrealDB.**

1. **SurrealDB setup:** Define schema for all entity types and relationship edges, starting from the Workspace root. Configure vector index (HNSW) for embeddings on message and entity nodes. Write SurrealQL functions for entity retrieval and graph traversal.
2. **TypeScript backend API (Hono):** REST/WebSocket endpoints for chat messages, streaming LLM responses, and graph queries. SurrealDB JS SDK integration. Message persistence and embedding generation (OpenRouter). Shared type definitions with frontend.
3. **Extraction pipeline v1:** LLM prompt (Haiku 4.5) that takes a message + context and outputs structured JSON with entities and relationships. Initial focus on tasks, decisions, and questions. Confidence scoring to filter noise. Extracted relationships stored as `extraction_relation` edges with `{kind, confidence, source_message}` — no premature ontology resolution. Entity and message nodes embedded via OpenRouter for semantic search.
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
5. **Workspace onboarding conversation:** Creating a workspace collects two fields (workspace name, owner name), creates the root nodes (`workspace:xyz` + `person:owner` + `MEMBER_OF` edge), and drops the user into chat. The system sends the first message with suggestions — no empty state. The onboarding uses the same chat route with an `onboarding_complete: false` flag on the workspace that enriches the system prompt with guided questions. The system conversationally asks about the business, current projects, people involved, key decisions, tools in use, and biggest concerns. Each answer is extracted in real-time and rendered inline using the component catalog — the user sees `EntityCard` components appearing in the chat as the system confirms what it understood ("Got it:" followed by rendered entity cards). Suggestions guide each turn so the user always has clear next steps. Onboarding completes when the graph reaches minimum threshold (≥1 project + ≥1 person + ≥1 decision or question) or after 7 guided turns — at which point the system renders an `OnboardingSummary` component and offers to continue or dive in. Completion triggers on explicit confirmation, the user changing topic, or uploading a document. The flag flips, the system prompt switches to standard chat, and the conversation continues seamlessly in the same view.
6. **Document upload for graph seeding:** Users can optionally drop a document (markdown or plain text in Phase 1) into the onboarding chat to bootstrap a dense initial graph. The document is chunked respecting section boundaries, each chunk runs through Haiku extraction with the same structured JSON output, and entities are deduplicated against existing nodes (embedding similarity + LLM context of current graph state). A plan document like a 400-line MVP spec might yield 50–100 nodes in one shot — features, decisions, dependencies, risks, tech choices — all with relationships. After ingestion, the system summarizes what it extracted and continues the conversation with smarter follow-up questions based on gaps or ambiguities in the document ("Your plan mentions SurrealDB but flags a maturity risk — have you evaluated fallbacks?"). The document doesn't replace the onboarding conversation, it accelerates it. All extracted nodes link back to the source document as provenance. This is not a separate UI — it's a file attachment in the chat, like any messaging app.
7. **Smoke tests:** Bun script for API/SSE/search/graph checks (health, message flow, extraction writes, embedding storage, semantic search, RELATE edges). Plus a short manual frontend verification checklist (streaming, @mentions, inline annotations).
8. **Dogfooding checkpoint:** Run the onboarding conversation for the dogfooding workspace ("AI-Native Business Management Platform"), uploading this MVP plan as the seed document. Start using the tool to plan and track building the tool itself. Every architecture decision becomes a graph node.

*Deliverable: A working chat that talks to an LLM and builds a knowledge graph from conversations. Extracted entities render as rich inline components via Reachat's component catalog. Suggestions guide the user through onboarding and contextual actions. Workspace creation is a self-service onboarding conversation that bootstraps the graph. Document upload accelerates graph seeding.*

---

### Phase 2: Graph View + Focused Navigation (Weeks 3–4)

**Goal: Visual graph exploration with focused entity views and bidirectional chat-graph linking.**

1. **Reagraph integration:** Render SurrealDB graph data as interactive nodes and edges. Implement focused view: click an entity, see its immediate relationships. Node sizing by activity/importance.
2. **Entity detail panels:** Click a node to see its full context: related conversations, decisions, tasks, open questions. Link back to the original chat message where it was created.
3. **Chat → Graph navigation:** Clicking an inline annotation in chat navigates to that node in the graph. Clicking a conversation reference in the graph jumps to that chat message.
4. **Search and filter:** Full-text and semantic search across the graph. Filter by entity type, project, person, date range.
5. **Extraction pipeline v2:** Iterate on extraction quality based on real dogfooding data. Tune confidence thresholds. Add relationship strength scoring.

*Deliverable: Two connected views (chat + graph) with bidirectional navigation. The graph is useful for understanding project state at a glance.*

---

### Phase 3: GitHub Integration + Cross-Project Intelligence (Weeks 5–6)

**Goal: Code-aware graph with cross-project conflict detection, IAM foundation, and the action feed.**

1. **GitHub webhook integration:** Ingest commits, PRs, and issues. Extract decisions from commit messages and PR descriptions. Link commits to existing decision nodes (closing the decision → implementation loop).
2. **IAM foundation:** Implement the Person identity resolution layer. Link GitHub usernames to Person nodes via OAuth. Build the identities array model so that a single Person can be resolved across providers. This is prerequisite infrastructure for Slack and all future integrations.
3. **Drift detection:** Compare decisions made in chat with actual code implementations. Flag divergences: "team decided approach A but code implements approach B."
4. **Cross-project reasoning engine:** When a new decision or change is added to any project, traverse the graph for related entities across all projects. Classify results into hard conflicts, soft tensions, and opportunities.
5. **Action feed view (json-render):** The third core view: a daily-driver feed showing what changed, what needs attention, stale commitments, cross-project conflicts, and decisions awaiting input. Built using json-render: define a catalog of feed components (`ConflictCard`, `StaleCommitment`, `DecisionReview`, `QuestionPrompt`, `DependencyAlert`) with typed props via Zod schemas. The reasoning LLM queries the graph, then generates JSON that maps to these components — each feed item is dynamically composed from graph context but guardrailed to the catalog. Feed items stream and render progressively.
6. **PRD questioning flow (Tiptap AI Toolkit):** AI asks structured questions to flesh out a Feature. Unanswered questions become tracked Question nodes linked to that Feature and assigned to relevant people. The PRD is rendered as a Tiptap document — a live projection of the Feature's subgraph with custom nodes for decisions, dependencies, constraints, and questions. As the graph updates (new decisions from chat, resolved dependencies from commits), the reasoning LLM edits the PRD via Tiptap AI Toolkit, showing tracked changes the user can accept or reject. User edits to the document are extracted back into the graph (bidirectional sync). Features can be created by branching from chat or explicitly via commands.
7. **MCP server v1:** Expose basic MCP tools (`get_project_context`, `get_active_decisions`) that coding agents can call. Token-budgeted context packets from the graph. Test with Claude Code during dogfooding — use it while building the platform itself.

*Deliverable: Three connected views (chat, graph, feed). GitHub activity enriches the graph. Cross-project conflicts are automatically surfaced. MCP server provides coding agents with live project context. IAM resolves identities across GitHub and the platform.*

---

### Phase 4: Polish, Slack Bot, and Early Access (Weeks 7–8)

**Goal: Stable product with Slack integration, ready for early adopter testing beyond dogfooding.**

1. **Slack bot:** Deploy bot that can be added to workspaces. DM conversations with full graph access. Channel monitoring with high-confidence extraction. Slash commands for explicit actions (`/brain decide`, `/brain task`, `/brain status`). Identity resolution linking Slack users to Person nodes via IAM.
2. **Project branching UX:** Refine the flow from chat → project creation. Natural escalation: select a conversation chunk, AI suggests creating a project. Smooth transition without mode-switching.
3. **MCP server v2:** Expand tool set with `get_task_dependencies`, `get_architecture_constraints`, `get_recent_changes`. Add context scoping by repo/directory. Publish as an installable MCP server for Claude Code and Cursor.
4. **Notification system:** Configurable alerts for hard conflicts (immediate), soft tensions (daily digest), and opportunities (weekly summary). Delivered via email, in-app feed, and Slack bot.
5. **Onboarding flow:** First-run experience that guides users through a first conversation, shows the extraction working, and demonstrates the graph building in real time. Include GitHub OAuth and optional Slack bot installation.
6. **Performance and reliability:** Load testing on SurrealDB with realistic graph sizes. Optimize extraction pipeline latency. Error handling and retry logic.
7. **Early access deployment:** Cloud deployment, authentication, multi-tenant isolation. Waitlist and invite system.

*Deliverable: A polished MVP with web chat, graph, feed, Slack bot, GitHub integration, and MCP server for coding agents. Ready for 10–20 early access users. Core loop proven through 6+ weeks of dogfooding.*

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

### 5.2 Chat View Details

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
| **Extraction quality:** too much noise or missed entities | 🔴 High | Start with high-confidence-only extraction. Explicit @mentions bypass pipeline. Iterate aggressively during dogfooding. Trust is earned over weeks, not shipped on day one. |
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
- **MCP adoption:** at least 5 coding sessions using graph context via MCP during dogfooding, with measurable reduction in context re-explanation
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
| **Development** | Pick up tasks, write code, submit PRs | Reads: task nodes via MCP, architecture decisions, dependencies, feature specs. Writes: commits, PR links, implementation status, technical decisions |
| **Finance & Ops** | Invoice processing, expense tracking, anomaly detection | Reads: vendor nodes, budget decisions, contract terms. Writes: payment status, flagged anomalies, budget alerts |
| **Marketing & Content** | Social posts, blog drafts, campaign execution | Reads: product features, brand decisions, audience insights. Writes: content published, campaign performance, engagement data |
| **Scheduling & Admin** | Meeting coordination, email triage, calendar management | Reads: person nodes, project timelines, priority decisions. Writes: meetings scheduled (→ Meeting nodes), emails triaged, follow-ups created |

### 9.2 Agent Authority Model

The decision status system (`extracted → proposed → confirmed → superseded`) becomes the agent governance layer. Each agent has a defined authority scope — actions within scope are auto-confirmed, actions outside scope land as `proposed` in the human's feed.

**Authority boundaries are configurable per agent:**

- **Auto-confirm:** routine actions within defined parameters (e.g., support agent can issue refunds under $50, dev agent can merge PRs that pass CI)
- **Propose:** actions that need human sign-off (e.g., support agent wants to offer a custom discount, sales agent wants to commit to a non-standard delivery date)
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