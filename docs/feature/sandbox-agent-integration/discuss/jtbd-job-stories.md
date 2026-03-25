<!-- markdownlint-disable MD024 -->
# JTBD Job Stories: Sandbox Agent Integration

## Job 1: Run Coding Agents in Isolation

### Job Story

When I need a coding agent to implement a feature or fix a bug in my workspace,
I want to spawn it in an isolated sandbox with governed tool access,
so I can trust that the agent operates safely without compromising the host or other workspaces.

### Functional Job
Execute coding agents (Claude Code, Codex, OpenCode) in isolated environments with Brain's governance layer intact.

### Emotional Job
Feel confident that agent execution is contained and reversible -- no fear of host contamination or unintended side effects.

### Social Job
Demonstrate to the team that our agent infrastructure follows security best practices with real isolation boundaries.

### Three Dimensions

| Dimension | Discovery |
|-----------|-----------|
| Functional | "What are you trying to get done?" -- Run coding agents against our codebase safely |
| Emotional | "What are you worried about?" -- Agent breaking production, corrupting shared state |
| Social | "Who else is affected?" -- Entire team trusts the sandbox for their coding sessions |

---

## Job 2: Swap Agents Without Rewriting Integration

### Job Story

When the team wants to try a different coding agent (e.g., switch from Claude Code to Codex for a specific task),
I want to change the agent type without modifying orchestration code,
so I can evaluate agents on merit rather than integration cost.

### Functional Job
Configure which coding agent runs for a session via configuration, not code changes.

### Emotional Job
Feel empowered to experiment without the anxiety of breaking a fragile, agent-specific integration layer.

### Social Job
Be seen as a technical lead who makes data-driven agent selection decisions rather than defaulting to whatever was first integrated.

---

## Job 3: Continue a Conversation with a Coding Agent

### Job Story

When a coding agent produces work that needs correction or extension,
I want to send follow-up prompts to the same session without respawning the agent,
so I can iterate on the work naturally without losing context or paying setup costs again.

### Functional Job
Support multi-turn interactions with coding agents -- prompt, review, redirect, prompt again.

### Emotional Job
Feel in control of the agent's work, like directing a collaborator rather than firing off requests into a void.

### Social Job
Demonstrate iterative agent supervision to stakeholders who worry about "letting agents run unsupervised."

---

## Job 4: Recover Agent Sessions After Failures

### Job Story

When a network interruption or transient failure disconnects me from a running agent session,
I want the session to automatically restore and resume from where it left off,
so I can avoid losing hours of agent work to infrastructure glitches.

### Functional Job
Automatic session restoration with event replay -- no manual re-prompting or state reconstruction.

### Emotional Job
Feel safe that transient failures are not catastrophic -- the system is resilient, not fragile.

### Social Job
Show operators and users that the platform handles failures gracefully, building trust in autonomous agent execution.

---

## Job 5: Govern Tool Access for Sandbox-Executed Agents

### Job Story

When a coding agent in a sandbox needs to call external tools (GitHub, Slack, Jira via MCP),
I want Brain to filter, authorize, and broker credentials for each tool call,
so I can maintain the same governance guarantees as Brain-native agents.

### Functional Job
Expose a dynamic MCP endpoint per agent that filters tools by grants, evaluates policies, and injects credentials.

### Emotional Job
Feel confident that governance is uniform -- sandbox agents are not a "back door" bypassing Brain's policy layer.

### Social Job
Assure compliance officers and security reviewers that all agent tool access is governed, audited, and policy-controlled regardless of execution environment.

---

## Job 6: Persist Agent Sessions in the Knowledge Graph

### Job Story

When a coding agent session completes or pauses,
I want all session data and events stored in SurrealDB alongside existing agent_session and trace records,
so I can query, audit, and correlate agent activity across the knowledge graph.

### Functional Job
Implement a SurrealDB session persistence driver for SandboxAgent that stores sessions and events as graph entities.

### Emotional Job
Feel organized -- all agent activity lives in one place, not split between in-memory registries and external databases.

### Social Job
Provide auditors and operators a single source of truth for all agent activity, whether Brain-native or sandbox-executed.

---

## Job 7: Stream Agent Events to the Governance Feed

### Job Story

When a sandbox-executed coding agent is working on a task,
I want its events (tool calls, file edits, permission requests) to appear in Brain's real-time feed and trace graph,
so I can monitor agent activity with the same observability as Brain-native agents.

### Functional Job
Bridge SandboxAgent's universal event schema to Brain's SSE registry and trace graph.

### Emotional Job
Feel aware and in control -- no "black box" agent execution happening outside visibility.

### Social Job
Show the team and stakeholders that all agent activity is transparent and traceable in real time.

---

## Job 8: Configure Sandbox Providers per Workspace

### Job Story

When I am setting up a workspace for my team,
I want to choose the sandbox provider (local, Docker, E2B) based on our security and cost requirements,
so I can match the isolation level to the risk profile of the work.

### Functional Job
Configure sandbox provider at workspace level with provider-specific settings (Docker image, E2B template, local worktree path).

### Emotional Job
Feel in control of the cost-security tradeoff rather than being forced into a one-size-fits-all isolation model.

### Social Job
Demonstrate responsible infrastructure management to ops teams and budget stakeholders.
