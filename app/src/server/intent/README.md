# Intent

Intent lifecycle management — from draft creation through LLM evaluation, risk-based routing, veto windows, to execution authorization.

## The Problem

When an agent wants to take a high-stakes action (merge code, spend budget, deploy infrastructure), it shouldn't just do it. The action needs evaluation: Is it aligned with objectives? What's the risk? Should a human review it first? The intent system turns every significant agent action into a structured request that flows through evaluation, risk routing, and optional human veto before execution.

## What It Does

- **Status state machine**: `draft -> pending_auth -> (authorized | pending_veto | vetoed | failed) -> executing -> (completed | failed)`
- **LLM evaluation**: Calls an LLM to assess intent alignment with objectives and produce a risk score
- **Risk-based routing**: Auto-approve (risk <= 30), veto window (risk > 30), or reject — with policy override for `humanVetoRequired`
- **Veto window management**: 30-minute default window where humans can reject before auto-approval
- **Objective alignment**: KNN search on objective embeddings to find aligned strategic goals

## Key Concepts

| Term | Definition |
|------|------------|
| **Intent** | A structured request from an agent to perform an action, carrying full authorization context |
| **IntentStatus** | 8-state lifecycle: `draft`, `pending_auth`, `authorized`, `pending_veto`, `vetoed`, `failed`, `executing`, `completed` |
| **EvaluationResult** | LLM output: `{ decision: APPROVE|REJECT, risk_score: 0-100, reason: string }` |
| **RoutingDecision** | Discriminated union: `auto_approve`, `veto_window`, or `reject` — determined by risk score and policy |
| **Veto Window** | Time-boxed period (default 30 min) where a human can reject an intent before it auto-approves |
| **ActionSpec** | `{ provider, action, params }` — the concrete action the intent requests |

## How It Works

**Example — agent requests a code merge:**

1. Agent creates intent: `{ action: { provider: "github", action: "merge_pr", params: { pr: 42 } }, goal: "Merge rate limiting implementation" }`
2. Intent status: `draft` → `pending_auth`
3. `POST /api/intents/:id/evaluate` triggers evaluation:
   - `evaluateIntent()` calls LLM with intent details + objective context
   - LLM returns: `{ decision: "APPROVE", risk_score: 45, reason: "Aligns with Q1 goal but modifies critical path" }`
4. `routeByRisk(45)` → risk > 30 → `veto_window`
5. Intent status: `pending_auth` → `pending_veto`
6. `veto-manager` starts 30-minute timer
7. Human sees intent in feed → either vetoes or lets timer expire
8. Timer expires → `autoApprove()` → status: `pending_veto` → `authorized`
9. Orchestrator picks up authorized intent → status: `authorized` → `executing`

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Policy humanVetoRequired** | Forces veto_window regardless of risk score |
| **Invalid transition** | Logged and rejected with 409 Conflict |
| **Timer cleanup** | Must clear on manual veto to prevent double-approval |
| **Idempotency** | Only processes intents in `pending_auth` status |
| **Workspace mismatch** | Intent must belong to the session's workspace — 403 on mismatch |

## Where It Fits

```text
Agent Action Request
  |
  v
Intent Created (draft)
  |
  v
Evaluation (LLM)
  +---> risk_score + decision
  |
  v
Risk Router
  +---> risk <= 30 ---------> auto_approve --> authorized
  +---> risk > 30 ----------> veto_window --> pending_veto
  +---> decision = REJECT --> failed
  |
  v (if veto_window)
Human Review (30 min)
  +---> Veto --> vetoed
  +---> Timer expires --> authorized
  |
  v
Orchestrator picks up authorized intent
  |
  v
executing --> completed | failed
```

**Consumes**: Agent action requests, objective embeddings, policy constraints
**Produces**: Authorization decisions, veto window events, intent status transitions

## File Structure

```text
intent/
  types.ts            # IntentStatus, ActionSpec, BudgetLimit, EvaluationResult, RoutingDecision
  status-machine.ts   # Pure state transitions with TRANSITION_MAP validation
  authorizer.ts       # LLM evaluation + objective alignment via KNN ports
  risk-router.ts      # Risk threshold routing: auto_approve / veto_window / reject
  veto-manager.ts     # Timer-based veto window with auto-approve on expiry
  intent-queries.ts   # SurrealDB CRUD: createIntent, getIntentById, updateIntentStatus
  intent-routes.ts    # HTTP endpoints: evaluate, list pending, veto/approve
```
