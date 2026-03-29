# Component Boundaries: OAuth 2.1 RAR + DPoP

## Module Structure

All new components live under `app/src/server/oauth/`. This module is the Custom Authorization Server and Osabio resource server DPoP verification layer.

```
app/src/server/oauth/
  types.ts              -- Shared types (OsabioAction, DPoP claims, token claims)
  dpop.ts               -- DPoP proof validation, JWK thumbprint computation
  nonce-cache.ts         -- Time-windowed nonce set (replay protection)
  token-issuer.ts        -- DPoP-bound access token signing
  intent-submission.ts   -- Intent creation with DPoP thumbprint binding
  token-endpoint.ts      -- Custom AS token endpoint handler
  bridge.ts              -- Bridge exchange endpoint handler
  dpop-middleware.ts     -- Osabio resource server DPoP verification pipeline
  rar-verifier.ts        -- osabio_action operation scope verification
  route-action-map.ts    -- HTTP route -> osabio_action mapping
  consent-renderer.ts    -- osabio_action to human-readable display
  audit.ts               -- Authorization audit event logging
```

## Component Responsibilities

### 1. Types (`types.ts`)

**Responsibility**: Algebraic data types for the entire oauth module.

- `OsabioAction` -- authorization_details entry: `{ type: "osabio_action", action, resource, constraints? }`
- `DPoPProofClaims` -- DPoP JWT payload: `{ jti, htm, htu, iat }`
- `DPoPBoundTokenClaims` -- issued access token payload with `cnf.jkt`, `authorization_details`, `urn:osabio:intent_id`
- `TokenIssuanceResult` -- discriminated union: `{ ok: true, token } | { ok: false, error, code }`
- `DPoPValidationResult` -- discriminated union: `{ valid: true, thumbprint } | { valid: false, error, code }`

**Depends on**: Nothing (leaf module).

### 2. DPoP Proof Validation (`dpop.ts`)

**Responsibility**: Pure functions for DPoP proof structure validation, signature verification, and JWK thumbprint computation.

- Validate proof JWT structure (typ="dpop+jwt", alg=ES256, jwk present)
- Verify proof signature against embedded JWK
- Validate claims (htm, htu, iat within clock skew, jti present)
- Compute JWK thumbprint via RFC 7638

**Depends on**: `types.ts`, `jose` library.
**Depended on by**: `token-endpoint.ts`, `bridge.ts`, `dpop-middleware.ts`.

### 3. Nonce Cache (`nonce-cache.ts`)

**Responsibility**: Time-windowed set for DPoP proof replay protection.

- Store seen jti values with timestamp
- Check jti uniqueness
- Auto-expire entries beyond clock skew window
- Factory function returns cache instance (dependency-injected, not module singleton)

**Depends on**: Nothing.
**Depended on by**: `dpop-middleware.ts`.
**Constraint**: Must be instantiated per server, injected via `ServerDependencies`.

### 4. Token Issuer (`token-issuer.ts`)

**Responsibility**: Sign DPoP-bound access tokens with Custom AS key.

- Accept authorized intent data + DPoP thumbprint
- Produce signed JWT with: `sub`, `cnf.jkt`, `authorization_details`, `urn:osabio:intent_id`, `urn:osabio:workspace`, `exp`
- Token TTL configurable (default 300s)
- Uses ES256 signing key (injected)

**Depends on**: `types.ts`, `jose` library.
**Depended on by**: `token-endpoint.ts`, `bridge.ts`.

### 5. Intent Submission (`intent-submission.ts`)

**Responsibility**: Extend existing intent creation with DPoP binding fields.

- Validate `authorization_details` contains type "osabio_action"
- Require `dpop_jwk_thumbprint` field
- Store both in intent record
- Trigger existing evaluation pipeline

**Depends on**: `types.ts`, existing `intent/intent-queries.ts`.
**Depended on by**: `token-endpoint.ts` (reads authorized intents).

### 6. Token Endpoint (`token-endpoint.ts`)

**Responsibility**: Custom AS token issuance endpoint.

- Accept `grant_type=urn:osabio:intent-authorization` + `intent_id` + DPoP proof
- Validate DPoP proof
- Verify intent exists, status = "authorized", not expired
- Verify proof key thumbprint matches intent `dpop_jwk_thumbprint`
- Verify `authorization_details` matches intent
- Delegate to token issuer
- Log audit event

**Depends on**: `dpop.ts`, `token-issuer.ts`, `types.ts`, `audit.ts`, SurrealDB.
**Depended on by**: Route registration in `start-server.ts`.

### 7. Bridge Exchange (`bridge.ts`)

**Responsibility**: Session-to-token exchange for human operators.

- Accept Better Auth session cookie + DPoP proof + `authorization_details`
- Validate Better Auth session is active (call Better Auth API)
- Resolve human identity from session
- Create implicit intent for the requested osabio_action
- Run through evaluation pipeline (auto-approve for low-risk reads)
- Issue DPoP-bound token via token issuer
- Log audit event

**Depends on**: `dpop.ts`, `token-issuer.ts`, `types.ts`, `audit.ts`, Better Auth, SurrealDB.
**Depended on by**: Route registration in `start-server.ts`.

