# ADR-010: Unified Identity Hub-and-Spoke Model

## Status

Proposed

## Context

The system currently uses `person` records as the sole identity primitive. Agents operate through `agent_session` records with bare string identifiers (`agent` field). This creates several problems:

1. **Attribution gap**: Agent actions are invisible or falsely attributed to humans. The `owns` relation is `IN person OUT task|project|feature` -- agents cannot own anything.
2. **Audit trail blind spot**: Cannot answer "who did this?" for agent actions. `suggestion.suggested_by` and `observation.source_agent` are bare strings with no graph identity.
3. **Authorization fragility**: `authority_scope` uses `agent_type` string matching, making per-instance permission overrides impossible.
4. **Session type mismatch**: `session.person_id` and `account.person_id` assume all authenticated actors are humans.

The system has 10+ tables with `record<person>` ownership fields and 2 relation tables (`owns`, `member_of`) constrained to `IN person`.

## Decision

Introduce a hub-and-spoke identity model:

- **Hub**: New `identity` table with shared fields (name, type, role, workspace, embedding). Type enum: `['human', 'agent', 'system']`.
- **Spokes**: `person` (human-specific: email, image) and new `agent` table (agent-specific: agent_type, model, managed_by).
- **Spoke edges**: `identity_person` (TYPE RELATION IN identity OUT person) and `identity_agent` (TYPE RELATION IN identity OUT agent).
- **Edge migration**: All `record<person>` ownership fields and relation constraints migrate to `record<identity>`.
- **Auth rewiring**: `session.person_id` and `account.person_id` become `session.identity_id` and `account.identity_id`.

The `person` table remains as a spoke for human-specific data. No data migration (project convention: breaking schema changes).

## Alternatives Considered

### Alternative 1: Extend person table with agent fields

Add `type`, `agent_type`, `model` fields directly to `person`. Rename table conceptually as "actor."

- **Pros**: Zero new tables, minimal migration surface, no spoke edges needed.
- **Cons**: Semantic mismatch (`person` table holding agent data), human-specific fields (email, image) become optional noise on agent records, no clean separation of concerns, `person_email` UNIQUE index conflicts with agents that have no email.
- **Rejected because**: Violates single-responsibility at the schema level. The `person` table has a UNIQUE email index and email-based resolution that would need complex conditional logic for agents.

### Alternative 2: Polymorphic actor with discriminated union

Create a single `actor` table with all fields, using `type` discriminator. No separate spoke tables.

- **Pros**: Single table, simple queries, no joins/traversals for identity.
- **Cons**: Wide table with many NONE fields per record type, no schema enforcement of type-specific required fields (SurrealDB SCHEMAFULL cannot conditional-require by discriminator), extraction pipeline's person resolution would need rewriting.
- **Rejected because**: SurrealDB SCHEMAFULL mode cannot enforce "agent_type is required when type = 'agent'" -- the schema would be permissive where it should be strict.

### Alternative 3: Keep person-only, add agent_identity as separate parallel

Keep `person` for humans, add `agent_identity` for agents, use `record<person|agent_identity>` union types in ownership fields.

- **Pros**: No hub table, simpler graph.
- **Cons**: Every ownership field becomes a union type (`record<person|agent_identity>`), every query needs to handle both types, no single traversal path for "who did this?", graph functions would need dual-path logic.
- **Rejected because**: Union-typed ownership fields create query complexity that scales with every new actor type. Hub-and-spoke centralizes the polymorphism.

## Consequences

### Positive

- Single `identity` node for all attribution queries -- "who did this?" resolves to one table.
- `managed_by` chain enables dual-label audit trails (agent actor + accountable human).
- Per-identity authorization overrides become possible via `authorized_to` edges.
- `person` table retains its existing structure and UNIQUE email index.
- Agent identities are first-class graph citizens: can own tasks, make decisions, have embeddings for vector search.

### Negative

- All `record<person>` ownership fields across 5+ tables must migrate to `record<identity>`.
- Auth resolution adds one hop: email -> person -> identity (spoke traversal).
- `ChatToolExecutionContext.personRecord` becomes `identityRecord` -- affects chat handler, ingress, processor, MCP auth, and all tool implementations.
- better-auth adapter maps `user` model to `person` -- the adapter FK map must also handle the identity indirection for session/account tables.
- Graph functions (`fn::workspace_entity_ids`, `fn::entity_edges`, etc.) that reference `person` in traversals or unions need updating.

### Quality Attribute Impact

| Attribute | Impact | Direction |
|-----------|--------|-----------|
| Auditability | Unified attribution for all actors | Positive |
| Maintainability | Hub-spoke isolates type-specific fields, extensible for new actor types | Positive |
| Security | Explicit identity type check replaces implicit session assumption | Positive |
| Performance | +1 spoke traversal hop on email-based auth (auth-frequency, negligible) | Neutral |
| Testability | Identity resolution is pure function (email -> RecordId), mockable at port boundary | Positive |
| Observability | Spoke traversal failures must be logged; identity resolution errors surface clearly | Requires attention |

### Observability Note

Identity resolution errors (spoke traversal returning no identity for a valid person) must fail fast with structured logging. The resolution path email -> person -> identity involves one extra query; if the spoke edge is missing, the system should throw (not silently degrade) per project failure handling conventions.

### Migration Surface (Quantified)

| Category | Count | Files/Tables |
|----------|-------|--------------|
| Schema fields changing `record<person>` to `record<identity>` | 8 | task.owner, feature.owner, decision.decided_by, decision.confirmed_by, question.assigned_to, observation.resolved_by, git_commit.author, pull_request.author |
| Relation tables changing IN constraint | 2 | owns (IN person -> IN identity), member_of (IN person -> IN identity) |
| Session/Account fields renaming | 2 | session.person_id -> identity_id, account.person_id -> identity_id |
| TypeScript files with `RecordId<"person">` | 10 | chat/handler, chat-ingress, chat-processor, tools/types, mcp/types, mcp/auth, iam/identity, extraction/person, graph/queries, observation/queries |
| OAuth tables with `record<person>` | 4 | oauthClient.userId, oauthAccessToken.userId, oauthRefreshToken.userId, oauthConsent.userId |
| New tables | 3 | identity, agent, identity_person, identity_agent |
