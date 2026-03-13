# US-LL-01: Browse & Filter Learning Library

## Problem

Marcus is a workspace owner managing four AI agent types (chat, PM, observer, coding via MCP) across a growing knowledge graph. He has no way to see what behavioral rules are currently active, pending review, or previously dismissed. The only option is curl-ing the API endpoint, which he finds unacceptable for day-to-day governance. He cannot answer the basic question: "What rules are my agents following right now?"

## Who

- Workspace owner | Managing multiple AI agents | Wants visibility and trust in agent behavior

## Solution

A dedicated Learning Library page accessible from the workspace sidebar, showing all learnings organized by status tabs (Active, Pending, Dismissed, Deactivated), with filtering by type, target agent, and source. Each learning displays key metadata at a glance with expandable detail.

## Job Story Trace

- **Job 1: Visibility & Audit** -- "When I am managing multiple AI agents, I want to see all the rules they're following, so I can understand and trust their behavior."

## Domain Examples

### 1: Happy Path -- Marcus reviews active learnings for coding agents

Marcus clicks "Learnings" in the sidebar. The library loads with the Active tab selected, showing 12 active learnings. He selects "mcp" from the Agent filter dropdown. The list narrows to 5 learnings that apply to coding agents. He scans the cards and sees each one shows the learning text, type badge (constraint/instruction), priority, and "mcp" agent chip. He clicks "Always use TypeScript strict mode" and the card expands to show full detail including creation date (2026-02-14) and source (human).

### 2: Edge Case -- Filtering produces no results

Marcus is on the Active tab with 12 learnings. He selects type "precedent" and agent "observer_agent". No active learnings match both filters. The library shows an empty state: "No learnings match your filters. Try broadening your search." The filter dropdowns remain visible with the current selections, allowing Marcus to adjust.

### 3: Error/Boundary -- Empty workspace with no learnings

Priya, a new workspace owner for workspace "design-studio", navigates to the Learning Library for the first time. All tabs show count (0). The Active tab displays an empty state: "No learnings yet. Learnings are behavioral rules that shape how your AI agents work. They can be created by you or suggested by agents." A prominent "Create your first learning" button is shown.

## UAT Scenarios (BDD)

### Scenario: Navigate to learning library

```gherkin
Given Marcus is logged into workspace "brain-v1"
When Marcus clicks "Learnings" in the sidebar
Then the learning library page loads at route "/learnings"
And the Active tab is selected by default
And each tab shows its item count
```

### Scenario: Browse active learnings with metadata

```gherkin
Given Marcus is on the learning library page
And there are 12 active learnings in workspace "brain-v1"
When the Active tab is displayed
Then 12 learning cards are shown
And each card displays: text preview, type badge, priority, target agent chips, source
```

### Scenario: Filter by type and agent

```gherkin
Given Marcus is viewing 12 active learnings
When Marcus selects "constraint" from the Type filter
And Marcus selects "mcp" from the Agent filter
Then only learnings matching both criteria are shown
And the URL updates with query parameters "?type=constraint&agent=mcp"
```

### Scenario: Expand card for detail

```gherkin
Given Marcus is viewing the active learnings list
When Marcus clicks the card "Always use TypeScript strict mode"
Then the card expands to show: full text, type, priority, status, source, created date, target agents
And action buttons appear: Edit, Deactivate
```

### Scenario: Empty state for new workspace

```gherkin
Given Priya is logged into workspace "design-studio" with zero learnings
When Priya navigates to the learning library
Then an empty state shows explanation text about learnings
And a "Create your first learning" call-to-action is displayed
```

### Scenario: Tab switching

```gherkin
Given Marcus is on the Active tab
And there are 3 pending learnings
When Marcus clicks the "Pending (3)" tab
Then 3 pending learning cards are displayed
And each card shows the suggesting agent and confidence score
```

## Acceptance Criteria

- [ ] Learning Library is accessible via "Learnings" link in the workspace sidebar
- [ ] Active tab is selected by default and shows count of active learnings
- [ ] All four tabs (Active, Pending, Dismissed, Deactivated) show their respective counts
- [ ] Learning cards display: text preview, type badge, priority, target agent chips, source
- [ ] Filters by type, agent, and source update the list without page reload
- [ ] Filter state is reflected in URL query parameters
- [ ] Clicking a card expands it inline with full detail and available actions
- [ ] Empty state with guidance is shown when no learnings exist
- [ ] Keyboard accessible: all tabs, filters, cards reachable via Tab key with visible focus indicators

## Technical Notes

- Backend API exists: `GET /api/workspaces/:workspaceId/learnings` with query params `status`, `type`, `agent`
- Follows existing client patterns: TanStack Router for routing, `useWorkspaceState` for workspace context
- New route: `/learnings` under the authenticated layout
- New sidebar nav item: "Learnings" (between "Graph" and "Projects" section)
- No new API endpoints needed -- existing list endpoint supports all filter combinations
- Agent type list for filter dropdown must be sourced from a shared constant (currently scattered across modules)

## Dependencies

- Existing `GET /api/workspaces/:workspaceId/learnings` API (complete)
- Existing shared contracts: `LEARNING_TYPES`, `LearningStatus` (complete)
- New shared constant needed: `AGENT_TYPES` for filter dropdown and targeting UI
