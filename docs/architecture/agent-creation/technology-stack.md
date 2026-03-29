# Technology Stack: Agent Management

## No New Dependencies

This feature introduces zero new dependencies. All technology choices reuse the existing stack.

| Layer | Technology | License | Rationale |
|-------|-----------|---------|-----------|
| Backend runtime | Bun | MIT | Existing runtime |
| Database | SurrealDB | BSL 1.1 | Existing graph database; transactions provide atomicity for 5-step creation |
| Frontend | React | MIT | Existing frontend framework |
| Auth | Better Auth | MIT | Existing session management for browser routes |
| Token hashing | Node.js crypto (SHA-256) | Built-in | Existing pattern in `proxy-token-core.ts` |
| Token generation | Node.js crypto (randomBytes) | Built-in | Existing pattern in `proxy-token-core.ts` |
| Observability | OpenTelemetry | Apache 2.0 | Existing wide-event tracing pattern |

## Technology Decisions

### SurrealDB Transactions for Atomicity

The 5-step agent creation uses a SurrealDB `BEGIN TRANSACTION; ... COMMIT TRANSACTION;` block. This was chosen over:

1. **Application-level saga with compensating actions**: Rejected. SurrealDB transactions are single-node (no distributed coordination), making them simpler and more reliable than application-level rollback logic. The saga pattern adds complexity without benefit when all operations target the same database.

2. **Sequential creates with cleanup on failure**: Rejected. Race conditions between creation and cleanup would leave orphaned records in the failure window. Transaction guarantees atomicity without cleanup logic.

### Proxy Token Reuse

External agent tokens reuse the existing `proxy-token-core.ts` module (`osp_` prefix, SHA-256 hash, 90-day TTL). This was chosen over:

1. **New token format specific to agents**: Rejected. The existing proxy token infrastructure (issuance, validation in `proxy-auth.ts`, hash storage in `proxy_token` table) already handles the exact use case. A new format would duplicate infrastructure.

2. **JWT-based agent tokens**: Rejected. The proxy already validates `osp_` tokens via hash lookup. JWTs add token size, signing key management, and revocation complexity without benefit for this use case.

### Agent Name on Agent Table

Agent name is stored directly on the `agent` table rather than only on the linked `identity.name`. This was chosen over:

1. **Identity-only name storage**: Rejected. Querying agent name requires graph traversal through `identity_agent` edge. Direct storage enables simpler list queries and avoids N+1 patterns when displaying agent cards.

2. **Denormalized view table**: Rejected. Over-engineering for a simple read optimization. Direct field with sync enforcement (identity.name updated alongside agent.name) is sufficient.

The tradeoff is a sync invariant: `agent.name` and `identity.name` must always match. This is enforced by:
- Creation: both set in the same transaction
- Edit (R3): both updated in the same transaction
- No other code paths modify agent names

## Architectural Style

No architectural style change. The feature fits within the existing modular monolith with domain-organized route modules. The new `agents/` module follows the same pattern as `learning/`, `policy/`, `objective/`, and `behavior/`.
