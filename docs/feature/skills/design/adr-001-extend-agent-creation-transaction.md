# ADR-001: Extend Agent Creation Transaction for Skills and Tools

## Status

Accepted

## Context

The Skills feature (#177) requires agents to be created with skill assignments (`possesses` edges) and additional tool grants (`can_use` edges) alongside existing agent record, identity, member_of, authorized_to, and proxy token records.

The current `createAgentTransaction` in `agent-queries.ts` builds a single SQL transaction string with parameterized bindings and executes it atomically. The function already handles 7 steps (agent, identity, identity_agent, member_of, 11 authorized_to edges, proxy token).

The key architectural question is whether to extend this existing transaction or introduce a separate post-creation step.

### Business Drivers

- **Atomicity**: Partial agent creation (agent exists but skills missing) would confuse admins and create orphaned state
- **Testability**: A single transaction is simpler to verify in acceptance tests (query edge counts after creation)
- **Maintainability**: One function to understand and maintain for "create agent with everything"

### Constraints

- SurrealDB transactions are multi-statement strings executed in one round-trip
- Selected skills must be validated as still active at creation time (race condition with deprecation)
- The `possesses` relation connects identity (not agent) to skill, following the identity-as-capability-hub pattern

## Decision

Extend the existing `createAgentTransaction` function to include:

1. **Pre-transaction validation**: Query all selected skill IDs and assert `status = "active"`. Throw `HttpError(409)` with specific message if any are deprecated.
2. **possesses edges**: For each skill ID, add `RELATE $identityRecord->possesses->$skillRecord SET granted_at = $now` to the transaction SQL.
3. **can_use edges**: For each additional tool ID, add `RELATE $identityRecord->can_use->$toolRecord` to the transaction SQL.
4. **Extended input type**: Add `skill_ids?: string[]` and `additional_tool_ids?: string[]` to `CreateAgentInput`.

The function signature remains the same -- callers pass the extended input, and the transaction handles all edge creation atomically.

## Alternatives Considered

### Alternative A: Post-creation edge creation (separate queries)

Create the agent first, then create `possesses` and `can_use` edges in a second step.

- Pro: Simpler modification to existing function
- Con: Not atomic -- if the second step fails, agent exists without skills
- Con: Requires cleanup logic for partial failures
- Con: Race condition window where agent is visible but incomplete
- **Rejected**: Violates the atomicity requirement that is explicitly called out in user story US-07

### Alternative B: New function for "create agent with skills"

Create a separate `createAgentWithSkillsTransaction` function alongside the existing one.

- Pro: No modification to existing function
- Con: Code duplication (both functions share 90% of the transaction logic)
- Con: Two code paths to maintain for agent creation
- Con: Risk of drift between the two functions
- **Rejected**: The existing function is already parameterized -- extending it is lower risk than duplicating it

### Alternative C: Orchestrator-level composition

Have the route handler compose multiple query functions inside its own transaction.

- Pro: Each query function stays simple
- Con: Transaction management leaks into the route handler layer
- Con: The route handler pattern in this codebase delegates all DB logic to query functions
- **Rejected**: Violates the established separation where query functions own transaction boundaries

## Consequences

### Positive

- Agent creation remains a single atomic operation regardless of how many skills/tools are assigned
- Acceptance tests can verify edge counts in a single post-creation query
- No new functions or files needed -- the existing function grows by ~20 lines of SQL generation
- Pre-validation catches stale wizard state (deprecated skill selected in Step 2) before any writes

### Negative

- `createAgentTransaction` grows from ~40 to ~60 lines of SQL building code
- The function's parameter count increases (via extended `CreateAgentInput` type)
- Testing the extended function requires setting up skill and mcp_tool records in the test database

### Trade-offs

- **Complexity vs atomicity**: The function becomes more complex, but atomicity is a hard requirement from the user stories. The trade-off favors atomicity.
- **Function size vs code duplication**: A larger function is preferred over two nearly-identical functions. If the function grows beyond ~100 lines of SQL building, extract a `buildSkillEdgeStatements` helper.
