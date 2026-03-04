# Coding Agent Integration: Full Lifecycle Design

## Overview

The coding agent integration connects external coding agents (Claude Code, Cursor, Aider, Codex) to the knowledge graph via MCP. The integration has three goals:

1. **Every agent session starts with full context** — the agent knows what was decided, what's constrained, and what's in progress
2. **Implementation decisions flow back to the graph** — the graph stays current with what's actually being built
3. **Cross-agent coordination happens through the graph** — if the Architect agent decides something in the web chat, the coding agent sees it on next context load; if the coding agent makes a provisional decision, it surfaces in the feed for the human

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Claude Code / Cursor / Aider                       │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ SessionStart│→ │  Mid-session │→ │  Session  │ │
│  │   Hook      │  │  MCP calls   │  │  End Hook │ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘ │
└─────────┼────────────────┼─────────────────┼───────┘
          │                │                 │
          ▼                ▼                 ▼
┌─────────────────────────────────────────────────────┐
│  MCP Server (Hono endpoint)                         │
│                                                     │
│  Context    Decision    Constraint   Implementation │
│  Builder    Resolver    Checker      Tracker        │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  SurrealDB Knowledge Graph                          │
│                                                     │
│  Decisions ─── Features ─── Tasks ─── Sessions      │
│       │            │           │          │         │
│  Constraints   Questions   Changes   Summaries      │
└─────────────────────────────────────────────────────┘
```

## Layer 1: Session Start — Context Injection

### Workspace Connection

The config only stores workspace auth. Project mapping is inferred at runtime.

```bash
brain init
# Prompts: Which workspace? → authenticates
# Stores in ~/.brain/config.json:
# { "workspace": "ws:xyz", "api_key": "..." }
```

### Project Inference

One monorepo (or monolith), one workspace. The mapping depends on structure:

- **Monorepo with services:** workspace = repo, project = each service directory
- **Monolith:** workspace = repo, project = each module or domain

Project inference is the agent's job, not a hardcoded heuristic chain. On SessionStart, the hook gives the agent the current working directory and the list of projects in the workspace. The agent looks at the directory, reads relevant files if needed, and picks the project. If it's a task-scoped start, the task already has a project — no inference needed.

```
SessionStart hook:
  1. Fetch workspace project list from graph
  2. Pass to agent: "You're working in [cwd]. These projects exist: [list]. Which one?"
  3. Agent responds with project ID (or "create new project: [name]")
  4. Cache the answer per directory in ~/.brain/dir-cache.json
  5. On subsequent sessions in the same directory, use cached answer (skip agent inference)
```

The agent can look at README files, package.json, directory structure, whatever it needs. It's better at fuzzy matching "src/auth/middleware" to a project called "Authentication System" than any regex chain we'd write. And if the workspace only has one project, there's nothing to infer — just use it.

### Context Packet Assembly

On SessionStart, the plugin calls `get_project_context`. There are two modes:

**Broad session (no task specified):** Agent gets the full project context — all decisions, constraints, active tasks, open questions. This is for exploratory sessions, debugging, or when the agent picks up work organically.

**Task-scoped session (agent started from a task):** When the agent is launched to work on a specific task (e.g., from the feed, from a task card, or via `brain start task:xyz`), the context packet is focused:

```
brain start task:implement-rate-limiting
# or: agent launched from task card in the UI
```

The MCP server receives the task ID and builds a **task-scoped context packet**:

1. The task itself (title, description, category, status, dependencies)
2. Existing subtasks (if a previous agent already decomposed this task — don't re-decompose)
3. The task's parent feature and its description
4. Decisions that the task DEPENDS_ON or that BELONGS_TO the same feature
4. Constraints that apply to the task's feature or project
5. Open questions related to this task or feature
6. Sibling tasks in the same feature (for awareness of parallel work)
7. Recent AgentSessions that touched this task or related tasks

Everything else is excluded. This keeps the context tight — a task-scoped session might use 1000-1500 tokens of context instead of 4000. The agent is focused on one thing.

**The agent can always call `get_project_context` mid-session** if it needs broader awareness. Task-scoped start just means the initial context is focused, not that the agent is locked to that scope.

**Task status auto-updates:** When an agent starts a task-scoped session, the task status automatically moves to "in_progress" (if it was "todo" or "ready"). When the session ends, the SessionEnd hook asks the agent whether the task is completed, still in progress, or blocked — and updates accordingly.

The full context packet interface:

```typescript
interface ContextPacket {
  // Identity
  workspace: { id: string; name: string };
  project: { id: string; name: string; status: string; description: string }; // inferred at session start
  
