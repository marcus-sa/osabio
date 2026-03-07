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
Then an opencode session is created with Brain MCP configured
And the task description + project context is sent as the initial prompt
And the task status changes to "in_progress"
And an agent_session record is created with agent_type "code_agent"
```

### US-0.2: Agent Reads Context via MCP
**As** a coding agent assigned to a task
**I want** to read task and project context from Brain MCP
**So that** I understand what to build and how it fits the codebase

**Job trace:** Job 1 (Assign) — context handoff

**Acceptance Criteria:**
```gherkin
Given an opencode session with Brain MCP configured
When the agent calls get_task_context for task T
Then the agent receives task title, description, status, dependencies, and related entities
When the agent calls get_project_context for the task's project
Then the agent receives project structure, decisions, conventions, and open observations
```

### US-0.3: Agent Updates Task Status via MCP
**As** a coding agent working on a task
**I want** to update the task status in Brain
**So that** the user knows my progress without checking manually

**Job trace:** Job 2 (Monitor)

**Acceptance Criteria:**
```gherkin
Given an agent working on task T
When the agent calls update_task_status with status "blocked"
Then the task status in Brain changes to "blocked"
And an observation is created explaining the blocker
When the agent calls update_task_status with status "done"
Then the task status in Brain changes to "done"
```

### US-0.4: Assign Button in UI
**As** a user viewing a task detail page
**I want** to see an "Assign to Agent" button
**So that** I can trigger agent assignment with one click

**Job trace:** Job 1 (Assign)

**Acceptance Criteria:**
```gherkin
Given I am viewing a task with status "ready" or "todo"
Then I see an "Assign to Agent" button
When I click the button
Then the button shows a loading state
And the task status updates to "in_progress"
And I see an indicator that an agent is working on the task
```

---

## Monitoring Stories

### US-1.1: Stream Agent Events to UI
**As** a user monitoring an agent's work
**I want** to see agent activity events in real-time
**So that** I can catch problems early

**Job trace:** Job 2 (Monitor)

**Acceptance Criteria:**
```gherkin
Given a task with an active agent session
When the agent creates or modifies a file
Then a "file_change" event appears in the task activity feed
When the agent calls a Brain MCP tool
Then a "tool_call" event appears in the feed
When the agent encounters an error
Then an "error" event appears in the feed
```

### US-1.2: Detect Stalled Agent
**As** a user who assigned work to an agent
**I want** stalled agents to be automatically detected
**So that** I don't waste time and money on looping agents

**Job trace:** Job 2 (Monitor) — error path

**Acceptance Criteria:**
```gherkin
Given an agent has been working for longer than the configured timeout
Or the agent has exceeded the maximum step count
When the timeout/limit is reached
Then the opencode session is aborted
And an observation is created with severity "warning" and the reason
And the task status changes to "blocked"
And the user is notified
```

---

## Review Stories

### US-2.1: Review Agent Output
**As** a user whose task was completed by an agent
**I want** to see what the agent changed and why
**So that** I can make an informed accept/reject decision

**Job trace:** Job 3 (Review)

**Acceptance Criteria:**
```gherkin
Given a task completed by a coding agent
When I view the task detail page
Then I see a "Review" section showing:
  - Files changed (diff summary)
  - Agent session trace (tool calls + reasoning)
  - Observations created during work
  - Git branch name for the changes
```

### US-2.2: Accept Agent Output
**As** a user reviewing agent output
**I want** to accept the work and mark the task done
**So that** the changes are ready to merge

**Job trace:** Job 3 (Review)

**Acceptance Criteria:**
```gherkin
Given I am reviewing completed agent work on task T
When I click "Accept"
Then the task status changes to "done"
And the agent_session is marked as completed
```

### US-2.3: Reject and Provide Feedback
**As** a user reviewing agent output
**I want** to send feedback and have the agent try again
**So that** the agent can iterate based on my corrections

**Job trace:** Job 3 (Review)

**Acceptance Criteria:**
```gherkin
Given I am reviewing completed agent work on task T
When I click "Request Changes" and enter feedback text
Then the feedback is sent as a follow-up prompt to the opencode session
And the task status changes back to "in_progress"
And the agent resumes work incorporating the feedback
```
