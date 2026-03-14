# Evolution: Policy CRUD UI

**Date**: 2026-03-14
**Feature**: policy-crud-ui
**Branch**: marcus-sa/policy-crud-ui

## Summary

Implemented full HTTP API and React management UI for governance policy CRUD operations. Policies are graph-backed governance rules with typed conditions, lifecycle state machine (draft→active→deprecated/superseded), version chains via supersedes references, and policy trace integration for intent authorization auditing.

The feature spans three layers: a route handler factory with identity-based authorization guard (agents get read-only, humans get full CRUD), SurrealDB graph queries for policy persistence with atomic supersede transactions, and a React UI with list/detail/create/version views including inline rule builder with field autocomplete from IntentEvaluationContext.

## Architecture Decisions

| ADR | Title | Summary |
|-----|-------|---------|
| ADR-003 | Client-side version diff | Version comparison computed in browser from two policy detail API responses rather than server-side diff endpoint. Reduces API surface and keeps diff logic pure. |
| ADR-005 | Atomic supersede on activate | When activating a versioned policy, atomically supersede the old version in a single transaction — update new to active, old to superseded, and transfer governance edges. |

## Implementation Phases

### Phase 01: Authorization Guard + Policy List (steps 01-01 through 01-03)

- **Identity guard**: Pure `isAgentIdentity()` predicate checking identity type via Better Auth session → person → identity_person edge → identity type. Agents receive 403 on mutation endpoints.
- **List endpoint**: `GET /api/workspaces/:workspaceId/policies` with optional `?status=` filter. Returns `PolicyListItem[]` with id, title, status, version, rules_count, timestamps.
- **Policy queries**: `listWorkspacePolicies()` with workspace scoping, `toPolicyListItem()` pure mapping with `formatTimestamp()` helper.

### Phase 02: Policy Creation + Lifecycle (steps 02-01 through 02-03)

- **Create endpoint**: `POST /api/workspaces/:workspaceId/policies` with pure validation (`validatePolicyCreateBody`). Validates title, rules array, effect (allow/deny), predicate structure (field/operator/value), operator set.
- **Activate endpoint**: `PATCH /policies/:id/activate` with status guard (only draft/testing). Atomic supersede transaction when policy has supersedes reference. Version chain monotonicity validation.
- **Deprecate endpoint**: `PATCH /policies/:id/deprecate` with status guard (only active). Updates status and removes governance edges.

### Phase 03: Policy Detail + Versioning (steps 03-01 through 03-03)

- **Detail endpoint**: `GET /policies/:id` returns full policy with rules, governance edges (governing identity + protects workspace), and version chain.
- **Version creation**: `POST /policies/:id/versions` creates new draft policy with incremented version and supersedes reference to parent.
- **Version history**: `GET /policies/:id/versions` returns full chain via bidirectional supersedes traversal. Sorted by version number with status indicators.

### Phase 04: React UI — List + Detail + Create (steps 04-01 through 04-03)

- **PoliciesPage**: Table with status filter dropdown, empty state, navigation to detail/create.
- **PolicyDetailPage**: Metadata grid, rules table, governance edges, version history, lifecycle action buttons (activate/deprecate/create version) with confirmation dialogs.
- **CreatePolicyDialog**: Modal form with embedded RuleBuilder, pure validation, POST + navigate on success.

### Phase 05: UI Enhancements (steps 05-01 through 05-02)

- **RuleBuilder**: Inline rule editor with field autocomplete from 11 IntentEvaluationContext fields, operator filtering by field type, human-readable rule preview. Pure functions for all operations.
- **PolicyTraceView + VersionDiffView**: Collapsible trace summary for intent authorization audit trail. Client-side structural diff with pure comparison functions for rules, selectors, and metadata.

## Test Coverage

- 40 acceptance tests across 6 milestone files covering authorization, CRUD, lifecycle, detail, versioning, and policy trace
- 15 unit tests for pure validation functions
- All tests passing with DES integrity verification confirmed

## Files Modified

### Server
- `app/src/server/policy/policy-route.ts` (new)
- `app/src/server/policy/policy-queries.ts` (modified)
- `app/src/server/policy/policy-validation.ts` (new)
- `app/src/server/runtime/start-server.ts` (modified)

### Client
- `app/src/client/components/policy/PoliciesPage.tsx` (new)
- `app/src/client/components/policy/PolicyDetailPage.tsx` (new)
- `app/src/client/components/policy/CreatePolicyDialog.tsx` (new)
- `app/src/client/components/policy/RuleBuilder.tsx` (new)
- `app/src/client/components/policy/PolicyTraceView.tsx` (new)
- `app/src/client/components/policy/VersionDiffView.tsx` (new)
- `app/src/client/hooks/use-policies.ts` (new)
- `app/src/client/components/layout/WorkspaceSidebar.tsx` (modified)
- `app/src/client/router.tsx` (modified)
- `app/src/client/styles.css` (modified)

### Tests
- `tests/acceptance/policy-crud-ui/milestone-1-authorization-and-list.test.ts` (new)
- `tests/acceptance/policy-crud-ui/milestone-2-policy-creation.test.ts` (new)
- `tests/acceptance/policy-crud-ui/milestone-3-policy-lifecycle.test.ts` (new)
- `tests/acceptance/policy-crud-ui/milestone-4-policy-detail.test.ts` (new)
- `tests/acceptance/policy-crud-ui/milestone-5-version-creation.test.ts` (new)
- `tests/acceptance/policy-crud-ui/milestone-6-policy-trace.test.ts` (new)
- `tests/acceptance/policy-crud-ui/policy-crud-test-kit.ts` (new)
- `tests/unit/policy-validation.test.ts` (new)
