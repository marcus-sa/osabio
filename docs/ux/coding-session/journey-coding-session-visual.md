# Journey: Interactive Coding Session

## Journey Flow

```
  ASSIGN              SPAWN               MONITOR              GUIDE               REVIEW              CONCLUDE
 --------           --------            ---------            --------            --------            ----------
| Marcus  |  -->   | System  |   -->   | Marcus   |   -->   | Marcus  |   -->   | Marcus  |   -->   | Marcus   |
| clicks  |        | spawns  |         | watches  |         | sends   |         | reviews |         | accepts/ |
| Assign  |        | agent   |         | agent    |         | prompt  |         | diff +  |         | rejects  |
| Agent   |        | + shows |         | output   |         | to      |         | context |         | changes  |
|         |        | progress|         | stream   |         | agent   |         |         |         |          |
 --------           --------            ---------            --------            --------            ----------
  Hopeful           Waiting/            Engaged/              In Control          Analytical          Confident/
  "Let's go"        Expectant           Curious               "I can steer"       "I understand"      Satisfied
```

## Emotional Arc

```
Confidence
    ^
    |                                              ****
    |                                           ***    ***
    |                                 *****  ***          **
    |                               **     **               **
    |                             **                          *
    |              ***          **                              *
    |            **   ***     **                                 *
    |          **       *** **                                    *****
    |        **           *                                           ***
    |      **        (live output                                        **
    |    **           begins)       (course                    (review      (accept)
    |  **                            correct)                   with
    | * (assign                                                 context)
    |    clicked)
    +---------------------------------------------------------> Time
   Start                                                        End
```

**Arc Pattern**: Confidence Building
- Start: Hopeful but uncertain ("Will the agent get this right?")
- Dip: Brief anxiety during spawn wait ("Is it starting?")
- Rise: Live output streams in -- user sees agent working ("It's actually doing it!")
- Peak: Course correction works -- user feels in control
- Sustained: Review with full context confirms quality
- End: Satisfied acceptance -- code merged with confidence

---

## Step 1: Assign Agent

### Context
Marcus is viewing a task in the entity detail panel. The task has status "ready" or "todo" and the workspace has a repo path configured.

### User Action
Clicks "Assign Agent" button in the AgentStatusSection.

### UI Mockup

```
+-- Entity Detail: US-042 ----------------------------------------+
|                                                                   |
|  Title: Add pagination to entity search                           |
|  Status: ready                                                    |
|  Project: Richmond v2                                             |
|                                                                   |
|  +-- Agent -----------------------------------------------+      |
|  |                                                         |      |
|  |  [ Assign Agent ]                                       |      |
|  |                                                         |      |
|  +---------------------------------------------------------+      |
|                                                                   |
+-------------------------------------------------------------------+
```

### Emotional State
- Entry: Hopeful, decisive ("This task is well-defined, an agent can handle it")
- Exit: Expectant ("Let's see if it starts correctly")

### What Could Go Wrong
- Repo path not configured (handled: banner with inline form)
- Task not assignable (handled: button hidden for non-assignable statuses)
- Agent already active on another task (handled: 409 error shown)
- Spawn failure (handled: error message shown, task returned to ready)

---

## Step 2: Spawn Progress

### Context
After clicking Assign, the system creates a worktree, spawns OpenCode, creates a session, and sends the initial `/brain-start-task` command. This takes 5-15 seconds.

### UI Mockup

```
+-- Entity Detail: US-042 ----------------------------------------+
|                                                                   |
|  Title: Add pagination to entity search                           |
|  Status: in_progress                                              |
|                                                                   |
|  +-- Agent -----------------------------------------------+      |
|  |                                                         |      |
|  |  [*] Spawning...                                        |      |
|  |                                                         |      |
|  |  Creating worktree...                                   |      |
|  |  Starting coding agent...                               |      |
|  |                                                         |      |
|  |  [ Abort ]                                              |      |
|  |                                                         |      |
|  +---------------------------------------------------------+      |
|                                                                   |
+-------------------------------------------------------------------+
```

### Emotional State
- Entry: Expectant, slight anxiety ("Is it starting?")
- Exit: Relieved ("It's running")

### Design Lever
Progress feedback within <100ms of click. Sub-step messages (creating worktree, starting agent) reduce perceived wait time. Abort available from the start.

---

## Step 3: Live Output Stream

### Context
The agent is working. SSE events flow from OpenCode through the event bridge to the browser. Token events render as streaming text. File change events appear as inline notifications.

### UI Mockup

