# OAuth

RFC 9449 DPoP (Demonstration of Proof-of-Possession) authentication middleware — verifies sender-constrained tokens with replay prevention for MCP endpoints.

## The Problem

Standard bearer tokens are vulnerable to token theft — anyone who intercepts the token can use it. For autonomous agents making high-stakes requests (creating intents, writing observations), the system needs proof that the token holder is the same entity that was issued the token. DPoP binds tokens to a specific key pair, so stolen tokens are useless without the private key.

## What It Does

- **8-step verification pipeline**: Extract auth → verify token → validate proof → verify sender binding → check replay → lookup workspace → verify identity lifecycle → return auth result
- **Single-use proofs**: Each DPoP proof JWT is used exactly once — replay cache prevents reuse
- **Nonce management**: Server-issued nonces with TTL for additional replay protection
- **Identity lifecycle checks**: Verifies the identity hasn't been deactivated or revoked
- **AS key management**: Authorization Server signing key generation and rotation

## Key Concepts

| Term | Definition |
|------|------------|
| **DPoP Proof** | Single-use JWT created by the client, containing the HTTP method, URL, and a thumbprint of the token |
| **Sender Binding** | Verification that the DPoP proof was created by the same key pair that the token was bound to |
| **Nonce Cache** | In-memory TTL cache of server-issued nonces — prevents proof replay attacks |
| **Identity Lifecycle** | Active / deactivated / revoked — only active identities pass authentication |
| **AS Key** | Authorization Server signing key pair for minting access tokens |

## How It Works

**8-step DPoP verification:**

1. **Extract auth**: Parse `Authorization: DPoP <token>` header and `DPoP` proof header
2. **Verify token**: Validate JWT signature against JWKS endpoint
3. **Validate proof**: Check proof JWT structure, expiry, and `ath` (access token hash) claim
4. **Verify binding**: Confirm proof's JWK thumbprint matches token's `cnf.jkt` claim
5. **Check replay**: Look up proof `jti` in nonce cache — reject if seen before
6. **Lookup workspace**: Extract `urn:brain:workspace` claim from token, verify membership via `member_of` edge
7. **Verify identity lifecycle**: Check identity status is active
8. **Return auth result**: `{ workspace, identity, scopes, agentType }`

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Missing DPoP header** | 401 — proof is required for all MCP endpoints |
| **Expired proof** | 401 — proofs have short TTL (typically seconds) |
| **Reused proof** | 401 — nonce cache detects replay, rejects |
| **Deactivated identity** | 401 — identity lifecycle check fails |
| **Missing member_of edge** | 401 — workspace lookup fails without membership relation |

## Where It Fits

```text
MCP Request
  |
  v
DPoP Middleware (this module)
  |
  +---> 1. Extract Authorization + DPoP headers
  +---> 2. Verify JWT token signature (JWKS)
  +---> 3. Validate DPoP proof structure
  +---> 4. Verify sender binding (thumbprint match)
  +---> 5. Check replay (nonce cache)
  +---> 6. Lookup workspace (JWT claim -> member_of edge)
  +---> 7. Verify identity lifecycle
  +---> 8. Return McpAuthResult
  |
  v
MCP Route Handler (authenticated)
```

**Consumes**: HTTP headers (Authorization, DPoP), JWKS endpoint, SurrealDB membership data
**Produces**: `McpAuthResult { workspace, identity, scopes, agentType }`

## File Structure

```text
oauth/
  dpop-middleware.ts      # 8-step DPoP verification pipeline (main entry point)
  dpop.ts                 # DPoP proof validation, thumbprint computation
  types.ts                # DPoP-related type definitions
  as-key-management.ts    # Authorization Server signing key generation and rotation
  nonce-cache.ts          # In-memory TTL cache for replay prevention
  identity-lifecycle.ts   # Identity status verification (active/deactivated/revoked)
```
