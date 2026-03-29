# User Stories: Claude Agent SDK Migration

## Epic: Replace OpenCode with Claude Agent SDK

---

### US-1: Agent SDK Spawn (traces to J1)

**As** the Osabio orchestrator
**I want** to spawn a coding agent via `query()` from `@anthropic-ai/claude-agent-sdk`
**So that** I get a typed event stream without managing an external server process

**Acceptance Criteria**: See AC-1.1 through AC-1.5

---

### US-2: Osabio MCP Server Integration (traces to J1)

**As** the Osabio orchestrator
**I want** to configure the Osabio MCP server as a stdio transport in the Agent SDK options
**So that** all 20+ Osabio tools are available to the agent without duplicate definitions

**Acceptance Criteria**: See AC-2.1 through AC-2.3

---

### US-3: Lifecycle Hooks (traces to J3)

**As** the Osabio orchestrator
**I want** all 6 lifecycle hooks implemented as TypeScript callbacks
**So that** the knowledge graph stays synchronized throughout the agent session

**Acceptance Criteria**: See AC-3.1 through AC-3.6

---

### US-4: Event Stream Translation (traces to J1)

**As** the Osabio orchestrator
**I want** SDK messages translated to the existing StreamEvent contract
**So that** the browser UI works unchanged

**Acceptance Criteria**: See AC-4.1 through AC-4.3

---

### US-5: Agent SDK Options Builder (traces to J1)

**As** the Osabio orchestrator
**I want** a pure function that builds Agent SDK options from Osabio config
**So that** the spawn function receives a complete, typed configuration

**Acceptance Criteria**: See AC-5.1 through AC-5.3

---

### US-6: Remove OpenCode Dependencies (traces to J2)

**As** a developer maintaining the Osabio codebase
**I want** all OpenCode-specific code, dependencies, and configuration removed
**So that** there is a single agent runtime integration to maintain

**Acceptance Criteria**: See AC-6.1 through AC-6.4

---

### US-7: ADR Update (traces to J1, J2, J3)

**As** a developer reading architecture decisions
**I want** ADR-003 superseded with a new ADR documenting the Claude Agent SDK choice
**So that** the rationale for the migration is recorded

**Acceptance Criteria**: See AC-7.1
