# Evolution: Agent Creation (R1 Walking Skeleton)

**Date**: 2026-03-29
**Feature**: Agent management CRUD — external agent registration, viewing, and deletion
**Branch**: `marcus-sa/agent-crud-discover`
**Duration**: 2026-03-28 (single day, ~2 hours of execution across 6 phases, 15 steps)

## Summary

Delivered the agent management feature (Release 1 / Walking Skeleton): workspace admins can register external agents with configurable authority scopes, view agent details, and delete agents with full graph cleanup. The feature replaces the closed `agent_type` enum with a `runtime` field (`brain | sandbox | external`) and introduces a transactional creation flow that atomically provisions agent records, identities, graph edges, authority scopes, and proxy tokens.

## Business Context

Brain's agent fleet was previously code-deployed only (brain agents like observer, architect, PM agent). External tools (Cursor, Aider, Codex, Claude Code) connected via MCP but had no first-class identity or configurable authority. This feature gives workspace admins a self-service registry to onboard external agents with explicit, per-agent authority scopes — moving from implicit trust to governed autonomy.

## Key Decisions

### From DISCUSS Wave

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Runtime-based taxonomy replaces `agent_type` enum | `agent_type` conflated runtime model with role identity; three runtime values map to existing code paths |
| D2 | Brain agents are read-only in UI | Code-deployed system agents; UI modification would create inconsistency |
| D3 | Authority scopes via `authorized_to` edges per-agent | Per-identity overrides already exist (migration 0020); avoids template inheritance complexity |
| D6 | Proxy token shown once at creation | Security best practice; only hash stored |
| D7 | All scopes default to "propose" | Safe by default; explicit opt-in for autonomous actions |
| D10 | Name uniqueness scoped to workspace | Validated via graph traversal within transaction |

### From DESIGN Wave

| ID | Decision | Rationale |
|----|----------|-----------|
| DD-2 | Custom agent identity role = "custom" | Layer 2 authority resolution (per-identity edges) is sole authority source for custom agents |
| DD-3 | Endpoints under `/api/workspaces/:workspaceId/agents` | Workspace-scoped, matching existing patterns |
| DD-4 | Proxy token generated inside transaction | Ensures atomicity — no agent exists without credentials |
| DD-5 | No new tables required | Extends existing identity hub-spoke pattern |
| DD-6 | Name uniqueness via graph traversal, not unique index | Agent table has no workspace field; graph path through identity edges |

### From DISTILL Wave

| ID | Decision | Rationale |
|----|----------|-----------|
| TD-2 | Session-authenticated HTTP requests | Browser-facing routes use Better Auth, not DPoP/MCP |
| TD-4 | Workspace creation via HTTP for session edge wiring | Ensures `resolveIdentityFromSession()` works in tests |
| TD-6 | Per-test workspace isolation | Concurrent-safe; no shared mutable state at describe scope |

## Steps Completed

| Step | Name | Result |
|------|------|--------|
| 01-01 | Schema migration: agent runtime, name, sandbox_config | PASS |
| 01-02 | Schema migration: workspace sandbox provider | PASS |
| 01-03 | Agent domain types and query functions | PASS |
| 01-04 | Agent CRUD route handlers and registration | PASS |
| 02-01 | Atomic creation transaction with proxy token | PASS (already working from Phase 01) |
| 02-02 | Atomic deletion transaction with edge cleanup | PASS (already working from Phase 01) |
| 02-03 | Agent list, detail, and check-name endpoints | PASS (already working from Phase 01) |
| 03-01 | Walking skeleton acceptance tests (4 scenarios) | PASS |
| 03-02 | External agent CRUD acceptance tests (19 scenarios) | PASS |
| 04-01 | Agents page, nav link, agent card component | PASS |
| 04-02 | Agent detail page with authority scopes | PASS |
| 05-01 | External agent creation form with authority scopes | PASS |
| 05-02 | Proxy token dialog and delete confirmation | PASS |
| 06-01 | Agent registry and card component tests | PASS |
| 06-02 | Creation form, authority scope, and dialog tests | PASS |

## Architecture

### New Modules

- `app/src/server/agents/` — routes, queries, types for agent CRUD
- `app/src/client/routes/agents-page.tsx` — registry with runtime grouping
- `app/src/client/routes/agent-detail-page.tsx` — detail with authority scopes
- `app/src/client/routes/agent-create-page.tsx` — creation form
- `app/src/client/components/agent/` — card, authority scope form, proxy token dialog

### Schema Changes

- Migration 0081: Added `runtime`, `name`, `sandbox_config` to agent table; backfills runtime from `agent_type`
- Migration 0082: Added `settings.sandbox_provider` to workspace table

### API Endpoints

- `GET /api/workspaces/:workspaceId/agents` — list agents via graph traversal
- `POST /api/workspaces/:workspaceId/agents` — atomic 5-step creation
- `GET /api/workspaces/:workspaceId/agents/:agentId` — detail with authority scopes
- `GET /api/workspaces/:workspaceId/agents/check-name` — name availability
- `DELETE /api/workspaces/:workspaceId/agents/:agentId` — atomic deletion with edge cleanup

### Test Coverage

- 4 walking skeleton acceptance tests
- 19 focused external agent CRUD acceptance tests (43% error paths)
- Frontend component tests for registry, detail, creation, and dialogs

## Post-Delivery: agent_type Cleanup

After R1 delivery, a follow-up session completed the `agent_type` removal across the codebase:

- Removed `agent_type` from JWT claims, MCP auth, proxy telemetry
- Removed `AgentType` type from authority module
- Simplified authority resolution from multi-level to two-level (authorized_to edge -> global default)
- Fixed migration 0081 to use optional-backfill-required pattern
- Fixed migration runner to use `frame.isError()` for reliable error detection

## Lessons Learned

1. **Phase 01 implementation was comprehensive enough that Phases 02-03 (integration/acceptance) required zero code changes.** The domain types, queries, and route handlers written in Phase 01 already satisfied all 23 acceptance test scenarios. This validates the architecture-first approach where the design wave thoroughly specified the transaction, query, and API contracts.

2. **Migration ordering matters for required fields.** Migration 0081 initially failed silently because it defined `name` as a required `TYPE string` before backfilling existing records, causing immediate validation failure on records with NONE values. The correct pattern is optional-backfill-required: define as `option<type>`, populate data, then tighten to required.

3. **Migration runner error detection was insufficient.** The runner only checked `status === "ERR"`, missing transaction failure messages returned as strings. Fixed to use the SDK's `frame.isError()` method.

## Deferred Work

- R2: Sandbox agent creation (provider validation, sandbox_config, session spawning)
- R2: Per-agent session filtering (migrate `agent_session.agent` from string to record reference)
- R3: Agent edit/update, lifecycle management, operational dashboard
- R3: Final `agent_type` field removal from schema
- Token regeneration flow for lost proxy tokens

## Migrated Artifacts

- `docs/architecture/agent-creation/` — architecture design, component boundaries, data models, technology stack
- `docs/scenarios/agent-creation/` — test scenarios, walking skeleton specification
- `docs/ux/agent-creation/` — UX journey YAML and visual
