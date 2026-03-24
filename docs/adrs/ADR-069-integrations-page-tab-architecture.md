# ADR-069: Integrations Page Tab Architecture

## Status
Proposed

## Context

The MCP Tool Registry backend exists (credential providers, connected accounts, encrypted credential storage, governance queries) but has no UI. Additionally, several backend gaps exist: no OAuth2 callback handler, no tool CRUD endpoints, no grant management endpoints, and no provider deletion endpoint.

We need a workspace-scoped admin page that surfaces all three registry domains (providers, accounts, tools) in a unified view, following existing UI patterns.

## Decision

### Single page with inline tabs at `/integrations`

Use a single `IntegrationsPage` component with three inline tab buttons (Providers, Accounts, Tools) rather than separate routes per domain. Tab state is managed via URL search params (`?tab=providers`) for deep-linking and OAuth2 callback redirects.

**Why tabs over separate routes:**
- The three domains are tightly coupled — providers feed into accounts, accounts feed into tools. Users need to switch rapidly.
- Follows the `LearningsPage` status filter pattern (inline buttons, not route changes).
- OAuth2 callback needs to redirect to a specific tab with status feedback (`?tab=accounts&status=connected`).

### Backend route handlers split by domain

New route handlers organized as:
- `tool-registry/tool-routes.ts` — tool CRUD + list with counts
- `tool-registry/grant-routes.ts` — `can_use` edge management
- `tool-registry/oauth-callback.ts` — OAuth2 callback handler (wires existing `oauth-flow.ts` helpers)

Provider deletion added to existing `routes.ts`.

**Why split files over one monolith:**
- Each file stays under ~150 lines. The existing `routes.ts` already handles providers + accounts; adding tools + grants + callback would exceed 400 lines.
- Each domain has distinct dependencies (tools need grant/governance queries; callback needs encryption + oauth-flow).

### Inline tab pattern over component library tabs

Use plain `<button>` elements with conditional `className` (matching the policy status filter pattern) rather than importing a Tabs component from shadcn.

**Why:**
- No new dependency. Existing pages use this pattern successfully.
- Tab state stored in URL search params, not component state — survives refresh and enables OAuth2 redirect targeting.

## Consequences

- One sidebar nav item ("Integrations") added between Policies and the separator
- Three new backend route files + modifications to `start-server.ts` route registration
- Shared contract types added to `contracts.ts` for type-safe client-server communication
- OAuth2 callback completes the flow that was partially implemented (redirect URL generation existed, token exchange existed, handler was missing)
- `governs_tool` display is read-only in the tools tab — governance policy CRUD remains at `/policies`
