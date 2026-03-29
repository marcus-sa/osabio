# JTBD Analysis: Self-Hosted Deployment

## Job Stories

### Job 1: Automated Admin Seeding

**When** I'm deploying Osabio for my team via Docker Compose or a CI pipeline,
**I want to** set up an admin account via environment variables,
**so I can** automate the deployment without manual signup steps.

**Forces:**
- Push: Manual signup after deploy breaks automation pipelines and requires browser access on headless servers
- Pull: Single `docker compose up` that produces a ready-to-use instance
- Anxiety: "What if I typo the password and lock myself out?" (re-run migration reseeds)
- Habit: Operators expect env-var-driven config for containerized apps (12-factor)

### Job 2: Closed Registration

**When** I'm running a self-hosted Osabio instance for my organization,
**I want to** registration disabled so only the seeded admin exists,
**so I can** control access and avoid unauthorized signups on my internal network.

**Forces:**
- Push: Open registration on an internal tool is a security risk -- anyone on the network can create accounts
- Pull: Admin-only access with future invitation flow for controlled onboarding
- Anxiety: "What if I accidentally leave registration open?" (SELF_HOSTED=true disables it by default)
- Habit: Operators expect self-hosted tools to be locked down out of the box

### Job 3: Worktree Manager Feature Flag

**When** I'm self-hosting Osabio with coding agents that use git worktrees,
**I want to** enable the repo path configuration UI per-instance,
**so I can** control whether worktree management is exposed to users.

**Forces:**
- Push: Repo path UI is confusing for non-worktree setups; exposes internal filesystem paths
- Pull: Clean UI that only shows features relevant to the deployment context
- Anxiety: "Will hiding the UI break worktree functionality?" (flag only controls UI visibility, not backend)
- Habit: Feature flags for optional capabilities are standard practice

## Opportunity Prioritization

| Job | Importance | Satisfaction | Opportunity |
|-----|-----------|-------------|-------------|
| 1. Admin Seeding | 10 | 0 (not possible today) | 10 |
| 2. Closed Registration | 9 | 0 (not possible today) | 9 |
| 3. Worktree Flag | 5 | 3 (UI exists, just always visible) | 3.5 |

**Priority order:** Job 1 > Job 2 > Job 3

Jobs 1 and 2 are tightly coupled -- both gated by `SELF_HOSTED=true` and needed together for a functional self-hosted deployment. Job 3 is independent and lower priority.
