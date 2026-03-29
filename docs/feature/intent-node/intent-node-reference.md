# Intent Node: Technical Reference

The intent node is the system through which coding agents interact with the Osabio knowledge graph. It has two pipelines that serve different purposes at different points in the agent lifecycle:

1. **Context Pipeline** — resolves an agent's natural-language intent to the right scope of graph context
2. **Evaluation Pipeline** — authorizes a concrete agent action through policy checks, LLM risk assessment, and optional human veto

```
Agent Lifecycle
═══════════════

 ┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
 │  1. ORIENT   │────▶│  2. PLAN          │────▶│  3. ACT            │
 │              │     │                   │     │                    │
 │ "What do I   │     │ Agent decides on  │     │ Agent declares a   │
 │  need to     │     │ a course of       │     │ concrete action    │
 │  know?"      │     │ action            │     │ and requests auth  │
 └──────┬───────┘     └───────────────────┘     └────────┬───────────┘
        │                                                │
   Context Pipeline                                Evaluation Pipeline
   POST /api/mcp/:ws/context                       POST /api/intents/:id/evaluate
```

---

## Context Pipeline

**Purpose:** Give an agent the right slice of the knowledge graph before it starts working.

**Endpoint:** `POST /api/mcp/:workspaceId/context`

**Auth:** OAuth2 Bearer token (MCP scope: `graph:read`)

### Input

```typescript
type IntentContextInput = {
  intent: string;      // Natural language: "I'm implementing Redis caching for auth tokens"
  cwd?: string;        // Agent's working directory (optional path hint)
  paths?: string[];    // Files the agent is looking at (optional path hints)
};
```

### Output

A discriminated union at one of three scope levels:

| Level | When | What you get |
|-------|------|--------------|
| `task` | Intent matches a specific task (explicit `task:id` ref or high vector similarity) | Task subgraph: subtasks, parent feature, sibling tasks, dependencies, related sessions, project hot items |
| `project` | Intent matches a project (explicit ref, single-project workspace, vector match, or path match) | Full project context: decisions (confirmed/provisional/contested), active tasks, open questions, observations, suggestions, active sessions |
| `workspace` | No specific match (ambiguous intent, multi-project, no signals) | Workspace overview: all projects with entity counts, hot items, active sessions |

### Resolution Strategy (waterfall)

The resolver tries strategies in order, falling through on failure:

```
1. Explicit entity ref       "I'm working on task:abc123"
   ├─ task:ID found?  ──▶ task-level context
   └─ project:ID found? ──▶ project-level context

2. Single-project shortcut   Workspace has exactly 1 project
   └─ ──▶ project-level context

3. Vector search              Embed intent text, KNN against all entity embeddings
   ├─ Top match score > 0.3 and kind=task? ──▶ task-level context
   └─ Top match resolves to project? ──▶ project-level context

4. Path matching              Tokenize cwd/paths, overlap with project names
   └─ Best overlap > 0? ──▶ project-level context

5. Fallback
   └─ ──▶ workspace-level overview
```

### Key source files

| File | Role |
|------|------|
| `app/src/server/mcp/intent-context.ts` | Resolution logic (waterfall strategy) |
| `app/src/server/mcp/context-builder.ts` | Builds context packets at each scope level |
| `app/src/server/mcp/types.ts` | `ContextPacket`, `TaskContextPacket`, `WorkspaceOverview` types |
| `app/src/server/mcp/mcp-route.ts` | HTTP handler (parses request, calls resolver, returns JSON) |

### Context packet shapes

**Task-level** (`TaskContextPacket`):
- `workspace` — id, name
- `project` — id, name, status (resolved from `belongs_to` edge)
- `task_scope` — the task itself, subtasks, parent feature, sibling tasks, dependencies, related agent sessions
- `hot_items` — contested decisions, open observations, pending suggestions
- `active_sessions` — other agents currently working in this project

**Project-level** (`ContextPacket`):
- `workspace`, `project`
- `decisions` — grouped by status: confirmed, provisional, contested
- `active_tasks` — non-completed tasks in the project
- `open_questions` — unresolved questions
- `observations` — open/acknowledged observations
- `pending_suggestions` — pending/deferred suggestions
- `active_sessions` — other agents currently working
- `recent_changes` — entities changed since a timestamp (optional)

