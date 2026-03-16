# IAM

Identity and access management — resolves identities from OAuth providers and checks authority scopes to determine what each actor can do.

## The Problem

Different actors have different authority levels. A human user can confirm decisions directly. A PM agent can only create provisional decisions. An analytics agent can only read data. The IAM module resolves who is making a request (identity) and what they're allowed to do (authority), enforced consistently across all endpoints.

## What It Does

- **Identity resolution**: Finds identities by OAuth provider + provider ID, or by email via `person -> identity_person` edges
- **Authority checking**: Loads identity type/role, looks up `authority_scope` table, returns permission level
- **Human bypass**: Human identities always get `auto` permission — no restrictions
- **Role mapping**: Maps agent types to authority roles (e.g. `pm_agent` -> `management`, `analytics_agent` -> `observer`)

## Key Concepts

| Term | Definition |
|------|------------|
| **Identity** | A record representing an actor (human or agent) with type, role, and workspace membership |
| **AuthorityAction** | A specific operation: `create_decision`, `confirm_decision`, `complete_task`, `create_observation`, etc. |
| **AuthorityPermission** | Result of authority check: `auto` (allowed), `provisional` (agent creates draft), `propose` (agent suggests), `blocked` (forbidden) |
| **Authority Scope** | Per-workspace configuration mapping agent roles to permission levels for each action |
| **Role Mapping** | `pm_agent` -> `management`, `analytics_agent` -> `observer` — maps agent types to generic roles |

## How It Works

1. Request arrives with identity context (session cookie or DPoP token)
2. `resolveIdentity()` loads the identity record from SurrealDB
3. `checkAuthority()` determines permission:
   - If identity type is `human` → return `auto` (always allowed)
   - Map agent type to role (e.g. `pm_agent` → `management`)
   - Query `authority_scope` table: workspace-scoped first, then global fallback
   - Return permission level: `auto`, `provisional`, `propose`, or `blocked`
4. Caller enforces the permission (e.g. create provisional decision vs. confirmed)

## Where It Fits

```text
Request (session cookie or DPoP token)
  |
  v
Identity Resolution
  +---> resolveIdentity(provider, providerId)
  +---> resolveByEmail(email, workspace)
  |
  v
Authority Check
  +---> checkAuthority(identity, action, workspace)
  |       |
  |       +---> Human? -> auto (always allowed)
  |       +---> Agent? -> lookup authority_scope
  |               +---> Workspace scope (priority)
  |               +---> Global scope (fallback)
  |
  v
Permission: auto | provisional | propose | blocked
```

**Consumes**: Identity records, authority scope configuration
**Produces**: Resolved identities, permission decisions

## File Structure

```text
iam/
  identity.ts    # resolveIdentity(), resolveByEmail() — identity lookup from SurrealDB
  authority.ts   # checkAuthority(), AuthorityAction, AuthorityPermission, role mapping
```
