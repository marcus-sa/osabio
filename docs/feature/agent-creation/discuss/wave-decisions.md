# Wave Decisions: Agent Management (DISCUSS)

## Decision Summary

### D1: Runtime-based agent taxonomy replaces agent_type enum

**Status**: Confirmed (from DISCOVER validation)

The `agent_type` enum is replaced by a `runtime` field with three values: `brain`, `sandbox`, `external`. Agent role/purpose is captured by `name` and `description` (free-form), not enumerated.

**Rationale**: agent_type conflated runtime model with role identity. The three runtime values map to existing code paths (brain agents in `agents/`, sandboxed via `orchestrator/`, external via `proxy/`). Role should be user-definable.

**Impact**: Schema migration, 8 module updates (see problem-validation.md Impact Radius table).

### D2: Brain agents are read-only in the UI

**Status**: Confirmed (from DISCOVER A17)

Brain agents (observer, architect, PM agent, etc.) are displayed in the registry but cannot be created, edited, or deleted through the UI. They are code-deployed system agents.

**Rationale**: Brain agents have code-managed behavior and system-level authority. Allowing UI modification would create inconsistency between deployed code and stored configuration.

### D3: Authority scopes assigned per-agent via authorized_to edges

**Status**: Confirmed (from DISCOVER A11)

Custom agents (sandbox/external) receive authority scopes through `authorized_to` relation edges created during the 5-step transactional creation flow. No template inheritance -- each agent gets explicit scope assignments.

**Rationale**: Per-identity overrides via `authorized_to` already exist (migration 0020). Custom agents use this as the primary mechanism, avoiding implicit permission escalation from template inheritance.

### D4: Walking skeleton starts with external agent CRUD

**Status**: Decided in DISCUSS

The walking skeleton (Release 1) delivers external agent creation, viewing, and deletion. This is the simplest path that validates the full architecture: schema migration, 5-step transaction, authority model, and UI rendering.

**Rationale**: External agents have minimal configuration (no sandbox config), making them the thinnest end-to-end slice. They validate the riskiest assumptions (transactional creation, authority edge creation) with least effort.

### D5: Sandbox provider is workspace-level configuration with conditional fields

**Status**: Confirmed (from DISCOVER A18), refined in DISCUSS

Sandbox provider (local/e2b/daytona/docker) is configured at the workspace level in `workspace.settings`, not per-agent. All sandbox agents in a workspace use the same provider. The provider type determines which sandbox configuration fields are available during agent creation:
- **All providers**: coding agents, environment variables, model
- **Cloud providers only** (e2b, daytona, docker): image and snapshot fields
- **Local provider** (default): image and snapshot are not applicable — the local environment is managed by the system

**Rationale**: Provider switching is an infrastructure decision, not a per-agent decision. Image and snapshot are cloud-provider concepts (container images, environment snapshots) that have no meaning when running locally.

### D6: Proxy token shown once at external agent creation

**Status**: Decided in DISCUSS

The proxy token for external agents is generated during creation and shown once in the confirmation dialog. It cannot be retrieved afterward (only the hash is stored).

**Rationale**: Security best practice for API tokens. The confirmation dialog includes copy-to-clipboard and connection instructions. Token regeneration (not included in this scope) would be a separate feature.

### D7: Authority scopes default to "propose" for new agents

**Status**: Decided in DISCUSS

When creating a new agent, all authority scopes default to "propose" (agent suggests, human approves). Users must explicitly set any action to "auto" (unattended autonomy).

**Rationale**: Safe by default. Prevents accidental granting of autonomous capabilities. Users who want auto-approval must make a conscious choice per action.

### D8: Agent deletion preserves session history

**Status**: Decided in DISCUSS

When an agent is deleted, historical `agent_session` records are preserved (orphaned from the agent but still queryable). Active sessions are terminated with status "aborted" before agent record removal.

**Rationale**: Audit trail requirement. Sessions contain decisions, observations, and task progress that must survive agent decommissioning.

### D9: 13 stories across 3 releases

**Status**: Decided in DISCUSS

The feature is scoped to 13 user stories across 3 releases:
- R1 (Walking Skeleton): 4 stories -- external agent CRUD
- R2 (Sandbox Creation): 4 stories -- sandbox agents, filtering, sessions
- R3 (Operational Dashboard): 5 stories -- edit, monitor, lifecycle

**Rationale**: Scope assessment passed (13 stories, 2 bounded contexts, estimated 24 days total). Each release delivers demonstrable value. Walking skeleton validates architecture before adding complexity.

### D10: Agent name uniqueness scoped to workspace

**Status**: Decided in DISCUSS

Agent names must be unique within a workspace but can duplicate across workspaces. Validated inline during creation with client-side feedback.

**Rationale**: Workspace isolation is already the boundary for agent identity graph traversal. Cross-workspace name duplication is expected (different organizations may have similar agent names).

## Open Questions

### Q1: Token regeneration flow

How should users regenerate a lost proxy token for an external agent? Not included in current scope. Potential future story: "Regenerate proxy token" with old token invalidation.

### Q2: agent_session.agent field migration strategy

Current schema stores `agent` as a string (agent_type value). Migration to store agent record ID or name needs backward compatibility consideration for existing session records. Addressed in US-08 technical notes.

### Q3: Bulk authority scope templates

Should common scope patterns be saveable as templates for faster agent creation? Not included in current scope per DISCOVER finding (no template inheritance for custom agents). Could be a future enhancement if creation frequency warrants it.

## Handoff to DESIGN Wave

This package is ready for the solution-architect:

1. **Journey artifacts**: `journey-agent-management-visual.md`, `journey-agent-management.yaml`, `journey-agent-management.feature`
2. **Story map**: `story-map.md` with walking skeleton and 3 release slices
3. **Prioritization**: `prioritization.md` with scoring and dependency graph
4. **User stories**: `user-stories.md` with 13 LeanUX stories (all DoR passed)
5. **Outcome KPIs**: `outcome-kpis.md` with 7 measurable outcomes
6. **Shared artifacts**: `shared-artifacts-registry.md` with integration risk assessment
7. **DoR validation**: `dor-checklist.md` with 13/13 stories passed

The solution-architect should focus on:
- Schema migration design (runtime field, sandbox_config, agent_type removal)
- API endpoint design (agent CRUD, authority scope listing)
- Transaction design (5-step atomic creation)
- Identity graph query optimization (workspace -> agents traversal)
- agent_session.agent field migration strategy (string to record reference)
