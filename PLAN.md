# MVP Build Plan: AI-Native Business Management Platform

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
| **Database** | SurrealDB | Graph + vector + document in one system. Native Rust client. Eliminates need for Postgres + Pinecone + Neo4j. |
| **Backend** | Rust | Native SurrealDB client, high performance for extraction pipeline, existing developer expertise. |
| **Chat UI** | Reachat | Same ecosystem as Reagraph (reaviz). Built-in @mentions, /commands, rich text via Tiptap v3. Designed for LLM interfaces. |
| **Graph UI** | Reagraph | WebGL graph visualization for React. Path finding, expand/collapse, clustering. Same design language as Reachat. |
| **LLM Layer** | Anthropic / OpenAI API | Powers the extraction pipeline and conversational reasoning. Provider-agnostic architecture. |
| **Streaming** | Vercel AI SDK | Handles LLM streaming protocol between backend and Reachat UI. |
| **Styling** | Tailwind + shadcn/ui | Consistent design system. Both Reachat and Reagraph are Tailwind-native. |

---

## 3. Architecture

### 3.1 Core Data Model

SurrealDB serves as the single data layer combining three capabilities in one system:

- **Document storage:** raw conversations, messages, and notes with full text
- **Vector embeddings:** semantic search and RAG retrieval across all content
- **Graph relationships:** entities linked by typed, weighted edges

#### Entity Types (Graph Nodes)

| Entity | Description | Key Properties |
|--------|-------------|----------------|
| **Project** | A bounded initiative or workstream | name, status, description, created_at |
| **Feature** | A distinct capability or component within a project. Maps to a PRD. Natural grouping layer between Project and Task. | name, status, description, prd (progressive), owner |
| **Task** | An actionable commitment with an owner | title, owner, deadline, status, priority |
| **Decision** | A ratified choice with context | summary, rationale, decided_by, decided_at, status (extracted / proposed / confirmed / superseded) |
| **Question** | An unanswered question or open item | text, assigned_to, status, context |
| **Person** | A team member or stakeholder | name, role, contact info, identities[] |
| **Conversation** | A chat session or message thread | messages[], embedding, source, timestamp |
| **Meeting** | A meeting with transcript (subtype of Conversation) | title, attendees[], transcript_ref, calendar_event_ref, source_provider, recorded_at |

#### Relationship Types (Graph Edges)

| Edge | Connects | Properties |
|------|----------|------------|
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

1. **SurrealDB setup:** Define schema for all entity types and relationship edges. Configure vector index for embeddings. Write SurrealQL functions for entity retrieval and graph traversal.
2. **Rust backend API:** REST/WebSocket endpoints for chat messages, streaming LLM responses, and graph queries. SurrealDB client integration. Message persistence and embedding generation.
3. **Extraction pipeline v1:** LLM prompt that takes a message + context and outputs structured JSON with entities and relationships. Initial focus on tasks, decisions, and questions. Confidence scoring to filter noise.
4. **Reachat frontend:** Basic chat textarea with LLM streaming. Configure @mention support with entity search against SurrealDB. Inline annotations showing extracted entities as subtle highlights.
5. **Dogfooding checkpoint:** Start using the tool to plan and track building the tool itself. Every architecture decision becomes a graph node.

*Deliverable: A working chat that talks to an LLM and builds a knowledge graph from conversations. Entities are visible as inline annotations.*

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
5. **Action feed view:** The third core view: a daily-driver feed showing what changed, what needs attention, stale commitments, cross-project conflicts, and decisions awaiting input.
6. **PRD questioning flow:** AI asks structured questions to flesh out a Feature. Unanswered questions become tracked Question nodes linked to that Feature and assigned to relevant people. The PRD progressively fills in as a property of the Feature node. Features can be created by branching from chat or explicitly via commands.
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

- Daily digest: what changed across all projects today
- Cross-project conflicts with full context and severity classification
- Decisions awaiting your input (from PRD questions or team discussions)
- Stale commitments: tasks or decisions that haven't progressed
- Each item links back to relevant chat message and graph node
- Actionable: acknowledge, delegate, resolve, or snooze from the feed directly

---

## 6. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Extraction quality:** too much noise or missed entities | 🔴 High | Start with high-confidence-only extraction. Explicit @mentions bypass pipeline. Iterate aggressively during dogfooding. Trust is earned over weeks, not shipped on day one. |
| **SurrealDB maturity:** production readiness concerns | 🟡 Medium | SurrealDB 3.0 just shipped. MVP scale is small. Have a migration path to Postgres + pgvector + Apache AGE if needed, but the multi-model advantage justifies the risk. |
| **Graph visualization overwhelm:** too many nodes | 🟡 Medium | Default to focused view, never full graph. Progressive disclosure via expand/collapse. Smart filtering and clustering. |
| **LLM cost at scale:** extraction pipeline runs on every message | 🟡 Medium | Use smaller models (Haiku-class) for extraction, reserving large models for reasoning. Batch non-urgent extractions. Cache common patterns. |
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
