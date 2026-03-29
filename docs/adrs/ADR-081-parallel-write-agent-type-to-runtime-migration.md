# ADR-081: Parallel-Write Migration from agent_type to runtime

## Status

Accepted

## Context

The `agent_type` field on the `agent` table serves dual purposes: it identifies the agent's runtime execution model (how it runs) and its functional role (what it does). The DISCOVER wave validated through 6 interviews that these concerns should be separated: a `runtime` field (`osabio`, `sandbox`, `external`) captures the execution model, while role is captured by `name` and `description`.

8 modules read `agent_type`:
1. `workspace/identity-bootstrap.ts` -- writes agent_type during workspace creation
2. `reactive/agent-activator.ts` -- queries agent_type for LLM classification
3. `proxy/policy-evaluator.ts` -- matches agent_type for model access policies
4. `proxy/anthropic-proxy-route.ts` -- logs agent_type as telemetry attribute
5. `mcp/token-validation.ts` -- defines agent_type claim type
6. `mcp/auth.ts` -- reads agent_type from JWT claim
7. `iam/authority.ts` -- uses agent_type for authority scope fallback
8. `auth/config.ts` -- hardcodes agent_type in token claims

Migrating all 8 simultaneously in a single release is high-risk. Any module missed would break at runtime.

## Decision

Use a parallel-write / incremental-read migration across 3 releases:

**R1**: Add `runtime` and `name` fields. Write both `agent_type` and `runtime` for osabio agents. New custom agents write `runtime` only. New code reads `runtime`.

**R2**: Update agent-activator, MCP auth, and proxy modules to read `runtime`/identity role instead of `agent_type`.

**R3**: Make `agent_type` optional. Verify all modules migrated. Remove field in final migration.

## Alternatives Considered

### Big-bang migration (all 8 modules in one release)

Update all modules simultaneously, remove `agent_type` in the same migration. Rejected: high coordination risk. Any missed reference causes runtime failures. No rollback path without reverting the migration.

### Feature flag per module

Add a `USE_RUNTIME_FIELD` flag that each module checks to decide which field to read. Rejected: project conventions prohibit hardcoded processing modes (AGENTS.md "Agentic Design: No Hardcoded Modes"). Feature flags create dual code paths that must be tested and eventually removed.

## Consequences

**Positive**:
- Each module migrates independently, reducing blast radius
- Existing functionality continues working during transition
- No feature flags or dual-path logic in production code

**Negative**:
- Temporary data duplication (agent_type + runtime on same record)
- Must track which modules are migrated across releases
- Final cleanup migration (remove agent_type) must wait until all consumers verified
