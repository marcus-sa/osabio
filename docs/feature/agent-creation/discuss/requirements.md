# Requirements: Agent Management

## Business Context

Brain is an autonomous organization operating system where agents coordinate through a shared knowledge graph. Currently, all agent types are hardcoded in the schema (`agent_type` enum with 7 values), and agent management requires direct database manipulation. This feature adds a web-based agent management interface enabling workspace admins and developers to view, create, configure, and monitor agents with proper governance.

## Functional Requirements

### FR-1: Agent Registry

The system provides a dedicated agents page displaying all agents in the workspace, grouped by runtime type (brain, sandbox, external). Each agent card shows name, description, runtime badge, and runtime-appropriate actions.

**Business rules:**
- Brain agents are system-managed and display view-only
- Sandbox agents display spawn, edit actions
- External agents display edit action
- All agents display delete action except brain agents

### FR-2: Agent Creation

The system allows creation of sandbox and external agents through a multi-step form. Creation executes a 5-step transactional flow:
1. Create agent record (name, description, runtime, model, sandbox_config)
2. Create identity record (type: "agent")
3. Create identity_agent edge
4. Create member_of edge (identity -> workspace)
5. Create authorized_to edges (one per configured authority scope)

**Business rules:**
- Brain agents cannot be created through the UI
- Agent name must be unique within the workspace
- All 5 steps succeed atomically or all roll back
- Authority scopes default to "propose" (safe default)
- External agent creation generates a proxy token shown once

### FR-3: Sandbox Configuration

Sandbox agents include runtime configuration passed to the Sandbox Agent SDK at session spawn time. Available configuration fields depend on the workspace sandbox provider.

**Business rules:**
- Workspace must have a sandbox provider configured before sandbox agents can be created
- Provider configuration is workspace-level (settings.sandbox_provider)
- Sandbox config is agent-level (agent.sandbox_config)
- All providers support: coding agents, environment variables, model
- Cloud providers only (e2b, daytona, docker): image and snapshot fields are available
- Local provider (default): image and snapshot are not applicable (environment managed locally)

### FR-4: Authority Scope Configuration

During agent creation and editing, users configure authority scopes as action-permission pairs. Each action has three permission levels: auto (independent), propose (human approval required), blocked (cannot perform).

**Business rules:**
- All actions default to "propose" for new agents
- Users must explicitly set any action to "auto"
- Authority scopes create authorized_to edges in the identity graph
- Brain agents use seed-based authority (not configurable via UI)

### FR-5: Agent Detail and Session Monitoring

Each agent has a detail page showing configuration, authority scopes, and session history. Sandbox agents show sessions grouped by status (active, idle, completed, error). External agents show connection status.

**Business rules:**
- Idle sessions offer resume and feedback actions
- Error sessions display error message
- Connection status for external agents derived from last proxy request timestamp

### FR-6: Agent Lifecycle Management

Agents can be edited and deleted through the UI.

**Business rules:**
- Edit updates agent record, syncs identity name, updates authorized_to edges
- Delete requires typing agent name to confirm (destructive action safety)
- Delete with active sessions warns about termination
- Terminated sessions get status "aborted"
- Historical session records preserved for audit
- Brain agents cannot be edited or deleted

## Non-Functional Requirements

### NFR-1: Performance

- Agents page loads in under 2 seconds for workspaces with up to 50 agents
- Agent creation transaction completes in under 3 seconds
- Session list refreshes within 1 second of status change

### NFR-2: Security

- Proxy tokens generated with cryptographic randomness
- Tokens stored as SHA-256 hashes only (plaintext never persisted)
- Authority scopes enforced at runtime via existing authorization layer
- Destructive actions (delete) require explicit confirmation

### NFR-3: Reliability

- 5-step creation transaction is atomic (all or nothing)
- No orphaned records from failed transactions
- Agent deletion cleans all graph edges

### NFR-4: Accessibility

- All interactive elements reachable via keyboard
- Focus indicators visible on all interactive elements
- Contrast ratio 4.5:1 minimum for text
- Runtime badges use color paired with text labels

### NFR-5: Data Integrity

- Agent name unique within workspace
- Agent.name and linked identity.name always in sync
- Authority scope edges match configured permissions exactly

## Domain Glossary

| Term | Definition |
|------|-----------|
| Agent | An autonomous entity in Brain that performs work within governance boundaries |
| Runtime | How an agent executes: brain (system-managed), sandbox (isolated environment), external (user-managed) |
| Authority scope | A permission assignment for a specific action at a specific level (auto/propose/blocked) |
| Proxy token | A bearer credential for external agents to authenticate with the Brain LLM proxy |
| Sandbox provider | The infrastructure service (local/e2b/daytona/docker) hosting sandbox agent environments |
| Identity | A graph node representing an actor (human or agent) in the workspace |
| authorized_to | A relation edge from identity to authority_scope granting a specific permission |
| member_of | A relation edge from identity to workspace establishing membership |
