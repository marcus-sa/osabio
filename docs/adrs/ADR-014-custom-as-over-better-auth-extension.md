# ADR-014: Custom Authorization Server Over Better Auth Extension

## Status

Proposed

## Context

The Osabio platform needs a DPoP-bound RAR token issuance layer. Two paths exist: extend the existing Better Auth OAuth provider plugin with DPoP+RAR support, or build a Custom Authorization Server as a new module within the Osabio server.

Better Auth provides session management, OAuth 2.1 provider (authorization code + PKCE), JWKS, and JWT access tokens. However, it has no built-in support for DPoP proof validation, RAR authorization_details in tokens, or the custom grant type `urn:osabio:intent-authorization`.

The Osabio's authorization model requires tight integration with the intent evaluation pipeline (Policy Gate -> Authorizer Agent -> Risk Router) and the identity hub-spoke model. Token issuance must verify intent status, DPoP key binding, and osabio_action matching -- none of which are standard OAuth flows.

## Decision

Build a Custom Authorization Server as a new `app/src/server/oauth/` module within the Osabio server process. Better Auth remains the human identity provider (sessions, login, JWKS for session tokens). The Custom AS has its own signing key and JWKS endpoint for Osabio access tokens.

The Custom AS:
- Issues DPoP-bound tokens with osabio_action authorization_details
- Has its own ES256 signing key pair (separate from Better Auth)
- Exposes its own JWKS endpoint at `/api/auth/osabio/.well-known/jwks`
- Validates DPoP proofs using `jose` library (already in dependencies)
- Integrates with existing intent evaluation pipeline

## Alternatives Considered

### Alternative 1: Extend Better Auth with custom plugin

Write a Better Auth plugin that adds DPoP proof handling, RAR authorization_details claims, and the custom grant type.

- **Pros**: Reuses Better Auth's token signing, JWKS rotation, and session infrastructure. Single source of tokens.
- **Cons**: Better Auth's plugin API is designed for standard OAuth flows. DPoP proof validation, intent-status verification, and osabio_action claim embedding require deep hooks into the token issuance pipeline that the plugin API may not expose. Tight coupling to Better Auth's internal token format and upgrade cycle. The `oauthProvider` plugin's `customAccessTokenClaims` callback cannot perform DPoP proof validation or intent verification.
- **Rejected because**: The integration surface is too deep. Better Auth plugins can customize claims but cannot inject DPoP proof validation into the token request flow, cannot add custom grant types, and cannot reject token requests based on intent status. This would require forking or monkey-patching Better Auth internals.

### Alternative 2: Separate authorization service (standalone process)

Deploy the Custom AS as a separate Bun process communicating with the Osabio server via HTTP.

- **Pros**: Clean separation of concerns. Independent deployment and scaling.
- **Cons**: Adds network hop to every token request. Requires shared database access or API for intent status. Operational burden for solo developer (two processes to monitor). Over-engineered for single-server deployment.
- **Rejected because**: Solo developer, single-server deployment. The operational cost of a second process outweighs the architectural purity. ADR-011 (Intent Authorization Gate) already established the modular-monolith pattern for authorization features.

## Consequences

### Positive

- Full control over token format, DPoP validation, and intent integration
- No dependency on Better Auth's plugin API evolution
- Reuses existing `jose` library for all JWT/JWK operations
- Clean separation: Better Auth = human identity, Custom AS = Osabio authorization
- Single process deployment (consistent with existing architecture)

### Negative

- Two sets of signing keys in one process (Better Auth + Custom AS)
- Two JWKS endpoints (Better Auth at `/api/auth/jwks`, Custom AS at `/api/auth/osabio/.well-known/jwks`)
- Resource server must know which JWKS to use for token verification (solved by `iss` claim)
- Key rotation for Custom AS must be implemented (Better Auth handles its own)

### Quality Attribute Impact

| Attribute | Impact | Direction |
|---|---|---|
| Security | Separate signing keys isolate trust boundaries | Positive |
| Maintainability | Custom AS is a self-contained module, no Better Auth coupling | Positive |
| Testability | Custom AS can be tested independently with mock intent data | Positive |
| Performance | In-process token issuance, no network hop | Positive |
| Reliability | Same-process AS eliminates network partition risk between AS and Osabio | Positive |