### 8. DPoP Middleware (`dpop-middleware.ts`)

**Responsibility**: Osabio resource server request verification pipeline. Replaces `authenticateMcpRequest`.

- Extract `Authorization: DPoP <token>` and `DPoP: <proof>` headers
- Reject Bearer tokens, session cookies, missing headers with 401 "dpop_required"
- Validate access token (signature via AS JWKS, expiry, claims)
- Validate DPoP proof (structure, signature, claims)
- Check jti against nonce cache (replay protection)
- Compute proof JWK thumbprint, compare against token `cnf.jkt`
- Return verified auth context (identity, workspace, authorization_details)
- ONE pipeline for all requests -- no actor type branching

**Depends on**: `dpop.ts`, `nonce-cache.ts`, `rar-verifier.ts`, `types.ts`, `audit.ts`, `jose` library.
**Depended on by**: All MCP/API route handlers.

### 9. RAR Verifier (`rar-verifier.ts`)

**Responsibility**: Match requested operation against token's authorization_details.

- Extract requested osabio_action from API route + request body (via route-action-map)
- Match type (must be "osabio_action"), action, resource
- Verify constraint bounds (numeric: requested <= authorized)
- Produce specific error codes: `authorization_details_mismatch`, `authorization_params_exceeded`

**Depends on**: `types.ts`, `route-action-map.ts`.
**Depended on by**: `dpop-middleware.ts`.

### 10. Route-Action Map (`route-action-map.ts`)

**Responsibility**: Map HTTP method + path to osabio_action.

- Deterministic mapping: same request always produces same osabio_action
- Configurable per route (MCP endpoints, entity endpoints, etc.)
- Extract constraint values from request body where applicable

**Depends on**: `types.ts`.
**Depended on by**: `rar-verifier.ts`.

### 11. Consent Renderer (`consent-renderer.ts`)

**Responsibility**: Transform osabio_action authorization_details into human-readable display.

- Map action verbs to human labels ("create" -> "Create")
- Map resource types to human labels ("invoice" -> "Invoice")
- Format provider-specific values (Stripe amounts in dollars, customer names)
- Include risk score, reasoning, veto window expiry

**Depends on**: `types.ts`.
**Depended on by**: Intent pending list endpoint.

### 12. Audit Logger (`audit.ts`)

**Responsibility**: Log authorization events to SurrealDB.

- Intent submission, evaluation, routing, consent actions
- Token issuance (success/failure)
- DPoP verification (success/failure)
- Security events (thumbprint mismatch, replay detection) at elevated severity

**Depends on**: `types.ts`, SurrealDB.
**Depended on by**: `token-endpoint.ts`, `bridge.ts`, `dpop-middleware.ts`.

---

## Dependency Direction

```
types.ts (leaf -- no dependencies)
  |
  +-- dpop.ts (pure validation functions)
  |     |
  |     +-- dpop-middleware.ts (effect shell)
  |     +-- token-endpoint.ts (effect shell)
  |     +-- bridge.ts (effect shell)
  |
  +-- nonce-cache.ts (pure data structure)
  |     |
  |     +-- dpop-middleware.ts
  |
  +-- token-issuer.ts (signs tokens)
  |     |
  |     +-- token-endpoint.ts
  |     +-- bridge.ts
  |
  +-- rar-verifier.ts (pure matching)
  |     |
  |     +-- dpop-middleware.ts
  |
  +-- route-action-map.ts (pure mapping)
  |     |
  |     +-- rar-verifier.ts
  |
  +-- consent-renderer.ts (pure transform)
  |
  +-- audit.ts (effect -- writes to DB)
        |
        +-- token-endpoint.ts
        +-- bridge.ts
        +-- dpop-middleware.ts
```

All dependencies point inward. Effect boundaries are at the endpoint handlers (`token-endpoint.ts`, `bridge.ts`, `dpop-middleware.ts`). Core logic (`dpop.ts`, `rar-verifier.ts`, `route-action-map.ts`, `consent-renderer.ts`, `nonce-cache.ts`) is pure.

---

## Integration with Existing Modules

### Intent Module Extension

The existing `intent/` module is extended, not replaced:

- `intent/types.ts`: Add `authorization_details` (OsabioAction[]) and `dpop_jwk_thumbprint` (string) to `IntentRecord`
- `intent/authorizer.ts`: `EvaluateIntentInput` updated to accept `authorization_details` alongside `action_spec` (backward compatible during transition)
- `intent/intent-queries.ts`: Queries updated to read/write new fields

### MCP Route Handlers

All handlers in `mcp/mcp-route.ts` currently call `authenticateMcpRequest` (Bearer validation) + `requireScope` (scope gate). After migration:

- Replace `authenticateMcpRequest` with `authenticateDpopRequest` from `oauth/dpop-middleware.ts`
- Remove all `requireScope` calls
- Auth result includes `authorization_details` instead of `scopes`

### ServerDependencies Extension

`runtime/types.ts` gains:

- `nonceCache` -- injected nonce cache instance
- `asSigningKey` -- Custom AS ES256 signing key pair
- `asJwksUrl` -- URL for AS public key retrieval