```
+-- Entity Detail: US-042 ----------------------------------------+
|                                                                   |
|  Title: Add pagination to entity search                           |
|  Status: in_progress                                              |
|                                                                   |
|  +-- Agent -----------------------------------------------+      |
|  |                                                         |      |
|  |  Working  |  2 files changed  |  Started 45s ago        |      |
|  |                                                         |      |
|  |  +-- Agent Output --------------------------------+     |      |
|  |  |                                                 |     |      |
|  |  | I'll add pagination to the entity search        |     |      |
|  |  | endpoint. Let me first look at the current      |     |      |
|  |  | implementation...                               |     |      |
|  |  |                                                 |     |      |
|  |  | Reading entity-search-route.ts...               |     |      |
|  |  |                                                 |     |      |
|  |  | The current search returns all results. I'll    |     |      |
|  |  | add limit/offset parameters and pass them to    |     |      |
|  |  | the SurrealDB query.                            |     |      |
|  |  |                                                 |     |      |
|  |  |  -- entity-search-route.ts modified             |     |      |
|  |  |                                                 |     |      |
|  |  | Now I'll update the client-side search hook     |     |      |
|  |  | to pass pagination params...                    |     |      |
|  |  |  |                                              |     |      |
|  |  +------------------------------------------------+     |      |
|  |                                                         |      |
|  |  +-- Send Message --------------------------------+     |      |
|  |  | Type a message to the agent...            [Send]|     |      |
|  |  +------------------------------------------------+     |      |
|  |                                                         |      |
|  |  [ Abort ]                                              |      |
|  |                                                         |      |
|  +---------------------------------------------------------+      |
|                                                                   |
+-------------------------------------------------------------------+
```

### Emotional State
- Entry: Curious, engaged ("Let me see what it's doing")
- Sustain: Confidence building ("It's reading the right files, making reasonable decisions")
- Exit: Either satisfied (agent heading right direction) or alert (needs correction)

### Design Lever
- Auto-scroll keeps latest output visible while actively streaming
- File change events appear inline as distinct notifications (not lost in text)
- Status badge updates in real-time (Spawning -> Working -> Idle)
- Agent output panel takes prominent vertical space -- this is the primary content

---

## Step 4: Course Correction (Follow-up Prompt)

### Context
Marcus notices the agent is about to write a new utility function when one already exists. He sends a follow-up prompt to redirect the agent.

### UI Mockup

```
|  |  +-- Agent Output --------------------------------+     |
|  |  |                                                 |     |
|  |  | I'll create a new pagination helper function    |     |
|  |  | in utils/pagination.ts...                       |     |
|  |  |                                                 |     |
|  |  +------------------------------------------------+     |
|  |                                                         |
|  |  +-- Send Message --------------------------------+     |
|  |  | Use the existing paginate() function from      |     |
|  |  | app/src/shared/query-helpers.ts instead of  [>] |     |
|  |  +------------------------------------------------+     |
```

After sending:

```
|  |  +-- Agent Output --------------------------------+     |
|  |  |                                                 |     |
|  |  | I'll create a new pagination helper function    |     |
|  |  | in utils/pagination.ts...                       |     |
|  |  |                                                 |     |
|  |  |  >> You: Use the existing paginate() function   |     |
|  |  |  >> from app/src/shared/query-helpers.ts        |     |
|  |  |  >> instead of writing a new one.               |     |
|  |  |                                                 |     |
|  |  | Good catch! I'll use the existing paginate()    |     |
|  |  | function from query-helpers.ts. Let me update   |     |
|  |  | my approach...                                  |     |
|  |  |                                                 |     |
|  |  |  -- entity-search-route.ts modified             |     |
|  |  |  |                                              |     |
|  |  +------------------------------------------------+     |
|  |                                                         |
|  |  +-- Send Message --------------------------------+     |
|  |  | Type a message to the agent...            [Send]|     |
|  |  +------------------------------------------------+     |
```

### Emotional State
- Entry: Alert, slightly concerned ("It's about to do the wrong thing")
- During: In control ("I can intervene without destroying progress")
- Exit: Satisfied ("It listened, it's adjusting")

### Design Lever
- User messages appear visually distinct from agent output (indented, prefixed, different styling)
- Input clears and re-enables after send
- Agent response streams back confirming it received the guidance
- No page reload, no navigation -- everything inline in the same panel

---

## Step 5: Review with Context

### Context
The agent has finished (status: idle). Marcus navigates to the review page. The review shows the diff alongside the session conversation trail.

### UI Mockup

