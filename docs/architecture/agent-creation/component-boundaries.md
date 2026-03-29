# Component Boundaries: Agent Management

## Backend Domain Module: `app/src/server/agents/`

### Responsibility
Agent CRUD operations, transactional creation/deletion, workspace-scoped agent listing with graph traversal.

### Internal Structure (crafter decides)
The module exposes route handler factories following the existing pattern (e.g., `createLearningRouteHandlers`, `createPolicyRouteHandlers`). Internal decomposition into query files, type files, and helpers is the crafter's decision.

### Dependencies (inward only)

| Dependency | Direction | Purpose |
|-----------|-----------|---------|
| `runtime/types.ts` | Inward | `ServerDependencies` type |
| `http/response.ts` | Inward | `jsonResponse`, `jsonError` |
| `http/instrumentation.ts` | Inward | `withTracing` |
| `http/errors.ts` | Inward | `HttpError` |
| `telemetry/logger.ts` | Inward | `log` |
| `proxy/proxy-token-core.ts` | Inward | `generateProxyToken`, `hashProxyToken` |
| `surrealdb` (SDK) | Infrastructure | `Surreal`, `RecordId` |

### Forbidden Dependencies

The `agents/` module must NOT import from:
- `chat/`, `extraction/` -- different domain
- `orchestrator/` -- separate concern (session management)
- `reactive/` -- separate concern (event coordination)
- `proxy/` routes -- only `proxy-token-core.ts` pure functions allowed

### Exports

```
createAgentRouteHandlers(deps: ServerDependencies) => {
  handleListAgents: (workspaceId: string, request: Request) => Promise<Response>
  handleCreateAgent: (workspaceId: string, request: Request) => Promise<Response>
  handleGetAgent: (workspaceId: string, agentId: string, request: Request) => Promise<Response>
  handleDeleteAgent: (workspaceId: string, agentId: string, request: Request) => Promise<Response>
}
```

## Frontend Pages

### `routes/agents-page.tsx`

**Responsibility**: Agent registry view with runtime grouping and filter tabs.

**Data flow**: Fetches `GET /api/workspaces/:id/agents` on mount. Groups agents by `runtime` field. Provides navigation to create and detail pages.

**Dependencies**: `useWorkspace()` hook (existing), standard React/fetch.

### `routes/agent-create-page.tsx`

**Responsibility**: Multi-step creation form. Step 1: basic info (name, description, runtime). Step 2: sandbox config (conditional on runtime). Step 3: authority scopes. Step 4: review and confirm.

**Data flow**: Posts to `POST /api/workspaces/:id/agents`. On success for external agents, shows proxy token dialog.

**Dependencies**: `useWorkspace()`, form state management.

### `routes/agent-detail-page.tsx`

**Responsibility**: Agent detail with config display, authority scopes, and session list.

**Data flow**: Fetches `GET /api/workspaces/:id/agents/:agentId`. Provides delete action with confirmation dialog.

**Dependencies**: `useWorkspace()`.

### Shared Components

| Component | Responsibility |
|-----------|---------------|
| `components/agent-card.tsx` | Renders agent name, runtime badge, description, and action buttons |
| `components/authority-scope-form.tsx` | Renders action-permission matrix with radio buttons per action |
| `components/proxy-token-dialog.tsx` | One-time token display with copy button and connection instructions |

## Route Registration

New routes registered in `runtime/start-server.ts`:

```
"/api/workspaces/:workspaceId/agents"
  GET  -> agentHandlers.handleListAgents
  POST -> agentHandlers.handleCreateAgent

"/api/workspaces/:workspaceId/agents/:agentId"
  GET    -> agentHandlers.handleGetAgent
  DELETE -> agentHandlers.handleDeleteAgent
```

## Modified Module Boundaries

### `workspace/identity-bootstrap.ts`

**Change**: Template agents write `runtime: "brain"` in addition to `agent_type`. Add `name` field to agent creation.

**Boundary preserved**: No new imports. The bootstrap module continues to handle workspace initialization only.

### `iam/authority.ts`

**Change**: None in R1. The existing 4-layer resolution already supports custom agents via `authorized_to` edges (Layer 2). Custom agents with `identity.role = "custom"` will use Layer 2 (per-identity edges) which already exists.

### `reactive/agent-activator.ts`

**Change**: In R2, update agent listing query from `SELECT id, agent_type, description FROM agent` to `SELECT id, runtime, name, description FROM agent`. The activator uses agent descriptions for LLM classification -- `name` + `description` are richer signals than `agent_type` enum values.

### `mcp/auth.ts`

**Change**: In R2, replace `urn:brain:agent_type` claim lookup with identity-based role resolution. The identity is already available in the MCP auth context; the role can be read from `identity.role` instead of a JWT claim.

## Release Scope by Component

### R1 (Walking Skeleton)

**New**: `agents/routes.ts`, `agents/queries.ts`, `agents/types.ts`, `agents-page.tsx`, `agent-create-page.tsx`, `agent-detail-page.tsx`, `agent-card.tsx`, `authority-scope-form.tsx`, `proxy-token-dialog.tsx`

**Modified**: `start-server.ts` (route registration), `identity-bootstrap.ts` (runtime field), migrations 0081 + 0082

### R2 (Sandbox Agents)

**Modified**: `agent-activator.ts`, `mcp/auth.ts`, `mcp/token-validation.ts`, sandbox config form expansion

### R3 (Cleanup + Lifecycle)

**Modified**: `auth/config.ts`, `proxy/policy-evaluator.ts`, `proxy/anthropic-proxy-route.ts`, migration 0083
