# 05 - End-to-End Smoke

## Objective
Validate the single-process app end-to-end.

## Scenarios
- `docker compose up surrealdb surrealdb-init` succeeds and schema imports.
- `/healthz` returns `{ status: "ok" }`.
- Chat request returns stream metadata.
- SSE stream reaches `done`.
- Entity search returns extracted records.
- Frontend displays stream output and entity badges.

## Acceptance Criteria
- Manual smoke run passes all scenarios on one Bun process.
