# Wave Decisions: Agent Management (DESIGN)

## Design Decisions

### DD-1: Parallel-write migration strategy for agent_type to runtime

**Status**: Decided

During the transition period, both `agent_type` and `runtime` fields coexist on the agent table. New agents write `runtime` only. Brain agents (via identity bootstrap) write both fields. The `agent_type` field is made optional in R3, then removed after all consuming modules are verified.

**Rationale**: 8 modules consume `agent_type`. Updating all simultaneously is high-risk. Parallel-write lets each module migrate independently across releases without coordination.

**ADR**: ADR-081

### DD-2: Custom agent identity role = "custom"

**Status**: Decided

Custom agents (sandbox/external) receive `identity.role = "custom"` instead of a role derived from agent_type. Authority is resolved via `authorized_to` edges (Layer 2 in authority.ts), not role-based lookup (Layer 3).

**Rationale**: Custom agents do not have a predefined role in the authority_scope seed data. Their permissions are explicitly configured per-agent via `authorized_to` edges during creation. Using role "custom" with no matching authority_scope seeds means Layer 3 fallback returns nothing, and Layer 2 (per-identity edges) is the sole authority source.

### DD-3: Agent CRUD endpoints under workspace path

**Status**: Decided

Agent endpoints live under `/api/workspaces/:workspaceId/agents` rather than a top-level `/api/agents` path.

**Rationale**: Agents are workspace-scoped. The workspace ID is needed for every operation (list, create, delete) and appears naturally in the URL path, matching existing patterns (`/api/workspaces/:id/policies`, `/api/workspaces/:id/learnings`).

### DD-4: Proxy token generated inside transaction (revised after review)

**Status**: Decided (revised)

For external agents, the proxy token is generated and stored inside the same SurrealDB transaction that creates the agent, identity, and edges. The plaintext token is returned in the HTTP response.

**Rationale**: Originally the token was generated outside the transaction (post-commit). Review identified that if the token write fails, the agent would exist without credentials and no recovery path exists (token regeneration is out of scope). Including the `CREATE proxy_token` in the transaction ensures atomicity — if any step fails, no agent, identity, or token record exists. The crypto computation (`crypto.randomBytes`) happens before the transaction opens; only the `CREATE proxy_token` statement is inside the transaction.

### DD-5: No new tables required

**Status**: Decided

The feature extends existing tables (`agent`, `workspace`) and uses existing relation tables (`identity`, `identity_agent`, `member_of`, `authorized_to`, `proxy_token`). No new tables are introduced.

**Rationale**: The existing identity hub-spoke pattern and authority override system were designed to support this exact use case (ADR-010, migration 0020). Adding tables would create redundant storage.

### DD-6: Name uniqueness via graph traversal, not unique index

**Status**: Decided

Agent name uniqueness within a workspace is validated at the application level via graph traversal (workspace -> member_of -> identity -> identity_agent -> agent), not via a UNIQUE database index.

**Rationale**: The agent table has no direct `workspace` field. Uniqueness depends on the graph path through identity edges. A compound UNIQUE index on `(name, workspace)` would require adding a `workspace` field to the agent table, creating denormalization. The graph traversal validation runs inside the creation transaction, preventing race conditions.

### DD-7: Sessions listed by workspace in R1, by agent in R2+

**Status**: Decided

In R1, the agent detail page lists sessions filtered by workspace only (no per-agent filtering). In R2 (US-08), session association with specific agents will be implemented.

**Rationale**: The `agent_session.agent` field is currently a string storing the agent_type value (e.g., "code_agent"), not a record reference. Migrating this field is scoped to US-08 (R2). R1 delivers agent CRUD without session filtering to validate the core architecture.

## Constraints Carried Forward

From DISCUSS wave decisions D1-D10, all are confirmed and unchanged:

- D1 (runtime replaces agent_type): Implemented via parallel-write migration
- D2 (brain agents read-only): Enforced by UI (no create/edit/delete for runtime="brain") and API (reject runtime="brain" in POST)
- D3 (authorized_to edges per agent): Used as sole authority mechanism for custom agents
- D4 (walking skeleton = external CRUD): R1 scope unchanged
- D5 (workspace-level sandbox provider): settings.sandbox_provider field
- D6 (proxy token shown once): Generated inside transaction (`brp_` prefix), displayed in dialog
- D7 (default to "propose"): All 11 actions default to "propose" when authority_scopes omitted from request
- D8 (deletion preserves sessions): Delete transaction preserves agent_session records
- D9 (13 stories, 3 releases): Architecture supports incremental delivery
- D10 (workspace-scoped name uniqueness): Validated via graph traversal in transaction
