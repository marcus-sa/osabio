# Story Map: Agent Management

## User: Elena Vasquez (Workspace Admin) / Rafael Oliveira (Developer)

## Goal: View, create, configure, and monitor agents within a Brain workspace with proper governance

## Backbone

| Browse Registry | Create Agent | Configure Authority | Monitor Operations | Manage Lifecycle |
|-----------------|-------------|--------------------|--------------------|------------------|
| View all agents | Select runtime | Set permission levels | View sessions | Edit agent |
| Filter by runtime | Enter details | Review scope summary | Session status | Delete agent |
| View agent detail | Configure sandbox | | Spawn session | |
| Empty states | Generate proxy token | | Resume idle session | |
| | | | View connection status | |

---

### Walking Skeleton

The thinnest end-to-end slice that proves the architecture works:

1. **Browse Registry**: List agents in workspace (all runtimes, no filtering)
2. **Create Agent**: Create an external agent (simplest path -- name + description only)
3. **Configure Authority**: Assign authority scopes during creation
4. **Monitor Operations**: View agent detail page with basic info
5. **Manage Lifecycle**: Delete an agent

This skeleton validates: schema migration (runtime field), API endpoints (CRUD), identity graph creation (5-step transaction), authority model (authorized_to edges), and UI rendering (list + detail + forms).

### Release 1: External Agent CRUD (Walking Skeleton)

Outcome: Users can register, view, and delete external agents with governed authority.

| Browse Registry | Create Agent | Configure Authority | Monitor Operations | Manage Lifecycle |
|-----------------|-------------|--------------------|--------------------|------------------|
| List agents (flat) | Create external agent | Set scopes at creation | View agent detail | Delete agent |
| | Proxy token generation | | | |

Stories:
- US-01: View agent registry (basic list)
- US-02: Create external agent with authority scopes
- US-03: View agent detail page
- US-04: Delete agent with confirmation

### Release 2: Sandbox Agent Creation

Outcome: Users can create sandbox agents with runtime configuration and spawn sessions.

| Browse Registry | Create Agent | Configure Authority | Monitor Operations | Manage Lifecycle |
|-----------------|-------------|--------------------|--------------------|------------------|
| Runtime filter tabs | Create sandbox agent | | View session list | |
| Runtime badges | Configure sandbox fields | | Spawn session | |
| Session count on cards | | | | |

Stories:
- US-05: Create sandbox agent with sandbox configuration
- US-06: Filter agents by runtime type
- US-07: Spawn sandbox session from agent detail
- US-08: View session list on agent detail

### Release 3: Operational Dashboard

Outcome: Users can monitor agent operations, manage idle sessions, and edit configurations.

| Browse Registry | Create Agent | Configure Authority | Monitor Operations | Manage Lifecycle |
|-----------------|-------------|--------------------|--------------------|------------------|
| Empty states | | Edit scopes post-creation | Resume idle session | Edit agent config |
| | | | Connection status (external) | Edit authority scopes |
| | | | Session error display | Delete with active sessions |

Stories:
- US-09: Edit agent configuration and authority scopes
- US-10: Resume or send feedback to idle sessions
- US-11: View external agent connection status
- US-12: Delete agent with active session warning
- US-13: Empty states for each runtime section

## Scope Assessment: PASS -- 13 stories, 2 bounded contexts (agents + iam/authority), estimated 10-12 days

The feature spans 2 bounded contexts (agent CRUD and authority model) with clear interfaces. The walking skeleton covers all 5 activities with minimal stories. Each release adds incremental value. 13 stories is at the upper bound but each is right-sized (1-3 days, 3-5 scenarios).

## Schema Dependencies

All releases depend on:
- Migration: Add `runtime` field to agent table, add `sandbox_config` fields
- Migration: Add `settings.sandbox_provider` fields to workspace table
- API: Agent CRUD endpoints (list, create, detail, update, delete)
- API: Authority scope listing endpoint (for creation form dropdown)