  // Scope — null for broad sessions, populated for task-scoped
  task_scope?: {
    task: { id: string; title: string; description: string; status: string; category: string };
    subtasks: { id: string; title: string; status: string }[];  // existing subtasks if previously decomposed
    parent_feature?: { id: string; name: string; description: string };
    sibling_tasks: { id: string; title: string; status: string }[];
    dependencies: { id: string; title: string; status: string; resolved: boolean }[];
    related_sessions: { id: string; agent: string; ended_at: string; summary: string }[];
  };
  
  // What's been decided (don't re-decide these)
  decisions: {
    confirmed: Decision[];    // settled — follow these
    provisional: Decision[];  // made by agents, pending human review — follow but flag
    contested: Decision[];    // conflicting — don't touch without human input
  };
  
  // What constrains your work
  constraints: {
    text: string;
    source: string;          // which decision or feature created this constraint
    severity: "hard" | "soft";
  }[];
  
  // What you're working on
  active_tasks: {
    id: string;
    title: string;
    status: string;
    dependencies: { id: string; title: string; status: string }[];
    category: string;
  }[];
  
  // What's still open
  open_questions: {
    id: string;
    text: string;
    status: "asked" | "deferred";
    asked_by: string;
    context: string;
  }[];
  
  // What changed since your last session
  recent_changes: {
    entity_type: string;
    entity_name: string;
    change_type: "created" | "updated" | "confirmed" | "superseded";
    changed_by: string;      // "architect" | "management" | "human" | "code-agent"
    changed_at: string;
    summary: string;
  }[];
  
  // Behavioral modifications for this agent
  learnings: {
    text: string;
    source: string;
  }[];
  
