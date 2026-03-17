# US-001: Self-Hosted Environment Configuration

## Problem
Marcus is a platform operator deploying Brain for his 5-person team on an internal server. He finds it impossible to automate deployment because Brain requires manual browser-based signup after every fresh install, which breaks his Docker Compose workflow and forces him to SSH into the server to complete setup.

## Who
- Platform operator | Deploying Brain via Docker Compose or CI pipeline | Wants zero-touch automated deployment

## Solution
Add `SELF_HOSTED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `WORKTREE_MANAGER_ENABLED` environment variables to the server configuration. Parse them in `config.ts` with validation. When `SELF_HOSTED=true`, require `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Job Traceability
- Job 1: Automated Admin Seeding
- Job 3: Worktree Manager Feature Flag

## Domain Examples

### 1: Standard self-hosted deploy (Happy Path)
Marcus sets `SELF_HOSTED=true`, `ADMIN_EMAIL=marcus@nwave.io`, `ADMIN_PASSWORD=correct-horse-battery-staple` in his `.env` file alongside existing Brain config. The server starts and parses all new env vars without error. `config.selfHosted` is `true`, `config.worktreeManagerEnabled` is `false` (default).

### 2: Self-hosted without credentials (Validation Error)
Lena sets `SELF_HOSTED=true` but forgets to set `ADMIN_EMAIL`. When the server (or migration) starts, it throws: "ADMIN_EMAIL is required when SELF_HOSTED=true". She adds the missing variable and re-runs successfully.

### 3: Non-self-hosted mode (Default Behavior)
Carlos runs Brain in cloud-hosted mode. He does not set `SELF_HOSTED` at all. The config parses with `selfHosted: false` and `worktreeManagerEnabled: false`. Registration remains open. No admin seeding occurs during migration.

## UAT Scenarios (BDD)

### Scenario: All self-hosted env vars parsed correctly
Given Marcus has set SELF_HOSTED=true in his environment
And ADMIN_EMAIL is set to "marcus@nwave.io"
And ADMIN_PASSWORD is set to "correct-horse-battery-staple"
When loadServerConfig() is called
Then config.selfHosted is true
And config.adminEmail is "marcus@nwave.io"
And config.adminPassword is "correct-horse-battery-staple"
And config.worktreeManagerEnabled is false

### Scenario: SELF_HOSTED=true without ADMIN_EMAIL fails
Given Lena has set SELF_HOSTED=true in her environment
And ADMIN_EMAIL is not set
When loadServerConfig() is called
Then it throws "ADMIN_EMAIL is required when SELF_HOSTED=true"

### Scenario: SELF_HOSTED=true without ADMIN_PASSWORD fails
Given Lena has set SELF_HOSTED=true in her environment
And ADMIN_EMAIL is set to "lena@devops.internal"
And ADMIN_PASSWORD is not set
When loadServerConfig() is called
Then it throws "ADMIN_PASSWORD is required when SELF_HOSTED=true"

### Scenario: Default non-self-hosted mode
Given Carlos has not set SELF_HOSTED in his environment
When loadServerConfig() is called
Then config.selfHosted is false
And config.adminEmail is undefined
And config.adminPassword is undefined

### Scenario: Worktree manager enabled
Given Marcus has set WORKTREE_MANAGER_ENABLED=true
When loadServerConfig() is called
Then config.worktreeManagerEnabled is true

## Acceptance Criteria
- [ ] `SELF_HOSTED` env var parsed as boolean (unset/empty/"false" = false, "true" = true)
- [ ] When `SELF_HOSTED=true`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` are required -- fail fast with clear message if missing
- [ ] When `SELF_HOSTED` is not true, `ADMIN_EMAIL` and `ADMIN_PASSWORD` are ignored
- [ ] `WORKTREE_MANAGER_ENABLED` parsed as boolean, defaults to false
- [ ] All new fields added to `ServerConfig` type
- [ ] Better Auth `emailAndPassword` configured with custom `password.hash` and `password.verify` using `Bun.password.hash()` / `Bun.password.verify()` (argon2id)

## Technical Notes
- Extends `loadServerConfig()` in `app/src/server/runtime/config.ts`
- Follows existing `requireEnv()` / `optionalEnv()` patterns
- `ADMIN_PASSWORD` must never be logged during config loading
- `ServerConfig` type gains: `selfHosted: boolean`, `adminEmail?: string`, `adminPassword?: string`, `worktreeManagerEnabled: boolean`
- Better Auth already has `emailAndPassword: { enabled: true }` in `app/src/server/auth/config.ts` (line 70-72). Add custom `password.hash` and `password.verify` functions using Bun's built-in argon2id hashing:
  ```ts
  emailAndPassword: {
    enabled: true,
    password: {
      hash: (password) => Bun.password.hash(password),
      verify: ({ password, hash }) => Bun.password.verify(password, hash),
    },
  },
  ```
- This ensures the migration seed (US-002) and Better Auth login use the same hashing algorithm
- `Bun.password.hash()` defaults to argon2id -- no algorithm argument needed

## Dependencies
- None -- this is the foundation story that other stories depend on
