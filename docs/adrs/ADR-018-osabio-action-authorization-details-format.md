# ADR-018: osabio_action as Uniform Authorization Details Format

## Status

Proposed

## Context

The Osabio platform needs a structured authorization format that replaces OAuth scopes at the Osabio boundary. RFC 9396 (OAuth 2.0 Rich Authorization Requests) defines `authorization_details` as an array of JSON objects with a `type` field. The platform must define its own `type` value and structure.

The existing system uses two authorization mechanisms:
1. OAuth scopes (`graph:read`, `task:write`, etc.) -- coarse-grained, applied at MCP route level
2. `action_spec` on intents (`{ provider, action, params }`) -- fine-grained, used by the Authorizer Agent

These two systems are disconnected. Scopes gate route access; action_spec describes intent purpose. Neither flows into the access token as structured authorization.

## Decision

Define `osabio_action` as the sole authorization_details type for all Osabio operations. Format:

```json
{
  "type": "osabio_action",
  "action": "<verb>",
  "resource": "<target>",
  "constraints": { ... }
}
```

Where:
- `type` is always `"osabio_action"` (RFC 9396 type discriminator)
- `action` is a verb: `read`, `create`, `update`, `delete`, `reason`, `submit`, `deploy`
- `resource` is a Osabio domain noun: `workspace`, `project`, `task`, `decision`, `question`, `observation`, `invoice`, `session`, `intent`, etc.
- `constraints` is an optional object with operation-specific bounds (amount, customer, project scope, etc.)

This replaces both OAuth scopes and action_spec as the authorization language. The Authorizer Agent evaluates osabio_action objects. The resource server verifies osabio_action objects. The access token carries osabio_action objects.

## Alternatives Considered

### Alternative 1: Keep OAuth scopes alongside RAR

Use scopes for coarse access control and RAR for fine-grained constraints.

- **Pros**: Backward compatible. Scopes provide a first-pass filter. RAR adds detail where needed.
- **Cons**: Dual authorization languages. Osabio resource server must check both. Classification boundary between "scope-level" and "RAR-level" operations. The Authorizer Agent would need to evaluate both formats.
- **Rejected because**: Classification is a vulnerability. The DISCUSS wave explicitly eliminated scope-based authorization at the Osabio boundary. Dual languages create complexity without security benefit.

### Alternative 2: Use action_spec directly in tokens

Embed the existing `{ provider, action, params }` format in access tokens instead of defining osabio_action.

- **Pros**: Reuses existing format. No new type definition.
- **Cons**: `action_spec.provider` is provider-centric ("stripe", "surrealdb"), not operation-centric. Does not align with RFC 9396's `type` discriminator pattern. `params` is an opaque bag -- no structured constraint verification possible. Cannot express reads or graph operations that have no "provider".
- **Rejected because**: action_spec is designed for intent description, not for authorization verification at the resource server. osabio_action is designed for both: intent description AND resource server verification.

### Alternative 3: Per-provider authorization_details types

Define separate types for each integration: `stripe_action`, `graph_action`, `task_action`.

- **Pros**: Type-safe per provider. Provider-specific constraint schemas.
- **Cons**: Proliferation of types. Resource server needs a matcher per type. Authorizer Agent needs evaluation logic per type. Adding a new integration requires a new type.
- **Rejected because**: Uniform authorization language is a core principle. One type, one evaluation pipeline, one verification pipeline. Provider-specific details go in `constraints`, not in the type.

## Consequences

### Positive

- Single authorization language across the entire system (intent -> token -> resource server)
- Authorizer Agent evaluates one format (osabio_action Rich Intent Objects)
- Resource server verifies one format (osabio_action matching)
- Extensible via constraints without type proliferation
- RFC 9396 compliant (type field + structured data)

### Negative

- Route-to-osabio_action mapping must be maintained (each API route maps to a osabio_action)
- Constraint verification logic must handle open-ended constraint shapes
- action_spec and osabio_action coexist during transition (intent table has both fields)
