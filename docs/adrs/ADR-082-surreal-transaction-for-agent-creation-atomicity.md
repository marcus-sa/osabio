# ADR-082: SurrealDB Transaction for Agent Creation Atomicity

## Status

Accepted

## Context

Agent creation is a 5-step flow that must be atomic:
1. Create agent record
2. Create identity record (type: "agent")
3. Create identity_agent edge (identity -> agent)
4. Create member_of edge (identity -> workspace)
5. Create authorized_to edges (identity -> authority_scope, one per configured action)

If any step fails after others succeed, orphaned records remain in the graph: an agent without an identity, an identity without workspace membership, or authority edges pointing to non-existent identities. These orphans break graph traversals and violate data integrity.

## Decision

Wrap all creation steps (agent record, identity record, edges, authority scopes, and proxy token for external agents) plus name uniqueness validation in a single SurrealDB `BEGIN TRANSACTION; ... COMMIT TRANSACTION;` block, executed as one `.query()` call. If any statement fails (including the uniqueness check via `THROW`), the entire transaction rolls back.

Proxy token generation for external agents is included in the transaction. The `crypto.randomBytes` call and SHA-256 hashing happen before the transaction opens (pure computation). The `CREATE proxy_token` statement is inside the transaction, ensuring the agent never exists without credentials.

## Alternatives Considered

### Application-level saga with compensating actions

Execute each step sequentially; on failure, run compensating deletions for previously completed steps. Rejected: compensating actions add complexity (each step needs a reverse), and race conditions between creation and compensation can leave the graph inconsistent during the failure window. SurrealDB transactions eliminate this class of bug.

### Two transactions (agent+identity, then edges)

Split into a "core" transaction (agent + identity) and an "edges" transaction (member_of, authorized_to). Rejected: if the edges transaction fails, the agent and identity exist without workspace membership or authority, creating an agent that appears in graph traversals but has no permissions. The window between transactions is a vulnerability.

## Consequences

**Positive**:
- Zero orphaned records on any failure path
- Single round-trip to SurrealDB (all statements in one `.query()`)
- Name uniqueness validated atomically with creation (no TOCTOU race)

**Negative**:
- Transaction scope is wider than minimal (includes name validation and proxy token)
- SurrealDB transaction holds locks across multiple table writes; acceptable for low-frequency operations (agent creation is rare)
