# Shared Artifacts Registry: Self-Hosted Deployment

## Environment Variables

### SELF_HOSTED
- **Source of truth:** Environment variable (`.env` / Docker Compose / CI)
- **Default:** `false` (unset treated as false)
- **Consumers:**
  - `schema/migrate.ts` -- gates admin user seeding
  - `app/src/server/runtime/config.ts` -- parsed into `ServerConfig.selfHosted`
  - Signup route -- returns 403 when true
  - Server startup log -- prints mode confirmation
- **Owner:** Platform operator
- **Integration risk:** HIGH -- inconsistency between migrate.ts and config.ts would seed admin but leave registration open, or vice versa
- **Validation:** Both migrate.ts and config.ts must read from the same env var name with identical parsing (truthy string check)

### ADMIN_EMAIL
- **Source of truth:** Environment variable
- **Default:** none (required when `SELF_HOSTED=true`)
- **Consumers:**
  - `schema/migrate.ts` -- creates Better Auth user record with this email
- **Owner:** Platform operator
- **Integration risk:** MEDIUM -- typo means admin cannot log in (re-run migration to fix)
- **Validation:** Must be valid email format; migration fails fast if missing when SELF_HOSTED=true

### ADMIN_PASSWORD
- **Source of truth:** Environment variable
- **Default:** none (required when `SELF_HOSTED=true`)
- **Consumers:**
  - `schema/migrate.ts` -- hashed with `Bun.password.hash()` (argon2id), stored in user record
- **Owner:** Platform operator
- **Integration risk:** HIGH -- plaintext must never appear in logs, DB, or API responses
- **Validation:** Migration must not log or echo the password value

### WORKTREE_MANAGER_ENABLED
- **Source of truth:** Environment variable
- **Default:** `false` (unset treated as false)
- **Consumers:**
  - `app/src/server/runtime/config.ts` -- parsed into `ServerConfig.worktreeManagerEnabled`
  - Workspace settings UI -- conditional render of repo path configuration
- **Owner:** Platform operator
- **Integration risk:** LOW -- controls UI visibility only, no backend behavior change
- **Validation:** Boolean parse (truthy string check)

## Derived Artifacts

### admin_user_record
- **Source of truth:** SurrealDB `user` table (Better Auth schema)
- **Created by:** Migration `0050_self_hosted_admin_seed.surql` (or equivalent TS in migrate.ts)
- **Consumers:**
  - Better Auth email/password login endpoint
  - DPoP token issuance chain
- **Integration risk:** HIGH -- if record shape does not match Better Auth expectations, login fails silently
- **Validation:** Admin can authenticate via standard login flow after migration
