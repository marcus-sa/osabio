# ADR-053: Admin Seed via Migration with Bun Argon2id Hashing

## Status

Accepted

## Context

Osabio requires a user account to function after deployment. In cloud-hosted mode, users self-register via the signup page. In self-hosted mode (`SELF_HOSTED=true`), registration is disabled for security -- the operator needs a pre-seeded admin account created during `bun migrate`.

The seeded password hash must be compatible with Better Auth's login verification. Better Auth defaults to bcrypt but supports custom hash/verify functions.

Bun provides built-in `Bun.password.hash()` and `Bun.password.verify()` which default to argon2id -- a memory-hard algorithm recommended by OWASP for password storage. Using Bun's built-in eliminates external dependencies.

The seed must run in `schema/migrate.ts` (the migration runner) because:
1. It runs at deployment time before the server starts
2. It has direct SurrealDB access
3. It already reads Surreal env vars
4. Operators expect `bun migrate` to produce a ready-to-use instance

## Decision

1. **Configure Better Auth** with custom `password.hash` and `password.verify` using `Bun.password.hash()` / `Bun.password.verify()` in `auth/config.ts`
2. **Seed admin user in `migrate.ts`** after all `.surql` migrations complete, when `SELF_HOSTED=true`
3. **Hash with `Bun.password.hash()`** (argon2id default) -- same function Better Auth will use for verification
4. **Create both `person` and `account` records** matching Better Auth's expected schema (migration 0010)
5. **Idempotent**: check `SELECT * FROM person WHERE contact_email = $email` before insert; skip if exists

## Alternatives Considered

### A: Seed via a .surql migration file (0050_admin_seed.surql)
- **Evaluation**: SurrealQL has no built-in argon2id hashing function. Would need to store a pre-hashed password in the migration file or as an env var, which is fragile and operator-hostile.
- **Rejected**: Operators should provide a plaintext password; the system must hash it. SurrealQL cannot do this.

### B: Seed at server startup (in start-server.ts or dependencies.ts)
- **Evaluation**: Would work technically. But (a) seed runs on every server restart, adding latency; (b) mixes deployment-time concern (provisioning) with runtime concern (serving); (c) requires the full server runtime just to create a user.
- **Rejected**: Migration is the correct deployment phase for provisioning. Server startup should be fast and idempotent without DB writes.

### C: Use bcrypt (Better Auth default) instead of argon2id
- **Evaluation**: Would avoid the custom hash/verify config. But argon2id is memory-hard (resistant to GPU attacks), OWASP-recommended, and Bun's default. bcrypt is adequate but weaker against modern hardware.
- **Rejected**: Argon2id is strictly better for new deployments. `Bun.password` makes it zero-cost to adopt. No reason to choose the weaker default.

### D: Separate seed CLI command (bun seed-admin)
- **Evaluation**: Adds a separate step to the deployment pipeline. Operators must remember to run it after `bun migrate`.
- **Rejected**: Violates the "zero-touch deployment" job. One command (`bun migrate`) should produce a ready instance.

## Consequences

### Positive
- Zero external dependencies -- `Bun.password` is built-in (MIT, Bun runtime)
- Argon2id is OWASP-recommended, memory-hard, GPU-resistant
- Single deployment command (`bun migrate`) produces ready-to-use instance
- Idempotent -- safe to re-run on schema updates
- Hash algorithm consistent between seed and login (both use `Bun.password`)

### Negative
- `migrate.ts` gains non-schema responsibility (user provisioning) -- mitigated by clear separation after the migration loop
- Better Auth's default bcrypt is overridden -- any future Better Auth upgrade must preserve the custom hash/verify config
- `migrate.ts` must know Better Auth's user schema (`person` + `account` tables) -- couples migration runner to auth schema

### Risks
- If Better Auth changes its `account` table schema in a future version, the seed may create incompatible records. Mitigated: Osabio does not maintain backwards compatibility; schema changes are breaking anyway.
