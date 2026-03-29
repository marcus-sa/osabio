# Evolution: Self-Hosted Deployment

**Date**: 2026-03-16
**Branch**: `marcus-sa/self-host-env-config`
**Status**: Complete

## Feature Summary

Environment-variable-driven self-hosted deployment configuration for Osabio. Enables single-operator deployments where registration is disabled, an admin account is pre-seeded during migration, and UI elements are gated behind feature flags.

In self-hosted mode (`SELF_HOSTED=true`), a single `bun migrate` command produces a ready-to-use instance with a pre-seeded admin account. No separate provisioning step required.

## What Was Built

### Server Configuration (Step 01-01)
- Added `SELF_HOSTED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `WORKTREE_MANAGER_ENABLED` to `ServerConfig` type and `loadServerConfig()` parsing
- Conditional validation: `ADMIN_EMAIL` and `ADMIN_PASSWORD` required when `SELF_HOSTED=true`, fail-fast with clear error if missing
- `ADMIN_PASSWORD` never appears in log output

### Argon2id Password Hashing (Step 01-02)
- Configured Better Auth `emailAndPassword` with custom `password.hash` and `password.verify` using `Bun.password` (argon2id default)
- Zero external dependencies -- uses Bun runtime built-in
- `selfHosted` flag flows from `ServerConfig` through `dependencies.ts` to `createAuth`

### Admin User Seed (Step 02-01)
- After `.surql` migrations complete, when `SELF_HOSTED=true`: checks if admin exists by email, hashes password with `Bun.password.hash()`, creates `person` + `account` records matching Better Auth schema
- Transactional creation (person + account in single transaction)
- Idempotent -- re-running migration skips existing admin
- Plaintext password never stored or logged

### Signup Guard (Step 03-01)
- Better Auth `databaseHooks` intercept signup requests when `selfHosted=true`
- Returns HTTP 403 "Registration is disabled" before user creation
- Login endpoint unaffected

### Feature Flags Endpoint (Step 03-02)
- `GET /api/config` returns public non-secret flags: `{ selfHosted, worktreeManagerEnabled }`
- Single endpoint serving both signup UI and worktree UI consumers

### UI: Hide Signup (Step 03-03)
- Sign-in page fetches `selfHosted` flag from `/api/config`
- When true, hides signup toggle and "Create one" link
- Login form remains fully functional

### UI: Worktree Feature Flag (Step 03-04)
- `AgentStatusSection` fetches `worktreeManagerEnabled` from `/api/config`
- When false, hides repo path banner entirely
- Backend repo path endpoints remain functional regardless

## Architecture Decisions

### ADR-053: Admin Seed via Migration with Bun Argon2id Hashing
- **Decision**: Seed admin in `migrate.ts` using `Bun.password.hash()` (argon2id) after `.surql` migrations complete
- **Key rationale**: Single deployment command (`bun migrate`) produces ready instance; argon2id is OWASP-recommended and zero-dependency via Bun built-in
- **Rejected alternatives**: `.surql` migration file (no argon2id in SurrealQL), server startup seed (wrong phase), bcrypt (weaker), separate CLI command (extra deployment step)

### Better Auth databaseHooks for Signup Guard
- Used `databaseHooks.user.create.before` to intercept registration at the auth layer
- Rejected route-level middleware approach as fragile (depends on knowing Better Auth internal paths)

### Single Feature Flags Endpoint
- `GET /api/config` serves both signup and worktree flag consumers
- Rejected server-rendered `window.__OSABIO_CONFIG__` approach as more invasive to the static HTML serving pipeline

## Execution Stats

| Metric | Value |
|--------|-------|
| Phases | 3 (Foundation, Admin Seed, Registration Guard + Feature Flags) |
| Steps | 7 |
| Commits | 10 (8 implementation + 1 refactoring pass + 1 docs) |
| Wall time | ~41 minutes (15:51 - 16:32 UTC) |
| Files modified | ~8 production files, 0 new production files |
| New dependencies | 0 |
| Design review | Approved, 0 critical/high issues |
| Refactoring pass | L1-L4 pass applied (commit 859b2030) |

### Step Execution Detail

| Step | Name | Phases Executed | Notes |
|------|------|----------------|-------|
| 01-01 | Self-hosted env vars | PREPARE, RED_UNIT, GREEN, COMMIT | Acceptance skipped (pure config parsing) |
| 01-02 | Argon2id hash/verify | PREPARE, RED_UNIT, GREEN, COMMIT | Acceptance skipped (config wiring) |
| 02-01 | Admin user seed | PREPARE, RED_UNIT, GREEN, COMMIT | Acceptance skipped (standalone script) |
| 03-01 | Signup guard | PREPARE, RED_UNIT, GREEN, COMMIT | Acceptance test added in fix commit |
| 03-02 | Feature flags endpoint | PREPARE, RED_ACCEPTANCE, GREEN, COMMIT | Only step with acceptance test |
| 03-03 | Hide signup UI | PREPARE, RED_UNIT, GREEN, COMMIT | Acceptance skipped (no browser test infra) |
| 03-04 | Worktree feature flag | PREPARE, RED_UNIT, GREEN, COMMIT | Acceptance skipped (UI flag toggle) |

## What Was NOT Built

### User Invitations
The original feature scope considered an invitation system for self-hosted deployments (invite additional users by email). This was deferred as a future feature. The current implementation supports a single admin operator. Multi-user self-hosted deployments will require a dedicated invitation flow that bypasses the signup guard for invited users.

### Admin Password Rotation
No mechanism for changing the admin password post-seed. The operator can update the password through Better Auth's standard password change flow after logging in, but there is no CLI command for headless rotation.

## Lessons Learned

1. **Bun.password as zero-dependency argon2id**: Bun's built-in password hashing eliminated the need for `argon2` or `bcrypt` npm packages. The API (`Bun.password.hash()` / `Bun.password.verify()`) defaults to argon2id with OWASP-recommended parameters. Worth considering as the default for any Bun project needing password hashing.

2. **Better Auth databaseHooks for authorization guards**: Better Auth's `databaseHooks` provide a clean interception point for blocking operations at the data layer. Using `user.create.before` to block signup is more resilient than route-level middleware because it survives Better Auth route path changes across versions.

3. **Feature flags via simple JSON endpoint**: For a server-rendered SPA with no SSR, a `GET /api/config` endpoint returning public flags is the lowest-friction approach. No HTML templating, no build-time injection, and the endpoint is trivially testable via acceptance tests.

4. **Migration-time provisioning**: Running admin seed as part of `bun migrate` (after `.surql` files) keeps provisioning in the deployment phase rather than polluting server startup. Single command produces a ready instance -- important for Docker/compose workflows.

## Files Changed

| File | Change |
|------|--------|
| `app/src/server/runtime/config.ts` | Added self-hosted env var parsing |
| `app/src/server/auth/config.ts` | Argon2id hash/verify, signup guard via databaseHooks |
| `app/src/server/runtime/dependencies.ts` | Pass selfHosted flag to createAuth |
| `schema/migrate.ts` | Admin user seed after migrations |
| `app/src/server/runtime/start-server.ts` | GET /api/config feature flags endpoint |
| `app/src/client/routes/sign-in-page.tsx` | Hide signup UI when selfHosted |
| `app/src/client/lib/auth-client.ts` | Feature flags fetch hook |
| `app/src/client/components/graph/AgentStatusSection.tsx` | Hide repo path when worktree disabled |