  // Active suggestions relevant to this project
  pending_suggestions: {
    id: string;
    text: string;
    category: string;
    rationale: string;
  }[];
}
```

**Token budgeting:** The context packet has a configurable token budget (default: 4000 tokens for broad sessions, 1500 for task-scoped). For broad sessions, priority order for inclusion:

1. Contested decisions (always — agent must know about conflicts)
2. Active tasks assigned to this project/agent
3. Confirmed decisions relevant to current tasks
4. Hard constraints
5. Provisional decisions (from other agents)
6. Recent changes (last 48 hours)
7. Open questions
8. Learnings
9. Soft constraints
10. Pending suggestions

If the budget is exhausted, lower-priority items are truncated with a note: "Additional context available — call `get_full_context` for complete state."

### Diff Since Last Session

The `recent_changes` field is the most important for returning developers. It answers: "what happened while I was away?" The MCP server tracks the last session end time per directory (stored in `~/.brain/dir-cache.json`) and queries all entity changes after that timestamp.

This means: if the Architect agent had a design conversation with the human at 3pm, and the developer opens Claude Code at 5pm, the context packet includes "Decision confirmed: Use token bucket for rate limiting (confirmed by human via chat, 3:12pm)." The coding agent doesn't need to be told — it already knows.

## Layer 2: Mid-Session — MCP Tools

### Read Tools (Tier 1)

```
get_project_context({ project?, task_id?, scope? })
  → If task_id provided: returns task-scoped context (focused on that task's subgraph)
  → If only project: returns full project context (all decisions, constraints, tasks)
  → scope can further filter: "decisions", "tasks", "constraints"
  
get_active_decisions({ project, area? })
  → Decisions filtered by project and optional area (e.g., "auth", "billing")
  
get_task_dependencies({ task_id })
  → Full dependency tree for a task, including blocked/blocking status
  
get_architecture_constraints({ project, area? })
  → Constraints that apply to the given area

get_recent_changes({ project?, since? })
  → Changes since a timestamp, filtered by project
  
get_entity_detail({ entity_id })
  → Full detail for any entity including description history and relationships
```

### Reasoning Tools (Tier 2)

```
resolve_decision({
  question: "Should this endpoint use REST or tRPC?",
  options: ["REST", "tRPC"],
  context: { project, feature? }
})
  → Graph traversal: find existing decisions, constraints, and patterns
  → Returns: { decision, confidence, rationale, status: "inferred", sources[] }
  → Side effect: creates Decision entity with status: "inferred"

check_constraints({
  proposed_action: "Add Redis dependency for caching",
  project
})
  → Checks proposed action against all constraints and decisions
  → Returns: { conflicts[], warnings[], proceed: bool, notes }
  → No side effect — read-only check
```

### Write Tools (Tier 3)

```
create_provisional_decision({
  name: "Use token bucket for rate limiting",
  rationale: "Best fit for bursty API traffic",
  context: { project, feature? },
  options_considered: string[]
})
  → Creates Decision with status: "provisional"
  → Triggers: feed item (DecisionReview card) for human review
  → Returns: { decision_id, status: "provisional", review_required: true }

ask_question({
  text: "Should rate limiting be per-user or per-API-key?",
  context: { project, feature?, task? },
  options?: string[],              // optional — if the agent has identified the options
  blocking_task?: string           // task ID this question blocks
})
  → Creates Question entity with status: "asked", asked_by: "code-agent"
  → If blocking_task provided: creates BLOCKS edge (Question blocks Task)
  → Surfaces in feed as QuestionCard with answer input
  → Returns: { question_id, status: "asked" }

update_task_status({
  task_id: string,
  status: "in_progress" | "blocked" | "completed",
  notes?: string
})
  → Updates task status in graph
  → If "completed": triggers description updates on parent feature/project
  → If "blocked": creates a Suggestion (category: "risk") if blocked > 24h
  → If parent task exists and all subtasks completed: parent auto-moves to "completed"
  → If parent task exists and this subtask blocked: parent shows "partially_blocked"

create_subtask({
  parent_task_id: string,
  title: string,
  category?: string,           // inherits from parent if not specified
  rationale?: string           // why this subtask is needed
})
  → Creates Task entity with SUBTASK_OF edge to parent
  → Inherits project and feature from parent task
  → Status starts at "todo"
  → Returns: { task_id, parent_task_id }
  
  Use this when breaking a parent task into implementation steps.
  The coding agent typically calls this at the start of a task-scoped
  session after analyzing what needs to be done:
  
  "Implement rate limiting" →
    create_subtask("Add token bucket middleware")
    create_subtask("Write rate limit config schema")  
    create_subtask("Add rate limit headers to responses")
  
  Then work through subtasks sequentially, updating status as each completes.

log_implementation_note({
  entity_id: string,          // decision, task, or feature this relates to
  note: string,               // what was implemented and how
  files_changed?: string[]    // paths of files touched
})
  → Appends to entity's description_entries
  → Creates IMPLEMENTED_BY edges to relevant entities
  → Useful for: "Implemented JWT refresh using rotating keys in /src/auth/refresh.ts"
```

### Question → Answer → Decision Flow

When a coding agent hits an unresolved question, it should call `ask_question` instead of guessing or stalling. This creates a Question entity in the graph that surfaces in the feed.

**The answer can come from three sources:**

**1. Human answers in the feed.** The QuestionCard in the feed shows the question, any options the agent provided, and an answer input. When the human answers:
- Question status → "answered", answer_summary populated
- If the answer implies a decision (e.g., "use per-user rate limiting"), a Decision entity is auto-created with status "confirmed" (human answered directly)
- The Decision is linked to the Question via ANSWERED_BY edge
- If blocking_task was set, the Task is unblocked
- Next time the coding agent refreshes context (SessionStart or UserPromptSubmit), it sees the new Decision

**2. Human discusses with Architect agent in web chat.** Human says "the coding agent asked about rate limiting scope — what do you think?" The Architect analyzes constraints, suggests per-user, human confirms. The confirmed Decision is linked to the original Question. Same graph write, same context refresh path.

**3. Another coding agent answers.** Agent B working on a different project encounters the same question, finds it in the graph via `resolve_decision`, and the existing Question + options give it enough context to make an inferred Decision. The Decision has status "inferred" — it still surfaces for human review but the first agent can proceed.

**The key insight:** `ask_question` is better than `create_provisional_decision` when the agent genuinely doesn't know the answer. A provisional decision says "I picked this, review it." A question says "I need input before proceeding." The graph distinguishes between them, and the feed renders them differently — DecisionReview cards for provisional decisions (approve/override), QuestionCards for questions (answer/discuss).

```
Coding agent hits uncertainty
  → Calls ask_question({ text, options, blocking_task })
  → Question entity created in graph
  → QuestionCard appears in feed
  → Human answers (feed, chat, or another agent resolves)
  → Decision entity created, linked to Question
  → Coding agent sees Decision on next context refresh
  → Proceeds with implementation
```

### Task Decomposition and Status Rollup

When a coding agent starts a task-scoped session, its first move is often to break the parent task into subtasks. This happens via `create_subtask` — each call creates a new Task with a SUBTASK_OF edge to the parent.

**Decomposition flow:**

```
Agent starts task-scoped session on "Implement rate limiting"
  → Agent analyzes what's needed
  → create_subtask("Add token bucket middleware")
  → create_subtask("Write rate limit config schema")
  → create_subtask("Add rate limit headers to responses")
  → Agent works through subtasks sequentially
  → update_task_status(subtask_1, "completed")
  → update_task_status(subtask_2, "completed")
  → update_task_status(subtask_3, "completed")
  → Parent task auto-completes
```

**Status rollup rules (computed, not stored):**

| Subtask states | Parent derived status |
|---------------|----------------------|
| All subtasks "completed" | "completed" |
| Any subtask "blocked", none "in_progress" | "blocked" |
| Any subtask "in_progress" | "in_progress" |
| Any subtask "blocked" + any "in_progress" | "partially_blocked" |
| All subtasks "todo" | "todo" (unchanged) |
| No subtasks exist | Parent status managed directly |

The rollup is computed by graph traversal on read, not stored as a field. When the feed or graph view queries a task's status and that task has SUBTASK_OF children, it traverses and computes. This means status is always current — no stale rollup values.

**Nesting:** Subtasks can have their own subtasks. "Add token bucket middleware" might decompose into "Implement bucket algorithm" and "Add Redis backing store." The rollup recurses — the grandparent's status reflects the leaves. Practically, 2-3 levels is the useful range; deeper nesting usually means the parent task should have been a Feature.

**Visibility in the graph:** Parent tasks show a progress indicator derived from subtask completion (e.g., "2/3 subtasks done"). Expanding a task node in the graph view shows its subtask tree. The feed shows subtask completions as lightweight items grouped under the parent.

**Cross-agent subtask coordination:** If two coding agents are working on the same parent task (in different sessions), they both create subtasks under the same parent. The graph prevents duplicate subtasks via semantic dedup — if Agent B tries to create a subtask that's semantically similar to one Agent A already created, the MCP server returns the existing subtask instead of creating a duplicate.

### Agent Session Logging

Every coding agent session is logged as a first-class entity in the graph. This serves three purposes: the graph knows what happened during implementation, other agents can reference agent sessions, and the human can review what agents did.

**AgentSession entity:**

```typescript
interface AgentSession {
  kind: "agent_session";
  agent: string;              // "claude-code" | "cursor" | "aider"
  directory: string;           // working directory path
  started_at: datetime;
  ended_at: datetime;
  workspace: string;
  project: string;            // inferred at session start via project inference chain
  task_id?: string;           // if started from a specific task (task-scoped session)
  
  // What happened
  summary: string;            // LLM-generated natural language summary
  decisions_made: string[];   // Decision entity IDs created during session
  questions_asked: string[];  // Question entity IDs created during session
  tasks_progressed: {
    task_id: string;
    from_status: string;
    to_status: string;
  }[];
  files_changed: {
    path: string;
    change_type: "created" | "modified" | "deleted";
  }[];
  
  // Relationships (edges)
  // BELONGS_TO → Project
  // PRODUCED → Decision (for each decision created)
  // ASKED → Question (for each question raised)
  // PROGRESSED → Task (for each task status change)
}
```

**When sessions are created:** The SessionEnd hook generates a structured summary (via Haiku prompt on the conversation), creates the AgentSession entity, and links it to all entities the agent interacted with during the session.

**How sessions appear in the graph:** As nodes connected to the project, decisions, questions, and tasks they touched. The graph view shows agent sessions as activity nodes — you can see "3 agent sessions this week on auth-service, produced 2 decisions, completed 4 tasks, raised 1 question."

**How sessions appear in the feed:** A SessionSummaryCard showing: agent name, duration, files changed count, decisions made, tasks progressed, questions raised. Clickable to expand into full session detail.

### Implementation Activity Tracking (Git Hooks)

Instead of intercepting individual file writes via PostToolUse (noisy, redundant — the agent saves files dozens of times during a session), track implementation activity from git commits. A commit is already a natural batch of related changes with a message explaining what was done.

**Two hooks, installed during `brain init`:**

**`pre-commit` hook — task resolution check:**

Before the commit is finalized, runs a lightweight LLM check (Haiku) that looks at the staged diff + commit message + the active task context and determines:

1. Does this commit complete a task or subtask? → Mark for status update
2. Does this commit partially resolve a task? → Note progress
3. Does this commit introduce a decision that should be logged? → Flag for provisional decision creation

```bash
#!/bin/sh
# .git/hooks/pre-commit
brain check-commit
# If it detects unlogged decisions, it can block the commit:
# "This commit changes the auth approach but no decision was logged. 
#  Run: brain log-decision 'Switch from JWT to session tokens'"
```

The pre-commit hook can also enforce governance: if the commit contradicts a confirmed decision in the graph, it warns the developer before they commit.

**`post-commit` hook — activity logging:**

After the commit lands, logs it to the graph:

```bash
#!/bin/sh
# .git/hooks/post-commit
brain log-commit
```

`brain log-commit` reads the commit and sends it to the MCP server:

```typescript
interface CommitActivity {
  sha: string;
  message: string;
  files_changed: {
    path: string;
    change_type: "added" | "modified" | "deleted";
    lines_added: number;
    lines_removed: number;
  }[];
  author: string;
  timestamp: string;
  project: string;              // inferred from directory cache
  task_updates: {               // populated by pre-commit analysis
    task_id: string;
    new_status: "completed" | "in_progress";
  }[];
  decisions_detected: {         // flagged by pre-commit analysis
    name: string;
    rationale: string;
  }[];
}
```

The MCP server:

1. Maps the commit to the active AgentSession (if one is running) or creates a standalone activity record
2. Updates task statuses based on the pre-commit analysis (subtask completed → status rollup fires on parent)
3. Creates provisional decisions for any flagged in pre-commit
4. Creates/updates IMPLEMENTED_BY edges between entities and the commit
5. Triggers description updates on affected features/projects

**Why git hooks, not PostToolUse:**
- A commit is a meaningful unit of work. A file save is not.
- Commit messages already describe what changed and why — free metadata.
- Pre-commit can catch task completion and unlogged decisions *before* they land.
- Works for both agent-driven and human-driven changes. If a developer manually fixes a bug without the agent, the graph still stays current.
- No need to batch or debounce — each commit is already batched by the developer/agent.
- Git hooks work with any agent (Claude Code, Cursor, Aider) and with no agent at all.

## Layer 3: Session End — Summary and Capture

### Stop Hook (Prompt-Based)

The existing Stop hook design catches unlogged decisions. Expand it to also generate a **session summary**:

```json
{
  "type": "prompt",
  "prompt": "Review this conversation and produce a JSON summary. Include:\n1. decisions_made: any architecture/design decisions (even small ones)\n2. decisions_referenced: existing decisions you relied on\n3. tasks_progressed: tasks you worked on and their new status\n4. questions_raised: unresolved questions that came up\n5. constraints_discovered: new constraints found during implementation\n6. files_changed: significant files created or modified\n\nIf any decisions were made but not logged via create_provisional_decision, respond with {\"decision\": \"block\", \"reason\": \"Log these decisions first: [list]\"}\nOtherwise respond with {\"decision\": \"approve\", \"summary\": <your JSON summary>}"
}
```

### SessionEnd Hook

After the Stop hook approves, SessionEnd fires and creates the AgentSession entity:

```typescript
async function onSessionEnd(summary: SessionSummary) {
  // 1. Create AgentSession entity in graph
  const session = await graph.create('agent_session', {
    agent: 'claude-code',
    directory: cwd,
    started_at: sessionStartTime,
    ended_at: now(),
    summary: summary.narrative,
    workspace: config.workspace,
    project: config.project,
    decisions_made: summary.decisions_made.map(d => d.id),
    questions_asked: summary.questions_asked.map(q => q.id),
    tasks_progressed: summary.tasks_progressed,
    files_changed: summary.files_changed,
  });
  
  // 2. Create edges: session PRODUCED decisions, ASKED questions, PROGRESSED tasks
  for (const decision of summary.decisions_made) {
    await graph.relate(session.id, 'PRODUCED', decision.id);
  }
  for (const question of summary.questions_asked) {
    await graph.relate(session.id, 'ASKED', question.id);
  }
  for (const task of summary.tasks_progressed) {
    await graph.relate(session.id, 'PROGRESSED', task.task_id);
  }
  
  // 3. Process any decisions that were made but not yet logged
  for (const decision of summary.decisions_made) {
    if (!decision.already_logged) {
      await mcpTools.create_provisional_decision({
        name: decision.name,
        rationale: decision.rationale,
        context: { project: config.project },
        options_considered: decision.alternatives || [],
      });
    }
  }
  
  // 4. Log questions that weren't explicitly asked via ask_question tool
  for (const question of summary.questions_raised) {
    if (!question.already_logged) {
      await mcpTools.ask_question({
        text: question.text,
        context: { project: config.project },
      });
    }
  }
  
  // 5. Update task statuses
  for (const task of summary.tasks_progressed) {
    await mcpTools.update_task_status({
      task_id: task.id,
      status: task.new_status,
      notes: task.notes,
    });
  }
  
  // 6. Log constraints discovered during implementation
  for (const constraint of summary.constraints_discovered) {
    await mcpTools.log_implementation_note({
      entity_id: constraint.related_entity,
      note: `Constraint discovered during implementation: ${constraint.text}`,
      files_changed: constraint.files,
    });
  }
  
  // 7. Update last_session timestamp for diff-since-last
  await updateConfig({ last_session: now() });
}
```

### What This Produces in the Graph

After a single Claude Code session, the graph gains:

- A **AgentSession** entity linked to the project, with edges to every entity it touched (PRODUCED → decisions, ASKED → questions, PROGRESSED → tasks)
- Any **provisional decisions** the agent made, surfaced in the feed for review
- Any **questions** the agent asked, surfaced in the feed for human (or agent) answers — answers become confirmed Decisions
- Updated **task statuses** (in_progress → completed)
- **Description updates** on features/projects reflecting what was built
- **IMPLEMENTED_BY** edges linking decisions to code changes
- **Implementation activity** records for file-level traceability

All of this is visible to the next agent that starts a session — whether that's the same coding agent tomorrow, a different coding agent on another project, or the Architect agent in the web chat. The graph is the shared memory.

## Cross-Agent Coordination

### Coding Agent → Web Chat Agents

When the coding agent creates a provisional decision, it appears in the feed as a DecisionReview card. The human can discuss it with the Architect agent in the web chat: "The coding agent decided to use token bucket for rate limiting — is that the right call?" The Architect can check constraints, suggest alternatives, or confirm the decision.

### Web Chat Agents → Coding Agent

When the Architect agent confirms a decision or the Management agent updates a task, those changes appear in the coding agent's context packet on next SessionStart. For long-running sessions, the UserPromptSubmit hook can refresh context periodically:

```json
{
  "hook": "UserPromptSubmit",
  "command": "brain system check-for-updates --since=$LAST_CHECK"
}
```

If critical changes happened (decision superseded, hard conflict detected), the hook injects an alert into the coding agent's context: "⚠️ Context update: Decision 'Use JWT' was superseded by 'Use session tokens' 20 minutes ago by [human] via chat. Your current work on JWT middleware may need to change."

### Coding Agent → Coding Agent (Cross-Project)

Two coding agents working on different projects within the monorepo coordinate through the graph automatically. Agent A working on the auth service creates a provisional decision about the token format. Agent B working on the billing service starts a session an hour later, sees the decision in its context packet, and implements against it. No message passing needed — the graph is the coordination layer.

### Priority Escalation

Not all cross-agent updates are equal. The context refresh classifies updates by severity:

| Severity | Trigger | Behavior |
|----------|---------|----------|
| **Critical** | Decision that current work depends on was superseded or contested | Inject immediately via UserPromptSubmit hook |
| **Important** | New decision in same project area, task dependency completed | Include in next context refresh (every 10 min or on user prompt) |
| **Informational** | Task completed in another project, new suggestion created | Include in next SessionStart only |

## Workspace Initialization: `brain init`

```bash
$ brain init

🧠 Connecting to your workspace...

Workspace: Marcus's Workspace (ws:abc123)
API key: ••••••••••••

✅ Connected. Project will be inferred automatically per directory.

Configuration saved to ~/.brain/config.json
Plugin hooks active:
  SessionStart  → infers project, loads context
  PreToolUse    → checks constraints
  Stop          → catches unlogged decisions + questions
  SessionEnd    → logs session to graph

Git hooks installed:
  pre-commit    → checks if commit resolves tasks, flags unlogged decisions, enforces constraints
  post-commit   → logs commit to graph (files changed, task updates, IMPLEMENTED_BY edges)
```

One-time setup per workspace. Run it from anywhere in the monorepo. Project inference happens automatically based on which directory the agent is working in.

## MCP Server Endpoints

The MCP server runs as a standalone Hono service (same backend as the web chat, or separate microservice):

```
POST /mcp/tools/get_project_context
POST /mcp/tools/get_active_decisions
POST /mcp/tools/get_task_dependencies
POST /mcp/tools/get_architecture_constraints
POST /mcp/tools/get_recent_changes
POST /mcp/tools/get_entity_detail
POST /mcp/tools/resolve_decision
POST /mcp/tools/check_constraints
POST /mcp/tools/create_provisional_decision
POST /mcp/tools/ask_question
POST /mcp/tools/update_task_status
POST /mcp/tools/create_subtask
POST /mcp/tools/log_implementation_note
POST /mcp/tools/log_commit
POST /mcp/tools/session_start
POST /mcp/tools/session_end
```

Auth: API key per workspace, set during `brain init`, stored in `~/.brain/config.json`.

## Phasing

### Phase 3 (Weeks 5-6): MCP v1

- `brain init` CLI with workspace auth (project inferred automatically per directory)
- SessionStart hook → `get_project_context` with token-budgeted context packet
- Tier 1 read tools: `get_project_context`, `get_active_decisions`
- Tier 2 reasoning tools: `resolve_decision`, `check_constraints`
- Stop hook (prompt-based) catches unlogged decisions
- Claude Code plugin packaging (hooks.json + MCP config)
- Test by dogfooding: build the platform with the plugin active

### Phase 4 (Weeks 7-8): MCP v2

- Tier 3 write tools: `create_provisional_decision`, `update_task_status`, `log_implementation_note`
- Git post-commit hook → implementation activity tracking via commits
- SessionEnd hook → full session summary + entity creation
- `get_task_dependencies`, `get_architecture_constraints`, `get_recent_changes` read tools
- UserPromptSubmit hook → periodic context refresh with priority escalation
- Publish MCP server config for Cursor and other agents
- Governance enforcement: agents can create provisional/inferred but never confirmed

### Phase 5: Agent Coordinator Integration

- SurrealDB live queries fire on coding agent writes
- Agent Coordinator routes events to web chat agents
- Critical updates interrupt active agent sessions via hook injection
- AgentSession entities visible in the OS desktop as status windows
- Cross-project coordination via shared graph (no explicit agent-to-agent messaging)

## Key Design Decisions

1. **Graph as coordination, not messages.** Coding agents never send messages to other agents. They write to the graph; other agents read from the graph. The graph is the single source of truth.

2. **Hooks do the heavy lifting, not the agent.** The agent doesn't need to know it's connected to a knowledge graph. It just starts coding and receives context. The hooks handle session lifecycle, implementation tracking, and decision capture transparently.

3. **Provisional by default.** Every decision a coding agent creates is provisional. Only humans confirm. This means agents can move fast without blocking, while humans retain authority. **Future: Architect agent as decision authority.** Once the authority/autonomy layer ships (Phase 4), the Architect agent should be able to answer coding agent questions and confirm decisions — not just humans. A coding agent asks "REST or tRPC?", the Architect checks constraints, makes the call, and confirms it. The human sees it in the feed as a confirmed decision with full reasoning, and can override if needed. This requires the configurable autonomy scopes (auto/provisional/approve per agent per action type) to be in place so the human controls which decisions the Architect can confirm autonomously. **Track as GitHub issue: "Allow Architect agent to answer coding agent questions and confirm decisions via authority scopes."**

4. **Context-aware, not context-flooded.** The token budget ensures the context packet is useful, not overwhelming. Most sessions need 2000-4000 tokens of context. The priority ordering ensures the most important information always fits.

5. **Config stores auth, not mapping.** `brain init` sets up workspace authentication once. Project inference happens at runtime — directory name, README, package.json, git remote, previous sessions. If inference fails, the agent asks once and the answer is cached per directory. Zero per-project configuration.

6. **File-to-entity mapping is inferred, not configured.** The system maps file changes to entities based on which task the agent is working on during that session. No manual file pattern mapping needed. As the system observes patterns over time, it gets better at inferring relationships automatically.