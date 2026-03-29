# Technology Stack: OAuth 2.1 RAR + DPoP

## Runtime and Language

| Technology | Version | License | Rationale |
|---|---|---|---|
| Bun | latest | MIT | Existing runtime. Built-in Web Crypto API for ES256 key generation. |
| TypeScript | 5.x | Apache 2.0 | Existing language. Functional paradigm (pure functions, composition pipelines). |

## Cryptography and JWT

| Technology | Version | License | Rationale | Alternatives Considered |
|---|---|---|---|---|
| `jose` | 5.x | MIT | **Already in dependencies.** JWK thumbprint (RFC 7638), JWT sign/verify, JWKS. Covers 100% of DPoP and RAR token needs. | `jsonwebtoken` (MIT): No JWK thumbprint support, no JWKS fetching. `node-jose` (MIT): Heavier API, less maintained. |
| Web Crypto API (Bun built-in) | N/A | N/A | ES256 key pair generation for agent/server signing keys. Zero-dependency. Available in Bun and browser. | `@noble/curves` (MIT): Viable but unnecessary when Web Crypto covers ES256. |

## Database

| Technology | Version | License | Rationale |
|---|---|---|---|
| SurrealDB | 3.0 | BSL 1.1 | Existing database. SCHEMAFULL mode. Schema extended with DPoP fields on intent table, new audit_event table. |
| `surrealdb` JS SDK | 2.x | Apache 2.0 | Existing SDK. RecordId-based queries. |

## Authentication (Existing, Preserved)

| Technology | Version | License | Rationale |
|---|---|---|---|
| Better Auth | latest | MIT | Human identity provider. Session management. OAuth provider plugin for dashboard login. Unchanged role. |
| `@better-auth/oauth-provider` | latest | MIT | OAuth 2.1 provider plugin for human sessions. Scopes remain for dashboard UI only. |

## AI/LLM (Existing, Unchanged)

| Technology | Version | License | Rationale |
|---|---|---|---|
| Vercel AI SDK | latest | Apache 2.0 | Existing. Used by Authorizer Agent for intent evaluation (generateObject). |
| OpenRouter | N/A | N/A | Existing LLM provider. Authorizer Agent calls via AI SDK. |

## New Dependencies: None

The entire OAuth RAR + DPoP implementation requires **zero new npm dependencies**. All cryptographic operations use the existing `jose` library and Bun's built-in Web Crypto API.

### Dependency Justification

| Need | Solution | Why No New Dependency |
|---|---|---|
| ES256 key pair generation | `crypto.subtle.generateKey()` (Web Crypto) | Built into Bun runtime |
| JWK thumbprint (RFC 7638) | `jose.calculateJwkThumbprint()` | Already in jose |
| DPoP proof creation/validation | `jose.SignJWT` / `jose.jwtVerify` | Already in jose |
| Access token signing | `jose.SignJWT` with ES256 | Already in jose |
| JWKS endpoint | `jose.exportJWK` | Already in jose |
| Nonce cache (replay protection) | Custom time-windowed Map | Simple data structure, no library needed |
| osabio_action type validation | Zod schemas | Already in project dependencies |

## Technology Decisions

### Why NOT a Separate DPoP Library

Several npm packages implement DPoP proof handling (e.g., `dpop`, `oauth4webapi`). These are rejected because:

1. `jose` already covers all JWT/JWK operations needed for DPoP
2. DPoP proof is a JWT with specific claims -- `jose.SignJWT` + `jose.jwtVerify` handle this directly
3. Adding a DPoP-specific library creates an unnecessary abstraction layer over `jose`
4. The Osabio's DPoP implementation has custom requirements (osabio_action integration, intent binding) that generic libraries do not cover

### Why NOT Separate JWKS for Custom AS

The Custom AS needs its own signing key (separate from Better Auth's JWKS). Options:

1. **Separate JWKS endpoint** (`/api/auth/osabio/.well-known/jwks`) -- **Selected**. Clean separation. Resource server fetches AS public key via standard JWKS protocol.
2. **Shared Better Auth JWKS** -- Rejected. Custom AS tokens have different claims and lifetime from Better Auth tokens. Sharing keys conflates trust boundaries.
3. **Hardcoded public key in resource server** -- Rejected. No key rotation capability. Violates security best practices.

### Nonce Cache Implementation

Options for replay protection nonce storage:

1. **In-memory time-windowed Map** -- **Selected**. Simple. Dependency-injected (not module singleton per project conventions). Entries auto-expire. Sufficient for single-process deployment.
2. **Redis/external store** -- Rejected. No Redis in the stack. Over-engineered for single-process monolith.
3. **SurrealDB table** -- Rejected. Nonce lookups must be < 1ms (NFR-1). DB round-trip too slow for per-request check.
