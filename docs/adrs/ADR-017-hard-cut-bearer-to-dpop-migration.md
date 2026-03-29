# ADR-017: Hard Cut Migration from Bearer to DPoP

## Status

Proposed

## Context

The Osabio platform currently authenticates MCP/API requests via Bearer tokens issued by Better Auth's OAuth provider. The Sovereign Hybrid Model replaces this with DPoP-bound RAR tokens issued by the Custom Authorization Server.

Two migration strategies are possible: gradual coexistence (accept both Bearer and DPoP during a transition period) or hard cut (when Custom AS is deployed, Bearer tokens are immediately rejected).

The DISCUSS wave artifacts explicitly specify hard cut: "When Custom AS goes live, all existing Bearer tokens are immediately invalidated. No coexistence period." (DoR Checklist, Design Decisions).

## Decision

Hard cut deployment. When the DPoP verification middleware is deployed:

1. `authenticateMcpRequest` (Bearer validation) is replaced by `authenticateDpopRequest`
2. Bearer tokens receive 401 "dpop_required"
3. Session cookies at the Osabio boundary receive 401 "dpop_required"
4. No fallback to scope-based authorization
5. All MCP clients (CLI, agents) must be updated to use DPoP before deployment

## Alternatives Considered

### Alternative 1: Gradual coexistence (accept Bearer OR DPoP)

Accept both authentication methods during a transition period. Bearer tokens continue to work for existing clients while new clients adopt DPoP.

- **Pros**: Zero-downtime migration. Clients can adopt DPoP at their own pace. Rollback by re-enabling Bearer.
- **Cons**: Dual verification paths at the Osabio boundary. Classification boundary between "Bearer-authenticated" and "DPoP-authenticated" requests. Complexity in determining which authorization model to apply. The security benefit of DPoP is nullified if a Bearer fallback exists -- an attacker can simply present a stolen Bearer token.
- **Rejected because**: Dual paths create exactly the classification vulnerability the Sovereign Hybrid Model eliminates. The security model is binary: either ALL requests use DPoP, or the system has a scope-based bypass. Coexistence is a temporary security regression.

### Alternative 2: Feature flag toggle (Bearer vs DPoP per workspace)

Allow workspace-level configuration to opt into DPoP.

- **Pros**: Per-workspace rollout. Risk contained to opted-in workspaces.
- **Cons**: Same dual-path problem as Alternative 1, but per workspace. Additional configuration complexity. Solo developer maintains two auth paths indefinitely.
- **Rejected because**: Same classification vulnerability at workspace level. Per-workspace flags add maintenance burden without security benefit.

## Consequences

### Positive

- No classification boundary at the Osabio. One auth path, one verification pipeline.
- Security model is immediately complete -- no window where Bearer tokens bypass DPoP
- Simpler codebase: remove Bearer auth, not maintain two paths
- Aligns with DISCUSS wave decision

### Negative

- All MCP clients (osabio CLI plugin, agent runtimes) must update simultaneously
- Requires coordinated deployment: Custom AS + updated clients deployed together
- No gradual rollback path -- reverting means re-enabling Bearer auth entirely
- Short-term disruption for any client not updated

### Migration Sequence

1. Deploy Custom AS (token endpoint, Bridge, JWKS) alongside existing Bearer auth
2. Update all MCP clients to use DPoP (osabio CLI plugin, agent runtime libraries)
3. Test DPoP path end-to-end with real clients
4. Hard cut: replace `authenticateMcpRequest` with `authenticateDpopRequest`
5. Remove Bearer auth code paths
