# ADR-083: authorized_to Edges as Sole Authority Source for Custom Agents

## Status

Accepted

## Context

The existing authority resolution in `iam/authority.ts` uses a 4-layer fallback:
1. Per-identity override via `authorized_to` relation edges
2. Role-based resolution via `identity.role` matching `authority_scope.agent_type`
3. Agent-type-based resolution via `authority_scope` table
4. Global defaults (workspace IS NONE)

Custom agents (sandbox/external) need configurable authority scopes set during creation. The question is which layer of the resolution cascade should carry custom agent permissions.

## Decision

Custom agents receive `identity.role = "custom"` and all their permissions are defined via `authorized_to` edges (Layer 1). No `authority_scope` seed data exists for role "custom", so Layers 2-4 return nothing for custom agents. Layer 1 is the sole authority source.

During the 5-step creation transaction, one `authorized_to` edge is created per configured action-permission pair. All actions default to "propose" (D7) unless the user explicitly sets a different permission.

## Alternatives Considered

### Add "custom" to authority_scope seed data with default permissions

Create seed rows in `authority_scope` for agent_type="custom" with "propose" defaults. Custom agent creation would then only need `authorized_to` edges for actions where the user overrides the default. Rejected: this splits authority definition across two locations (seed data + edges). When a user sets "propose" for an action, it is ambiguous whether the permission comes from the seed default or an explicit override. All-edges-no-seeds is simpler to reason about and audit.

### Map custom agent roles to existing agent_type values

Let users select a "role template" (code_agent, architect, etc.) during creation, which sets `identity.role` to that agent_type and inherits its seed permissions. Rejected: this couples custom agents to brain agent role semantics. A custom "Compliance Bot" has no meaningful mapping to "code_agent" or "management". The DISCOVER wave confirmed (D3) that per-agent authority without template inheritance is the correct model.

## Consequences

**Positive**:
- Authority for custom agents is fully explicit -- every permission is visible as a graph edge
- No hidden inheritance from seed data or role defaults
- Auditable: `SELECT permission FROM authorized_to WHERE in = $identity` shows complete authority
- No changes required to `authority.ts` -- Layer 1 already handles this case

**Negative**:
- More edges created per agent (one per action, typically 9-11 edges)
- Bulk permission changes require updating multiple edges (mitigated by transactional updates)
- No "inherit defaults" shortcut -- every action must be explicitly set (acceptable given the "safe by default" principle)