**Workspace-level** (`WorkspaceOverview`):
- `workspace`
- `projects[]` — each with entity counts (tasks, decisions, features, questions)
- `hot_items` — workspace-wide contested decisions, observations, suggestions
- `active_sessions` — all active agent sessions

---

## Evaluation Pipeline

**Purpose:** Authorize a concrete agent action before it executes. Creates an auditable authorization chain.

**Trigger:** SurrealQL EVENT fires `http::post` when an intent transitions to `pending_auth`.

**Endpoint:** `POST /api/intents/:id/evaluate` (internal — called by SurrealDB, not by agents directly)

### Intent lifecycle

```
              ┌──────────────────────────────────────────┐
              │           Intent Status Machine           │
              │                                          │
              │  draft ──▶ pending_auth ──┬──▶ authorized ──▶ executing ──┬──▶ completed
              │                          │                               └──▶ failed
              │                          ├──▶ pending_veto ──┬──▶ authorized
              │                          │                   └──▶ vetoed
              │                          ├──▶ vetoed
              │                          └──▶ failed
              └──────────────────────────────────────────┘
```

Terminal states: `completed`, `vetoed`, `failed`.

### Intent record

```typescript
type IntentRecord = {
  id: RecordId<"intent", string>;
  goal: string;                    // "Add Redis caching layer for session tokens"
  reasoning: string;               // Agent's justification for this action
  status: IntentStatus;
  priority: number;
  action_spec: {
    provider: string;              // "filesystem", "git", "api", etc.
    action: string;                // "edit_file", "delete", "deploy", etc.
    params?: Record<string, unknown>;
  };
  budget_limit?: { amount: number; currency: string };
  evaluation?: {
    decision: "APPROVE" | "REJECT";
    risk_score: number;            // 0-100
    reason: string;
    evaluated_at: Date;
    policy_only: boolean;          // true = LLM was skipped (policy rejection or LLM failure)
  };
  veto_expires_at?: Date;
  veto_reason?: string;
  error_reason?: string;
  trace_id: string;
  requester: RecordId<"identity", string>;
  workspace: RecordId<"workspace", string>;
  created_at: Date;
};
```

### Authorization pipeline stages

```
┌─────────────────┐     ┌────────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  1. Policy Gate  │────▶│  2. LLM Evaluator   │────▶│  3. Risk      │────▶│  4. Status       │
│  (pure)          │     │  (Haiku)            │     │  Router       │     │  Update          │
│                  │     │                     │     │  (pure)       │     │                  │
│ Budget cap?      │     │ Least-privilege?    │     │ score ≤ 30:   │     │ authorized |     │
│ Action allowed?  │     │ Scope boundaries?   │     │  auto-approve │     │ pending_veto |   │
│                  │     │ Reasoning quality?  │     │ score > 30:   │     │ vetoed           │
│ Fail ──▶ REJECT  │     │ Prompt injection?   │     │  veto window  │     │                  │
│ (policy_only)    │     │                     │     │ REJECT:       │     │                  │
│                  │     │ Fail ──▶ fallback   │     │  reject       │     │                  │
│                  │     │ (score=50, veto)    │     │               │     │                  │
└─────────────────┘     └────────────────────┘     └──────────────┘     └─────────────────┘
```

**Stage 1 — Policy Gate** (`authorizer.ts:checkPolicyGate`): Pure function. Checks hard rules — budget cap exceeded? Action not on allowlist? Short-circuits to `REJECT` with `policy_only: true`.

**Stage 2 — LLM Evaluator** (`authorizer.ts:createLlmEvaluator`): Calls Haiku via `generateObject` with structured output schema. Assesses: least-privilege compliance, scope boundaries, reasoning quality, prompt injection risk. Returns `{ decision, risk_score, reason }`. On timeout (30s) or error, falls back to `{ decision: "APPROVE", risk_score: 50, policy_only: true }` — routes through veto window so a human reviews.

**Stage 3 — Risk Router** (`risk-router.ts:routeByRisk`): Pure function. Maps evaluation result to routing decision:

