# US-002: Admin User Seed During Migration

## Problem
Marcus is a platform operator who has configured Osabio for self-hosted deployment. After running `bun migrate`, he expects to log in immediately, but there is no user in the database because Osabio requires browser-based signup. He has to find a way to manually insert a user record into SurrealDB, which is error-prone and undocumented.

## Who
- Platform operator | Running `bun migrate` as part of automated deployment | Wants a ready-to-use admin account after migration completes

## Solution
When `SELF_HOSTED=true`, the migration process reads `ADMIN_EMAIL` and `ADMIN_PASSWORD`, hashes the password with argon2id via `Bun.password.hash()`, and creates a Better Auth user record in SurrealDB. The seed is idempotent -- re-running skips if the user already exists.

## Job Traceability
- Job 1: Automated Admin Seeding

## Domain Examples

### 1: Fresh deployment seed (Happy Path)
Marcus runs `bun migrate` on a fresh database with `SELF_HOSTED=true` and `ADMIN_EMAIL=marcus@nwave.io`. The migration creates a user record with email `marcus@nwave.io` and an argon2id-hashed password. Output: "Admin user seeded: marcus@nwave.io".

### 2: Idempotent re-run (Edge Case)
Marcus runs `bun migrate` again after a schema update. The admin user already exists. The migration detects the existing record and skips seeding. Output: "Admin user already exists, skipping seed".

### 3: Non-self-hosted mode skips seed (Boundary)
Carlos runs `bun migrate` without `SELF_HOSTED`. The admin seed step is skipped entirely -- no user record is created, no output about admin seeding.

## UAT Scenarios (BDD)

### Scenario: Admin seeded on fresh database
Given Marcus has configured SELF_HOSTED=true with ADMIN_EMAIL="marcus@nwave.io"
And the database has no existing user with email "marcus@nwave.io"
When Marcus runs bun migrate
Then a user record exists in the database with email "marcus@nwave.io"
And the password field contains an argon2id hash
And the migration output includes "Admin user seeded: marcus@nwave.io"

### Scenario: Idempotent re-run preserves existing admin
Given the admin user "marcus@nwave.io" was previously seeded
And Marcus runs bun migrate again
When the admin seed step executes
Then no duplicate user record is created
And the existing password hash is not overwritten
And the migration output includes "Admin user already exists"

### Scenario: Non-self-hosted skips admin seed
Given Carlos has not set SELF_HOSTED in his environment
When Carlos runs bun migrate
Then no admin user record is created
And the migration output does not mention admin seeding

### Scenario: Password is never logged
Given Marcus has configured ADMIN_PASSWORD="correct-horse-battery-staple"
When the migration runs and seeds the admin user
Then the migration output does not contain "correct-horse-battery-staple"
And the database does not store the plaintext password

### Scenario: Admin can authenticate after seed
Given Marcus has run bun migrate with SELF_HOSTED=true
And the admin user "marcus@nwave.io" was seeded
When Marcus attempts to log in via Better Auth with email "marcus@nwave.io" and password "correct-horse-battery-staple"
Then authentication succeeds

## Acceptance Criteria
- [ ] Migration seeds a Better Auth user record when `SELF_HOSTED=true`
- [ ] Password hashed with `Bun.password.hash()` (argon2id)
- [ ] Idempotent -- re-running migration does not duplicate or overwrite
- [ ] Plaintext password never appears in logs or stored data
- [ ] Seeded user can authenticate via standard Better Auth email/password login
- [ ] Migration skips seed entirely when `SELF_HOSTED` is not true

## Technical Notes
- Admin seed logic runs in `schema/migrate.ts` after schema migrations complete
- Uses `Bun.password.hash()` which defaults to argon2id -- Better Auth must be configured to use Bun's hashing (see: https://better-auth.com/docs/authentication/email-password#configuration)
- User record must match Better Auth's expected schema (check `user` table in `schema/surreal-schema.surql` and migration `0010_better_auth_tables.surql`)
- Idempotency check: `SELECT * FROM user WHERE email = $email` before INSERT

## Dependencies
- US-001 (Self-Hosted Environment Configuration) -- provides parsed env vars
- Better Auth `user` table schema (migration 0010)
