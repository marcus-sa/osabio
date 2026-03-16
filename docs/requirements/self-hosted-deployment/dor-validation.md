# Definition of Ready Validation: Self-Hosted Deployment

## US-001: Self-Hosted Environment Configuration

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Marcus finds it impossible to automate deployment because Brain requires manual browser-based signup" |
| User/persona identified | PASS | Platform operator deploying via Docker Compose/CI pipeline |
| 3+ domain examples | PASS | 3 examples: standard deploy, missing credentials, non-self-hosted default |
| UAT scenarios (3-7) | PASS | 5 scenarios covering happy path, validation errors, defaults |
| AC derived from UAT | PASS | 5 AC items mapping to scenarios |
| Right-sized | PASS | ~1 day effort, 5 scenarios, single config.ts change |
| Technical notes | PASS | Extends loadServerConfig(), follows existing patterns, ServerConfig type changes listed |
| Dependencies tracked | PASS | None -- foundation story |

**DoR Status: PASSED**

---

## US-002: Admin User Seed During Migration

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "No user in the database because Brain requires browser-based signup" |
| User/persona identified | PASS | Platform operator running bun migrate as part of automated deployment |
| 3+ domain examples | PASS | 3 examples: fresh seed, idempotent re-run, non-self-hosted skip |
| UAT scenarios (3-7) | PASS | 5 scenarios covering seed, idempotency, skip, password safety, auth verification |
| AC derived from UAT | PASS | 6 AC items mapping to scenarios |
| Right-sized | PASS | ~1-2 days effort, 5 scenarios, migrate.ts change + Better Auth config |
| Technical notes | PASS | Bun.password.hash(), Better Auth config link, idempotency check, user table schema reference |
| Dependencies tracked | PASS | US-001, Better Auth user table (migration 0010) |

**DoR Status: PASSED**

---

## US-003: Disable Registration in Self-Hosted Mode

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Signup endpoint still open, anyone on internal network can create accounts" |
| User/persona identified | PASS | Platform operator on internal network preventing unauthorized access |
| 3+ domain examples | PASS | 3 examples: unauthorized signup blocked, admin login works, non-self-hosted registration |
| UAT scenarios (3-7) | PASS | 4 scenarios covering 403 response, admin login, hidden UI, normal registration |
| AC derived from UAT | PASS | 5 AC items mapping to scenarios |
| Right-sized | PASS | ~1 day effort, 4 scenarios, signup route guard + UI hide |
| Technical notes | PASS | Better Auth route guard, client-side flag delivery, future invitations note |
| Dependencies tracked | PASS | US-001, US-002 |

**DoR Status: PASSED**

---

## US-004: Worktree Manager Feature Flag

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Repo path config field confuses team members who don't use worktrees" |
| User/persona identified | PASS | Platform operator configuring instance for specific team workflow |
| 3+ domain examples | PASS | 3 examples: hidden by default, enabled for coding teams, flag vs backend |
| UAT scenarios (3-7) | PASS | 4 scenarios covering hidden, visible, default, save per workspace |
| AC derived from UAT | PASS | 5 AC items mapping to scenarios |
| Right-sized | PASS | ~0.5-1 day effort, 4 scenarios, conditional render in workspace settings |
| Technical notes | PASS | Client flag delivery, existing migration 0016, UI-only change |
| Dependencies tracked | PASS | US-001, migration 0016 (already applied) |

**DoR Status: PASSED**

---

## Summary

| Story | DoR | Effort | Scenarios | Priority |
|-------|-----|--------|-----------|----------|
| US-001: Env Config | PASSED | 1 day | 5 | Must Have |
| US-002: Admin Seed | PASSED | 1-2 days | 5 | Must Have |
| US-003: Disable Registration | PASSED | 1 day | 4 | Must Have |
| US-004: Worktree Flag | PASSED | 0.5-1 day | 4 | Should Have |

**All 4 stories pass DoR. Ready for DESIGN wave handoff.**

## Implementation Order

```
US-001 (config) --> US-002 (seed) --> US-003 (registration guard)
                                        |
US-001 (config) --> US-004 (worktree flag)  [parallel with US-002/003]
```

US-001 is the foundation. US-002 and US-003 are sequential (admin must exist before disabling registration makes sense to test). US-004 is independent and can be done in parallel.