```
+-- Review: US-042 ------------------------------------------------+
|                                                                    |
|  Task: Add pagination to entity search                             |
|  Agent Session: Started 8 min ago  |  3 files changed             |
|                                                                    |
|  [Accept]  [Reject with Feedback]  [Abort]                         |
|                                                                    |
|  +-- Tab: Diff --+-- Tab: Agent Log --+                            |
|  |               |                    |                            |
|  +------------------------------------------------------------+   |
|  |                                                             |   |
|  |  entity-search-route.ts  (+12 -3)                           |   |
|  |  --------------------------------------------------------  |   |
|  |  @@ -45,8 +45,17 @@                                        |   |
|  |     const results = await searchEntities(                   |   |
|  |       surreal,                                              |   |
|  |       workspace,                                            |   |
|  |  -    query                                                 |   |
|  |  +    query,                                                |   |
|  |  +    { limit: limit ?? 20, offset: offset ?? 0 }           |   |
|  |     );                                                      |   |
|  |  +  const total = await countEntities(surreal, workspace,   |   |
|  |  +    query);                                               |   |
|  |  +  return { results, total, limit, offset };               |   |
|  |                                                             |   |
|  +------------------------------------------------------------+   |
|                                                                    |
+--------------------------------------------------------------------+
```

Agent Log tab:

```
|  +------------------------------------------------------------+   |
|  |                                                             |   |
|  |  Agent: I'll add pagination to the entity search endpoint.  |   |
|  |  Let me first look at the current implementation...         |   |
|  |                                                             |   |
|  |  Agent: Reading entity-search-route.ts...                   |   |
|  |                                                             |   |
|  |  Agent: I'll create a new pagination helper function...     |   |
|  |                                                             |   |
|  |  >> You: Use the existing paginate() function from          |   |
|  |  >> app/src/shared/query-helpers.ts instead.                |   |
|  |                                                             |   |
|  |  Agent: Good catch! I'll use the existing paginate()...     |   |
|  |                                                             |   |
|  |  -- entity-search-route.ts modified                         |   |
|  |  -- use-entity-search.ts modified                           |   |
|  |  -- contracts.ts modified                                   |   |
|  |                                                             |   |
|  +------------------------------------------------------------+   |
|                                                                    |
```

### Emotional State
- Entry: Analytical ("Let me verify this is correct")
- During: Understanding builds ("I can see why each change was made because I watched it happen")
- Exit: Confident ("I understand these changes, they look right")

### Design Lever
- Tabbed view: Diff (default) and Agent Log (conversation trail)
- Agent Log preserves the full conversation including user prompts
- File change notifications in the log link to the corresponding diff section
- Reject flow prompts for specific feedback text (not just a button)

---

## Step 6: Accept or Reject

### Context
Marcus has reviewed the diff and agent log. He accepts the changes (task marked done) or rejects with feedback (agent resumes work).

### Accept Flow

```
+-- Review: US-042 ------------------------------------------------+
|                                                                    |
|  [Accept]  pressed                                                 |
|                                                                    |
|  +------------------------------------------------------------+   |
|  |                                                             |   |
|  |  Changes accepted.                                          |   |
|  |  Task "Add pagination to entity search" marked as done.     |   |
|  |  Branch: agent/add-pagination-to-entity-search              |   |
|  |                                                             |   |
|  +------------------------------------------------------------+   |
|                                                                    |
+--------------------------------------------------------------------+
```

### Reject Flow

```
+-- Review: US-042 ------------------------------------------------+
|                                                                    |
|  [Reject with Feedback]  pressed                                   |
|                                                                    |
|  +-- Feedback ------------------------------------------------+   |
|  |                                                             |   |
|  |  The pagination works but you missed updating the           |   |
|  |  TypeScript types in contracts.ts -- the response           |   |
|  |  type still has the old shape without total/limit/offset.   |   |
|  |                                                             |   |
|  |  [Send Feedback & Resume Agent]                             |   |
|  |                                                             |   |
|  +------------------------------------------------------------+   |
|                                                                    |
+--------------------------------------------------------------------+
```

### Emotional State
- Accept: Satisfied, accomplished ("Good delegation, good result")
- Reject: Constructive, hopeful ("The feedback will fix it, one more round")

---

## Integration Points

| From Step | To Step | Data Passed | Validation |
|-----------|---------|-------------|------------|
| 1 (Assign) | 2 (Spawn) | taskId, workspaceId | Task must be assignable, repo path configured |
| 2 (Spawn) | 3 (Monitor) | streamId, agentSessionId, streamUrl | SSE connection opens, first event received |
| 3 (Monitor) | 4 (Guide) | Active session handle with sendPrompt | Session must be in active status |
| 3 (Monitor) | 5 (Review) | agentSessionId (idle status triggers review link) | Session must be idle or completed |
| 4 (Guide) | 3 (Monitor) | Prompt delivered, agent resumes streaming | Session returns to active after prompt |
| 5 (Review) | 6 (Conclude) | agentSessionId + accept/reject decision | Session in reviewable state |
| 6 (Reject) | 3 (Monitor) | feedback text, session returns to active | Agent resumes with feedback context |
