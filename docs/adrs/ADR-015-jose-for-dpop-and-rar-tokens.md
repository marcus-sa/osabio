# ADR-015: jose Library for DPoP and RAR Token Operations

## Status

Proposed

## Context

The OAuth RAR + DPoP implementation requires:
1. ES256 JWT signing and verification (DPoP proofs and access tokens)
2. JWK thumbprint computation (RFC 7638) for sender binding
3. JWKS endpoint generation (Custom AS public key exposure)
4. Remote JWKS fetching (resource server validating AS tokens)

The project already uses `jose` (v5.x, MIT license) for Better Auth token validation in `mcp/token-validation.ts`. The question is whether to use `jose` for all new cryptographic operations or introduce a DPoP-specific library.

## Decision

Use `jose` for all DPoP proof handling, RAR token signing/verification, and JWK thumbprint computation. No new npm dependencies added.

Specific `jose` functions used:
- `SignJWT` -- sign DPoP proofs and access tokens
- `jwtVerify` -- verify DPoP proofs and access tokens
- `calculateJwkThumbprint` -- RFC 7638 thumbprint for sender binding
- `exportJWK` / `importJWK` -- key serialization for JWKS endpoint
- `generateKeyPair` -- AS signing key generation (or use Web Crypto directly)
- `createRemoteJWKSet` -- resource server fetching AS public keys

## Alternatives Considered

### Alternative 1: `dpop` npm package

Dedicated DPoP implementation.

- **Pros**: Purpose-built API for DPoP proof creation and validation.
- **Cons**: Additional dependency. Internally uses `jose` anyway. Does not cover RAR token signing, JWKS generation, or thumbprint computation. Osabio-specific requirements (intent binding, osabio_action claims) not covered.
- **Rejected because**: Adds an abstraction layer over `jose` without covering the full requirement surface. `jose` alone handles everything.

### Alternative 2: `oauth4webapi` npm package

Full OAuth 2.x client library with DPoP support.

- **Pros**: Complete OAuth client implementation including DPoP. Well-maintained by the `jose` author.
- **Cons**: Designed for OAuth client-side use (sending requests to AS), not server-side token issuance. Does not help with Custom AS implementation. Over-scoped for server-side DPoP proof validation.
- **Rejected because**: Wrong abstraction level. We are building the AS, not consuming one.

### Alternative 3: Node.js `crypto` module directly

Use built-in crypto for all operations without `jose`.

- **Pros**: Zero dependencies.
- **Cons**: Manual JWT construction, no JWK thumbprint implementation, no JWKS fetching, significant boilerplate. `jose` is already a dependency.
- **Rejected because**: `jose` is already in the dependency tree and provides correct, tested implementations of JWT, JWK, and JWKS operations.

## Consequences

### Positive

- Zero new dependencies (jose already in project)
- Single library for all JWT/JWK operations (consistency)
- jose is well-maintained (regular releases, MIT license, high adoption)
- Covers 100% of requirements without gaps

### Negative

- jose API is lower-level than DPoP-specific libraries (more code for proof construction)
- No DPoP-specific error messages from the library (must implement validation logic)
