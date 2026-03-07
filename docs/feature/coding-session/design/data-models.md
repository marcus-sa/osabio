# Coding Session -- Data Models

## Existing Schema (No Changes Required)

The `agent_session` table already has all fields needed for session lifecycle:

```
agent_session (SCHEMAFULL)
  agent: string
  started_at: datetime
  ended_at: option<datetime>
  workspace: record<workspace>
  task_id: option<record<task>>
  orchestrator_status: option<string>  -- "spawning" | "active" | "idle" | "completed" | "aborted" | "error"
  worktree_branch: option<string>
  worktree_path: option<string>
  stream_id: option<string>
  opencode_session_id: option<string>
  last_event_at: option<datetime>
  last_feedback: option<string>
  error_message: option<string>
  files_changed: option<array<object>>
  ...
```

## New Schema: Conversation Log

New field on `agent_session` to store the conversation log inline. Simpler than a separate table -- each session has exactly one log, entries are always accessed together, and sessions are short-lived.

### Schema Migration

```
DEFINE FIELD conversation_log ON agent_session TYPE option<array<object>>;
DEFINE FIELD conversation_log[*].entry_type ON agent_session TYPE string
  ASSERT $value IN ["agent_text", "file_change", "user_prompt", "status_change", "stall_warning"];
DEFINE FIELD conversation_log[*].timestamp ON agent_session TYPE datetime;
DEFINE FIELD conversation_log[*].content ON agent_session TYPE option<string>;
DEFINE FIELD conversation_log[*].file ON agent_session TYPE option<string>;
DEFINE FIELD conversation_log[*].change_type ON agent_session TYPE option<string>;
DEFINE FIELD conversation_log[*].status ON agent_session TYPE option<string>;
```

### Log Entry Types

| entry_type | content | file | change_type | status | When |
|-----------|---------|------|-------------|--------|------|
| `agent_text` | Token text (batched) | - | - | - | On `agent_token` events (batched per message turn) |
| `file_change` | - | File path | created/modified/deleted | - | On `agent_file_change` event |
| `user_prompt` | Prompt text | - | - | - | On POST /prompt or reject-with-feedback |
| `status_change` | - | - | - | active/idle/completed/error/aborted | On `agent_status` event |
| `stall_warning` | Warning message | - | - | - | On stall detection |

### Token Batching Strategy

`agent_token` events arrive as individual tokens (words/fragments). Appending each as a separate log entry would create thousands of entries. Instead:

- Accumulate tokens in memory during a message turn
- Flush as a single `agent_text` log entry when:
  - A `status_change` to `idle` occurs (turn complete)
  - A `user_prompt` is received (new turn boundary)
  - A configurable flush interval elapses (30s safety net)

This keeps the log at ~10-50 entries per session instead of thousands.

## Shared Contract Types

### AgentPromptEvent (new StreamEvent variant)

```
type: "agent_prompt"
sessionId: string
text: string
```

Emitted to SSE when a user sends a follow-up prompt. Allows the client to render user messages inline in the output stream without polling.

### ConversationLogEntry (new shared type)

```
entryType: "agent_text" | "file_change" | "user_prompt" | "status_change" | "stall_warning"
timestamp: string (ISO)
content?: string
file?: string
changeType?: string
status?: string
```

Used in the GET /log response and by the AgentLogView component.

## Client-Side State

### Extended AgentSessionState

The `useAgentSession` hook state adds:

- `tokens: Array<{ text: string; timestamp: string }>` -- accumulated token stream entries
- `fileChanges: Array<{ file: string; changeType: string; timestamp: string }>` -- inline file change notifications
- `userPrompts: Array<{ text: string; timestamp: string }>` -- echoed user prompts

These are interleaved by timestamp in the AgentSessionOutput component for chronological display.

## API Contracts

### POST /api/orchestrator/:ws/sessions/:id/prompt

Request: `{ text: string }`
Response: `202 Accepted` (empty body)
Errors: 404 (session not found), 409 (terminal status)

### GET /api/orchestrator/:ws/sessions/:id/log

Response: `{ entries: ConversationLogEntry[] }`
Errors: 404 (session not found)

Returns the persisted conversation log for the review page. The live session uses SSE events directly; this endpoint is for after-the-fact review.
