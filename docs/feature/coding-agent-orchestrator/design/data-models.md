# Coding Agent Orchestrator -- Data Models

## Schema Changes to `agent_session`

The existing `agent_session` table already has most fields needed. New fields track orchestrator-specific state: OpenCode session ID, worktree metadata, and orchestrator status.

### New Fields (Migration 0014)

```sql
-- Orchestrator lifecycle fields
DEFINE FIELD OVERWRITE opencode_session_id ON agent_session TYPE option<string>;
DEFINE FIELD OVERWRITE orchestrator_status ON agent_session TYPE option<string>
  ASSERT $value IS NONE OR $value IN ["spawning", "active", "idle", "completed", "aborted", "error"];
DEFINE FIELD OVERWRITE worktree_branch ON agent_session TYPE option<string>;
DEFINE FIELD OVERWRITE worktree_path ON agent_session TYPE option<string>;
DEFINE FIELD OVERWRITE stream_id ON agent_session TYPE option<string>;
DEFINE FIELD OVERWRITE last_event_at ON agent_session TYPE option<datetime>;
DEFINE FIELD OVERWRITE error_message ON agent_session TYPE option<string>;

-- Index for active session lookup (one-agent-per-task guard)
DEFINE INDEX OVERWRITE agent_session_task_active ON agent_session
  FIELDS task_id, orchestrator_status;
```

### Complete `agent_session` Field Map (After Migration)

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `agent` | string | Existing | Agent identifier (e.g. "opencode") |
| `started_at` | datetime | Existing | Session start time |
| `ended_at` | option<datetime> | Existing | Session end time |
| `workspace` | record<workspace> | Existing | Workspace scope |
| `project` | option<record<project>> | Existing | Project scope |
| `task_id` | option<record<task>> | Existing | Assigned task |
| `summary` | option<string> | Existing | Session summary (set on end) |
| `decisions_made` | option<array<record<decision>>> | Existing | Decisions produced during session |
| `questions_asked` | option<array<record<question>>> | Existing | Questions raised |
| `tasks_progressed` | option<array<object>> | Existing | Task status transitions |
| `files_changed` | option<array<object>> | Existing | Files modified |
| `observations_logged` | option<array<record<observation>>> | Existing | Observations created |
| `created_at` | datetime | Existing | Record creation time |
| `opencode_session_id` | option<string> | **New** | OpenCode session identifier |
| `orchestrator_status` | option<string> | **New** | Orchestrator lifecycle state |
| `worktree_branch` | option<string> | **New** | Git branch name (e.g. "agent/fix-login-bug") |
| `worktree_path` | option<string> | **New** | Filesystem path to worktree |
| `stream_id` | option<string> | **New** | SSE stream ID for event bridging |
| `last_event_at` | option<datetime> | **New** | Last OpenCode event timestamp (stall detection) |
| `error_message` | option<string> | **New** | Error details if orchestrator_status = "error" |

### Orchestrator Status State Machine

```
spawning -> active     (OpenCode session created, first message sent)
active   -> idle       (Agent completed current chat turn, awaiting feedback)
active   -> completed  (Agent finished task, session ended normally)
active   -> error      (OpenCode process error or timeout)
active   -> aborted    (User or system initiated abort)
idle     -> active     (Rejection feedback sent, agent resumes)
idle     -> completed  (User accepts work)
idle     -> aborted    (User or system aborts)
spawning -> error      (OpenCode failed to start within timeout)
```

## Query: One-Agent-Per-Task Guard

```sql
SELECT id FROM agent_session
WHERE task_id = $taskRecord
  AND orchestrator_status IN ["spawning", "active", "idle"]
LIMIT 1;
```

If this returns a row, assignment is rejected (409 Conflict).

## Query: Active Sessions for Workspace

```sql
SELECT id, agent, task_id, orchestrator_status, worktree_branch,
       started_at, last_event_at, stream_id
FROM agent_session
WHERE workspace = $workspace
  AND orchestrator_status IN ["spawning", "active", "idle"]
ORDER BY started_at DESC;
```

## SSE Event Types (New StreamEvent Variants)

Added to `StreamEvent` union in `shared/contracts.ts`:

```typescript
type AgentTokenEvent = {
  type: "agent_token";
  sessionId: string;
  token: string;
};

type AgentFileChangeEvent = {
  type: "agent_file_change";
  sessionId: string;
  file: string;
  changeType: "created" | "modified" | "deleted";
};

type AgentStatusEvent = {
  type: "agent_status";
  sessionId: string;
  status: "active" | "idle" | "completed" | "aborted" | "error";
  error?: string;
};

type AgentStallWarningEvent = {
  type: "agent_stall_warning";
  sessionId: string;
  lastEventAt: string;
  stallDurationSeconds: number;
};
```

## In-Memory Registry (Not Persisted)

The `OrchestratorRegistry` holds runtime references that cannot be persisted:

```typescript
type ActiveSession = {
  agentSessionId: string;
  opencodeSessionId: string;
  opencodeClient: OpencodeClient;
  serverClose: () => void;
  abortController: AbortController;
  worktreePath: string;
  branchName: string;
  streamId: string;
  eventBridgeStop: () => void;
};
```

This is an in-memory `Map<string, ActiveSession>` keyed by `agentSessionId`. On server restart, orphaned sessions are detected by querying `agent_session` records with `orchestrator_status IN ["spawning", "active", "idle"]` and marking them as `error` (the OpenCode processes died with the server).

## Diff Response Shape

The review endpoint returns:

```typescript
type ReviewResponse = {
  agentSessionId: string;
  taskId: string;
  taskTitle: string;
  summary?: string;
  diff: {
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      additions: number;
      deletions: number;
    }>;
    rawDiff: string;
    stats: {
      filesChanged: number;
      insertions: number;
      deletions: number;
    };
  };
  session: {
    startedAt: string;
    lastEventAt?: string;
    decisionsCount: number;
    questionsCount: number;
    observationsCount: number;
  };
};
```
