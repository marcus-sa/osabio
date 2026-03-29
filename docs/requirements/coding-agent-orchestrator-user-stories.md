# User Stories: Coding Agent Orchestrator

All stories trace to JTBD job stories in `docs/ux/coding-agent-orchestrator/jtbd-job-stories.md`.

---

## Walking Skeleton Stories (Feature 0)

### US-0.1: Assign Task to Agent (Backend)
**As** a user with a ready engineering task
**I want** to trigger agent assignment via API
**So that** a coding agent begins working on my task with full project context

**Job trace:** Job 1 (Assign)

**Acceptance Criteria:**
```gherkin
Given a task with status "ready" and a description in workspace W
When POST /api/workspaces/W/tasks/T/assign-agent is called
Then an opencode session is created with Osabio MCP configured
And the task description + project context is sent as the initial prompt
And the task status changes to "in_progress"
And an agent_session record is created with agent_type "code_agent"
```

### US-0.2: Agent Reads Context via MCP
**As** a coding agent assigned to a task
**I want** to read task and project context from Osabio MCP
**So that** I understand what to build and how it fits the codebase

**Job trace:** Job 1 (Assign) — context handoff

**Acceptance Criteria:**
```gherkin
Given an opencode session with Osabio MCP configured
When the agent calls get_task_context for task T
Then the agent receives task title, description, status, dependencies, and related entities
When the agent calls get_project_context for the task's project
Then the agent receives project structure, decisions, conventions, and open observations
```

### US-0.3: Agent Updates Task Status via MCP
**As** a coding agent working on a task
**I want** to update the task status in Osabio
**So that** the user knows my progress without checking manually

**Job trace:** Job 2 (Monitor)

**Acceptance Criteria:**
```gherkin
Given an agent working on task T
When the agent calls update_task_status with status "blocked"
Then the task status in Osabio changes to "blocked"
And an observation is created explaining the blocker
When the agent calls update_task_status with status "done"
Then the task status in Osabio changes to "done"
```

### US-0.4: Assign Button in Task Popup (EntityDetailPanel)
**As** a user viewing a task in the graph
**I want** to see an "Assign to Agent" button in the task popup
**So that** I can delegate work without leaving the graph view

**Job trace:** Job 1 (Assign)
**Surface:** Task Popup (EntityDetailPanel)

**Acceptance Criteria:**
```gherkin
Given I click a task node in the graph with status "ready" or "todo"
Then the EntityDetailPanel shows an "Assign to Agent" button
When I click the button
Then the button shows a loading/spinner state
And the task status updates to "in_progress"
And the panel shows a status badge "Agent working"
```

### US-0.5: Agent Status Badge in Task Popup
**As** a user who assigned a task to an agent
**I want** to see the agent's current status at a glance in the task popup
**So that** I know whether work is progressing without opening a separate view

**Job trace:** Job 2 (Monitor)
**Surface:** Task Popup (EntityDetailPanel)

**Acceptance Criteria:**
```gherkin
Given a task with an active agent session
When I click the task node in the graph
Then the EntityDetailPanel shows:
  - Status badge reflecting agent state (working, review ready, error, aborted)
  - Count of files changed (updated via SSE agent_file_change events)
  - Elapsed time since session started
And the badge updates in real-time as SSE events arrive

Given an agent session reaches "idle" state
Then the task popup shows a "Review" button
When I click "Review"
Then the Agent Review View opens for that session
```

---

## Monitoring Stories

### US-1.1: Agent Events Route to Task Popup
**As** a user with the task popup open
**I want** to see real-time file change counts and status updates
**So that** I can tell the agent is making progress

**Job trace:** Job 2 (Monitor)
**Surface:** Task Popup (EntityDetailPanel)

**Acceptance Criteria:**
```gherkin
Given a task popup is open for a task with an active agent session
When the agent creates or modifies a file
Then the file change counter in the popup increments
When the agent status changes
Then the status badge updates immediately
```

### US-1.2: Agent Attention Needed in Governance Feed
**As** a user who assigned work to an agent
**I want** to be alerted in the feed only when the agent needs my attention
**So that** I'm not distracted by operational noise

**Job trace:** Job 2 (Monitor)
**Surface:** Governance Feed

**Acceptance Criteria:**
```gherkin
Given an agent session transitions to "idle" (review ready)
Then a feed item appears in tier "review" with reason "Agent completed work on '{task.title}' -- review ready"
And the feed item shows actions: "Review", "Abort"

Given an agent stalls (no events for configured timeout)
Then the opencode session is aborted
And a feed item appears in tier "blocking" with reason "Agent stalled on '{task.title}'"
And the feed item shows actions: "Abort", "Discuss"

Given an agent session errors
Then a feed item appears in tier "blocking" with reason "Agent failed on '{task.title}': {error}"
And the feed item shows actions: "Retry", "Discuss"

Given an agent creates an observation with a question
Then a feed item appears in tier "review" with the observation text
```

### US-1.3: Feed Items Use Task Entity (Not Agent Session)
**As** a user scanning the governance feed
**I want** agent-related items to appear as task items with agent context
**So that** the feed stays clean without a new entity kind to learn

**Job trace:** Job 2 (Monitor)
**Surface:** Governance Feed

**Acceptance Criteria:**
```gherkin
Given an agent-related feed item
Then it uses entityKind "task" (not "agent_session")
And it uses the task's entityId and entityName
And the reason text includes agent-specific context
When I click the feed item's "Review" action
Then the Agent Review View opens
```

---

## Review Stories

### US-2.1: Agent Review View
**As** a user whose task was completed by an agent
**I want** a dedicated review view showing diff, reasoning, and session metadata
**So that** I can make an informed accept/reject decision with full context

**Job trace:** Job 3 (Review)
**Surface:** Agent Review View (new component, `/workspace/:ws/review/:sessionId`)

**Acceptance Criteria:**
```gherkin
Given I navigate to the Agent Review View (via task popup or feed)
Then I see:
  - Task title and agent summary
  - Files changed with per-file diff (expandable unified diff)
  - Agent activity log (file changes, tool calls, key events)
  - Session metadata (branch name, duration, decision/question/observation counts)
  - "Accept" and "Reject" action buttons
```

### US-2.2: Accept Agent Output
**As** a user reviewing agent output in the Review View
**I want** to accept the work with one click
**So that** the branch merges and the task is marked done

**Job trace:** Job 3 (Review)
**Surface:** Agent Review View

**Acceptance Criteria:**
```gherkin
Given I am in the Agent Review View for session S on task T
When I click "Accept"
Then POST /api/orchestrator/:ws/sessions/S/accept is called
And the worktree branch is merged to main
And the worktree is removed
And the task status changes to "done"
And the agent_session is marked as "completed"
And the Review View shows a success state
And the corresponding feed item (if any) is removed
```

### US-2.3: Reject and Provide Feedback
**As** a user reviewing agent output in the Review View
**I want** to send feedback and have the agent iterate
**So that** the agent can course-correct without starting over

**Job trace:** Job 3 (Review)
**Surface:** Agent Review View

**Acceptance Criteria:**
```gherkin
Given I am in the Agent Review View for session S on task T
When I click "Reject"
Then a feedback textarea appears
When I enter feedback and click "Send"
Then POST /api/orchestrator/:ws/sessions/S/reject is called with the feedback
And the agent resumes work in the same worktree
And the Review View transitions to a monitoring state showing "Agent working..."
And the task popup badge updates to "Agent working"
And the feed review item is replaced with operational status
```
