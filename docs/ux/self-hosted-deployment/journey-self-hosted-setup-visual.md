# Journey: Self-Hosted Deployment Setup

## Flow

```
[1. Configure]        [2. Migrate]          [3. Start]            [4. Login]
 Operator sets         Operator runs         Operator starts       Admin logs in
 env vars in           bun migrate           the server            via browser
 .env / compose
      |                     |                     |                     |
      v                     v                     v                     v
 .env file            Admin seeded          Server running        Dashboard
 with SELF_HOSTED     in SurrealDB          with closed           accessible
 + credentials                              registration
```

## Emotional Arc

```
Start: Methodical       Middle: Confident        End: Satisfied
"Standard deploy         "Migration confirmed     "Instance is mine,
 checklist"               the admin seed"          locked down, ready"
```

## Step Detail

### Step 1: Configure Environment

```
$ cat .env
# --- Self-hosted mode ---
SELF_HOSTED=true
ADMIN_EMAIL=marcus@nwave.io
ADMIN_PASSWORD=<strong-password>
WORKTREE_MANAGER_ENABLED=false

# --- Standard Osabio config ---
SURREAL_URL=ws://127.0.0.1:8000/rpc
...
```

Operator adds 3-4 new env vars alongside existing Osabio config. No new files, no new tools.

### Step 2: Run Migration (Admin Seed)

```
$ bun migrate

12 pending migration(s):

...
+ Applied: 0050_self_hosted_admin_seed.surql
  > Admin user seeded: marcus@nwave.io

Done. 12 migration(s) applied.
```

Migration detects `SELF_HOSTED=true`, reads `ADMIN_EMAIL` and `ADMIN_PASSWORD`, hashes the password with argon2id, and creates the Better Auth user record. Idempotent -- re-running skips if user exists.

### Step 3: Start Server

```
$ bun run start

Osabio v0.x.x
Mode: self-hosted (registration disabled)
Listening on http://0.0.0.0:3000
```

Server startup logs confirm self-hosted mode and that registration is disabled.

### Step 4: Admin Login

Standard Better Auth email/password login. No changes to the login UI -- it works against the seeded account. Signup link/button is hidden or returns 403.

## Shared Artifacts

| Artifact | Source | Consumers |
|----------|--------|-----------|
| `SELF_HOSTED` | Environment variable | migrate.ts (admin seed gate), config.ts (registration gate, startup log), signup route (403 gate) |
| `ADMIN_EMAIL` | Environment variable | migrate.ts (user creation) |
| `ADMIN_PASSWORD` | Environment variable | migrate.ts (hash + user creation) -- never logged, never stored plaintext |
| `WORKTREE_MANAGER_ENABLED` | Environment variable | config.ts, workspace UI (conditional render) |
