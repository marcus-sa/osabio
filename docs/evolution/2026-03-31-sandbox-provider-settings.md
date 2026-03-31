# Sandbox Provider Settings

**Date**: 2026-03-31
**Feature ID**: sandbox-provider-settings
**Branch**: marcus-sa/skills-file-storage

## Summary

Added sandbox provider configuration to workspace settings — both the backend API (GET/PUT) and frontend UI (settings page dropdown). This unblocks agent creation by allowing workspace admins to select which sandbox provider (e.g., `local-claude`) to use for sandboxed agent execution.

## Business Context

Creating sandboxed agents requires a workspace-level sandbox provider to be configured. Previously, there was no way to set this through the UI — the field existed in the SurrealDB schema but was not exposed via the settings API or rendered in the settings page. This feature closes that gap.

## Steps Completed

| Step | Description | Outcome |
|------|-------------|---------|
| 01-01 | Backend: include sandbox_provider in settings GET/PUT | Extended `toSettingsResponse()` to return `sandboxProvider`, added validation to PUT handler |
| 01-02 | Frontend: add sandbox provider select to settings page | Added `SandboxProviderSection` component with Select dropdown that persists on change |

## Key Decisions

- **Skipped unit tests** for both steps — all logic lives in route handlers and React components, covered adequately by acceptance tests and component tests respectively.
- **Validation approach**: PUT endpoint validates against a known provider list; invalid values return 400.
- **No design/architecture phase**: Feature was small enough (2 steps, single API field + single UI control) to go straight to deliver.

## Commits

- `d55602eee` — feat(settings): add sandbox_provider to workspace settings GET/PUT
- `fa82544d4` — feat(settings): add sandbox provider select to settings page

## Files Changed

- `app/src/server/workspace/workspace-routes.ts` — Extended settings response type, added sandbox_provider to GET/PUT
- `app/src/client/routes/settings-page.tsx` — Added SandboxProviderSection component
- `tests/acceptance/workspace/sandbox-provider-settings.test.ts` — Acceptance tests for settings API