| Condition | Route | Effect |
|-----------|-------|--------|
| `decision = REJECT` | `reject` | Intent → `vetoed` |
| `decision = APPROVE` and `risk_score ≤ 30` | `auto_approve` | Intent → `authorized` |
| `decision = APPROVE` and `risk_score > 30` | `veto_window` | Intent → `pending_veto`, timer starts |

**Stage 4 — Veto Window** (`veto-manager.ts`): For medium-risk intents. Opens a 30-minute window where the workspace owner can veto via `POST /api/intents/:id/veto`. If no veto arrives, auto-approves on expiry. On server restart, recovers expired windows.

### Key source files

| File | Role |
|------|------|
| `app/src/server/intent/types.ts` | `IntentRecord`, `IntentStatus`, `EvaluationResult`, `RoutingDecision` |
| `app/src/server/intent/status-machine.ts` | Pure transition validator |
| `app/src/server/intent/authorizer.ts` | Policy gate + LLM evaluator + pipeline orchestration |
| `app/src/server/intent/risk-router.ts` | Pure risk score → routing decision |
| `app/src/server/intent/veto-manager.ts` | Veto window timer lifecycle |
| `app/src/server/intent/intent-queries.ts` | SurrealDB CRUD, status updates with transition validation |
| `app/src/server/intent/intent-routes.ts` | HTTP handlers (evaluate, veto, list pending) |

---

## How They Relate

The two pipelines are independent but complementary. They share the word "intent" but operate at different granularities:

| | Context Pipeline | Evaluation Pipeline |
|---|---|---|
| **When** | Before work starts | When a specific action is requested |
| **Intent granularity** | Vague: "I'm working on payment webhooks" | Concrete: "edit src/payments/stripe.ts" |
| **Cardinality** | 1 per agent session (typically) | N per session (one per consequential action) |
| **Input** | Natural language + optional paths | Structured `IntentRecord` with `action_spec` |
| **Output** | Read-only context packet | Authorization decision |
| **LLM usage** | Embedding model (vector search) | Haiku (structured risk assessment) |
| **Human involvement** | None | Optional veto for medium-risk |
| **Side effects** | None (pure read) | Status transitions, veto timers, SSE events |

**Current gap:** The evaluation pipeline does not receive context from the context pipeline. The LLM evaluator assesses risk based only on the intent's `goal`, `reasoning`, and `action_spec` — it doesn't know which project/task the agent is working on or what decisions have been made. Feeding resolved context into the evaluator would improve risk assessment accuracy (e.g., "this file edit is within the agent's assigned task scope" → lower risk).

---

## Testing

### Context Pipeline

Acceptance tests in `tests/acceptance/workspace/intent-context.test.ts`:
- Explicit `task:id` and `project:id` resolution
- Single-project workspace shortcut
- Multi-project with `cwd` path matching
- Vector search resolution (requires real embeddings via OpenRouter)
- Ambiguous intent fallback to workspace overview
- Nonexistent task ID graceful fallback

All tests are end-to-end: real SurrealDB, real OAuth, real embedding model.

### Evaluation Pipeline

**Full E2E (real LLM):** `tests/acceptance/intent-node/walking-skeleton.test.ts`
- Wires the SurrealQL EVENT via `wireIntentEvaluationEvent()` for true async flow
- Two skeletons: low-risk auto-approve, high-risk veto flow
- Asserts real LLM evaluation output (decision, risk_score, reason)

**Simulated evaluation:** All other test files use `simulateEvaluation()` from `intent-test-kit.ts` to hardcode evaluation results, testing the surrounding machinery:
- `milestone-1-authorization-pipeline.test.ts` — policy gate, risk routing, auto-approve threshold, veto window entry
- `milestone-2-veto-and-execution.test.ts` — veto flow, auto-approve on expiry, execution lifecycle
- `milestone-3-observability.test.ts` — governance feed, audit trail, timeout handling, LLM fallback

### Test kit

`tests/acceptance/intent-node/intent-test-kit.ts` provides:
- `createDraftIntent()` — seed an intent record
- `submitIntent()` — transition draft → pending_auth
- `simulateEvaluation()` — bypass LLM, write evaluation result directly
- `wireIntentEvaluationEvent()` — define the SurrealQL EVENT pointing at the real evaluate endpoint
- `getIntentEvaluation()` — query evaluation result from DB
- `waitForIntentStatus()` — poll until intent reaches expected status (for async flows)
