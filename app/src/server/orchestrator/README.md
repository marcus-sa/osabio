# Orchestrator

Coding agent session lifecycle — assigns tasks, spawns agents in git worktrees, streams events via SSE, and manages review/accept/reject/abort flows.

## The Problem

When a task needs to be implemented, a coding agent (Claude Agent SDK) must be spawned in an isolated environment, given the right context, monitored for progress, and supervised by a human. The orchestrator manages this entire lifecycle: from task assignment validation through agent spawning, event streaming, stall detection, to the final human review where work is accepted, rejected (with feedback), or aborted.

## What It Does

- **Task assignment validation**: Checks task status (ready/todo), workspace membership, and ensures no active session already exists
- **Git worktree isolation**: Creates a dedicated git worktree per session so agents work on isolated branches
- **Agent spawning**: Launches Claude Agent SDK with `/osabio-start-task` prompt, injecting workspace and Osabio context
- **SSE event streaming**: Bridges agent SDK messages to SSE for real-time UI updates
- **Stall detection**: Monitors agent activity and auto-aborts sessions that go silent
- **Human review flow**: Idle agents produce diffs for review → accept (mark done) / reject (resume with feedback) / abort (clean up)
- **Intent authorization gate**: Optionally requires an authorized intent before spawning

## Key Concepts

| Term | Definition |
|------|------------|
| **OrchestratorStatus** | Session states: `spawning`, `active`, `idle`, `completed`, `aborted`, `error` |
| **Agent Handle** | In-memory reference to a running agent process — used for abort and event iteration |
| **Worktree** | Isolated git working directory with its own branch, created per session, cleaned up on abort |
| **Event Bridge** | Transforms SDK messages into SSE-compatible `StreamEvent` objects |
| **Stall Detector** | Timer-based monitor that aborts sessions with no activity past a threshold |
| **Review** | When agent reaches `idle`, human sees diff + session stats → decides accept/reject/abort |

## How It Works

**Example — assigning and running a task:**

1. `POST /api/orchestrator/:workspaceId/sessions` with `{ taskId: "abc123" }`
2. Validate: task exists, status is `ready` or `todo`, no active session, workspace matches
3. Create git worktree: `git worktree add .claude/worktrees/<slug> -b <branch>`
4. Create `agent_session` record in SurrealDB with `orchestrator_status: "spawning"`
5. Spawn Claude Agent SDK with `/osabio-start-task abc123` in the worktree directory
6. Register SSE stream → event iteration starts
7. First SDK message → status: `spawning` → `active`
8. Agent works: tool calls, file edits, decisions logged
9. Agent finishes → stream ends → status: `active` → `idle`
10. Human reviews diff → accepts → status: `idle` → `completed`, task → `done`

**Reject flow:**

1. Human reviews diff, finds issues → `POST /sessions/:id/reject` with feedback
2. Status: `idle` → `active`, task → `in_progress`
3. Agent receives feedback, resumes work
4. Agent finishes again → `idle` → human reviews again

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Agent already active for task** | 409 — only one active session per task |
| **Spawn failure** | Rollback: remove worktree, delete session record |
| **Stall detected** | Auto-abort after configurable inactivity threshold |
| **Agent produces zero messages** | Warning logged, handle cleaned up |
| **Abort during active work** | Agent process killed, worktree removed, task returned to `ready` |
| **Intent not authorized** | 403 — intent must be in `authorized` status |

## Where It Fits

```text
Task Assignment Request
  |
  v
Assignment Validation
  +---> task exists? status ready/todo?
  +---> no active session? workspace matches?
  |
  v
Create Worktree (git worktree add)
  |
  v
Spawn Agent (Claude Agent SDK)
  |
  v
Event Iteration (SSE Bridge)
  +---> spawning -> active (first message)
  +---> active -> idle (stream ends)
  +---> stall detector monitors activity
  |
  v
Human Review
  +---> GET /review -> diff + session stats
  +---> POST /accept -> completed, task done
  +---> POST /reject -> active (resume with feedback)
  +---> POST /abort -> aborted, worktree removed
```

**Consumes**: Task records, workspace config, intent authorization
**Produces**: Agent sessions, SSE events, diffs, session status updates

## File Structure

```text
orchestrator/
  routes.ts              # HTTP route handlers (pure request->response, DI via OrchestratorRouteDeps)
  session-lifecycle.ts   # Core lifecycle: create, status, abort, accept, reject, prompt, review
  assignment-guard.ts    # Task eligibility validation (status, workspace, no duplicate sessions)
  spawn-agent.ts         # Claude Agent SDK spawning with config injection
  agent-options.ts       # AgentSpawnConfig type (prompt, workDir, workspaceId, brainBaseUrl)
  event-bridge.ts        # Transform SDK messages to SSE StreamEvent objects
  stall-detector.ts      # Timer-based inactivity monitor with auto-abort
  worktree-manager.ts    # Git worktree create/remove/diff operations via shell exec
  types.ts               # OrchestratorStatus, AssignmentValidation, AssignmentError types
```
