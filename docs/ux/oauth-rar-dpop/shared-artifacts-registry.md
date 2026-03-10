# Shared Artifacts Registry: OAuth RAR + DPoP (Sovereign Hybrid Model)

## Purpose

This registry tracks every data value that flows across multiple steps in the two journeys (Actor Token Acquisition, Brain Resource Server Verification) and the Bridge path. Each artifact has a single source of truth and documented consumers. Untracked artifacts are the primary cause of horizontal integration failures.

## Architectural Constraint

**No `scope` artifact is tracked in this registry.** Better Auth scopes exist only at the dashboard UI authentication layer. They never flow to the Brain. The Brain speaks one language: `brain_action` authorization_details.

---

## Cross-Journey Artifacts

These artifacts flow across BOTH journeys -- they are produced in Journey 1 (Token Acquisition) and consumed in Journey 2 (Brain Resource Server Verification).

### brain_action / authorization_details

| Property | Value |
|---|---|
| Source of Truth | Actor context -- agent task context, dashboard UI action, or CLI command (Journey 1, Step 1) |
| Type | `BrainAction = { type: "brain_action", action: string, resource: string, constraints?: Record<string, unknown> }` |
| Owner | Custom Authorization Server |
| Integration Risk | **CRITICAL** -- this is the ONLY authorization object in the entire system. The Authorizer Agent evaluates brain_action objects, never scopes. |
| Consumers | J1-Step 1: constructed by actor (agent or human dashboard) |
| | J1-Step 3: submitted as `authorization_details` in intent |
| | J1-Step 4: displayed to human in consent notification |
| | J1-Step 5: sent as `authorization_details` in token request |
| | J1-Step 6: embedded in access token JWT claims |
| | J1-Bridge B2: constructed by dashboard client for Bridge exchange |
| | J2-Step 2: extracted from access token claims |
| | J2-Step 5: matched against requested operation |
| Validation | `authorization_details` MUST contain at least one entry with `type: "brain_action"`. This is enforced at EVERY boundary: Custom AS token issuance, Brain resource server verification. No scope fallback. |
| Transformation | Actor intent -> `authorization_details[]`: wrapped in array, every entry has `type: "brain_action"` |
| Key Principle | **Every request to the Brain, even a simple graph read, carries a brain_action.** There is no "this operation is too simple for RAR" exception. |

### jwk_thumbprint / cnf.jkt

| Property | Value |
|---|---|
| Source of Truth | Computed from actor's DPoP public key via RFC 7638 (Journey 1, Step 2) |
| Type | `string` (Base64url-encoded SHA-256 hash of canonical JWK) |
| Owner | Actor runtime key store (agent sandbox, browser, or CLI process) |
| Integration Risk | **HIGH** -- mismatch means token is unusable or indicates theft |
| Consumers | J1-Step 2: computed from generated key pair |
| | J1-Step 3: submitted as `dpop_jwk_thumbprint` in intent |
| | J1-Step 5: verified against DPoP proof key in token request |
| | J1-Step 6: embedded as `cnf.jkt` in access token |
| | J1-Bridge B2: computed from browser DPoP key pair |
| | J2-Step 2: extracted from access token as `cnf_jkt` |
| | J2-Step 4: compared against computed thumbprint of proof JWK |
| Validation | Must be deterministic: same key always produces same thumbprint. Must match across intent submission, token issuance, and every Brain resource server verification. |
| Key Principle | **Both agents and humans (via Bridge) have DPoP key pairs.** Agent keys live in sandbox memory. Human keys live in browser memory. Both are ephemeral. |

### intent_id

| Property | Value |
|---|---|
| Source of Truth | Custom AS response from POST /api/auth/intents (Journey 1, Step 3) |
| Type | `string` (SurrealDB record ID, e.g., "abc123") |
| Owner | Custom Authorization Server |
| Integration Risk | **MEDIUM** -- links token to authorizing intent for audit trail |
| Consumers | J1-Step 3: returned in intent creation response |
| | J1-Step 4: displayed in human consent notification |
| | J1-Step 5: sent as `intent_id` parameter in token request |
| | J1-Step 6: embedded as `urn:brain:intent_id` in access token |
| | J2-Step 2: extracted from access token claims |
| | J2-Step 7: linked in audit log entry |
| Validation | Must reference a valid intent record with status "authorized" at time of token issuance |

### access_token

| Property | Value |
|---|---|
| Source of Truth | Custom AS token endpoint response (Journey 1, Step 6) |
| Type | Signed JWT string |
| Owner | Custom Authorization Server |
| Integration Risk | **HIGH** -- the credential for the entire Brain resource server interaction |
| Consumers | J1-Step 6: issued by Custom AS |
| | J1-Step 7: sent in Authorization header to Brain resource server |
| | J1-Bridge B3: sent by dashboard to Brain resource server |
| | J2-Step 1: extracted from Authorization header |
| | J2-Step 2: validated (signature, expiry, claims) |
| Validation | Must be a valid JWT signed by the Custom AS signing key. Must contain cnf.jkt, authorization_details (with brain_action type), sub, urn:brain:workspace. |
| Key Principle | **Issued by the Custom AS, NOT by Better Auth.** Better Auth sessions cannot become access tokens for the Brain. The Bridge exchanges sessions for Custom AS tokens. |

---

## Journey 1-Only Artifacts

### dpop_private_key

| Property | Value |
|---|---|
| Source of Truth | Actor runtime key store, in-memory (Journey 1, Step 2) |
| Type | ES256 private key (CryptoKey or JWK) |
| Owner | Actor runtime (agent sandbox, browser, or CLI process) |
| Integration Risk | **CRITICAL** -- if this leaks, DPoP is defeated |
| Consumers | J1-Step 2: generated and stored |
| | J1-Step 5: used to sign DPoP proof for token request |
| | J1-Step 7: used to sign DPoP proof for Brain resource server |
| | J1-Bridge B2: generated in browser for human Bridge exchange |
| Validation | Must NEVER leave the actor's runtime boundary. Must NEVER be persisted to disk or transmitted over network. Destroyed when runtime terminates (sandbox shutdown, browser tab close, CLI exit). |

### risk_score

| Property | Value |
|---|---|
| Source of Truth | Authorizer Agent output via evaluation pipeline (Journey 1, Step 3) |
| Type | `number` (0-100) |
| Owner | Custom Authorization Server |
| Integration Risk | **MEDIUM** -- determines routing path (auto-approve vs veto window) |
| Consumers | J1-Step 3: routing decision (auto_approve / veto_window / reject) |
| | J1-Step 4: displayed to human in consent notification |
| Validation | Must be within [0, 100]. Threshold for auto-approve is 30 (configurable). |
| Key Principle | **Risk routing determines notification path, NOT authorization mechanism.** All operations use RAR regardless of risk score. Low-risk reads auto-approve; high-risk writes go to veto window. |

### routing_decision

| Property | Value |
|---|---|
| Source of Truth | `routeByRisk` function output (Journey 1, Step 3) |
| Type | `RoutingDecision = { route: "auto_approve" } | { route: "veto_window", expires_at: Date } | { route: "reject", reason: string }` |
| Owner | Custom Authorization Server |
| Integration Risk | **MEDIUM** -- determines which path the journey takes |
| Consumers | J1-Step 3: determines path (auto_approve -> Step 5, veto_window -> Step 4, reject -> error) |
| | J1-Step 4: veto window expiry time |
| Validation | Must be one of the three discriminated union variants |

### consent_decision

| Property | Value |
|---|---|
| Source of Truth | Human action via consent UI (Journey 1, Step 4) |
| Type | `"approve" | "constrain" | "veto"` |
| Owner | Human operator |
| Integration Risk | **HIGH** -- determines whether token can be issued |
| Consumers | J1-Step 4: recorded in intent/vetoed_by relation |
| | J1-Step 5: determines whether token request proceeds |
| Validation | Must be one of the three values. Veto must include a reason. Constrain must include modified params. |

### constrained_params

| Property | Value |
|---|---|
| Source of Truth | Human modification via consent UI [Constrain...] action (Journey 1, Step 4) |
| Type | Partial modification of `authorization_details` constraints |
| Owner | Human operator |
| Integration Risk | **HIGH** -- modifies the authorization boundary |
| Consumers | J1-Step 5: modified `authorization_details` in token request |
| | J1-Step 6: modified `authorization_details` in token claims |
| | J2-Step 5: Brain resource server enforces constrained bounds |
| Validation | Must produce valid `authorization_details`. Constraints must be more restrictive than original (cannot expand scope). |

### better_auth_session (Bridge Only)

| Property | Value |
|---|---|
| Source of Truth | Better Auth login response (Journey 1, Bridge B1) |
| Type | Session cookie / session token |
| Owner | Better Auth IdP |
| Integration Risk | **HIGH** -- session hijacking must NOT grant Brain access |
| Consumers | J1-Bridge B1: issued by Better Auth on login |
| | J1-Bridge B2: sent to Custom AS for session validation |
| Validation | Better Auth session = authentication proof ONLY ("I am Marcus"). It does NOT authorize any Brain operation. The Custom AS validates the session is active, then issues its own DPoP-bound RAR token. |
| Key Principle | **Scopes are for the front door only.** Better Auth scopes (e.g., "dashboard:access") are NOT consumed by the Brain. They are consumed by the dashboard UI to determine what UI features to show. The Brain never sees them. |

---

## Journey 2-Only Artifacts

### dpop_proof

| Property | Value |
|---|---|
| Source of Truth | Signed by actor's DPoP private key per-request (Journey 2 input) |
| Type | JWT string with typ "dpop+jwt" |
| Owner | Actor runtime |
| Integration Risk | **HIGH** -- the proof-of-possession artifact |
| Consumers | J2-Step 1: extracted from DPoP header |
| | J2-Step 3: validated (structure, signature, freshness, uniqueness) |
| | J2-Step 4: JWK extracted for thumbprint computation |
| Validation | Must be a fresh JWT for each request. htm must match request method. htu must match request URI. jti must be unique within the nonce window. |

### proof_jti (nonce)

| Property | Value |
|---|---|
| Source of Truth | DPoP proof JWT payload jti claim |
| Type | `string` (UUID or random identifier) |
| Owner | Actor runtime (generates), Brain resource server nonce cache (tracks) |
| Integration Risk | **MEDIUM** -- replay protection depends on this |
| Consumers | J2-Step 3: checked against nonce cache, then stored |
| Validation | Must be unique per request. Nonce cache entries auto-expire after clock skew window. |
| Key Principle | **Nonce cache must handle ALL requests, not just consequential ones.** Since every Brain operation uses DPoP, the nonce cache must be sized for total request volume. |

### computed_thumbprint

| Property | Value |
|---|---|
| Source of Truth | Computed at Brain resource server from DPoP proof JWK (Journey 2, Step 4) |
| Type | `string` (Base64url-encoded SHA-256 hash) |
| Owner | Brain resource server (computed, not stored) |
| Integration Risk | **HIGH** -- this is the sender binding verification result |
| Consumers | J2-Step 4: compared against cnf_jkt from access token |
| Validation | Must equal cnf_jkt for the request to be authorized. Computation must follow RFC 7638. |

### requested_action

| Property | Value |
|---|---|
| Source of Truth | Derived from API route + request body at Brain resource server (Journey 2, Step 5) |
| Type | `{ type: "brain_action", action: string, resource: string, constraints: Record<string, unknown> }` |
| Owner | Brain resource server route handler |
| Integration Risk | **MEDIUM** -- must be derived consistently from the HTTP request |
| Consumers | J2-Step 5: compared against authorization_details from access token |
| Validation | Derivation rules must be deterministic: same HTTP request always produces same requested_action. Type must always be "brain_action". |

---

## Removed Artifacts (Sovereign Hybrid Model)

The following artifacts from the previous tiered model have been removed:

| Artifact | Reason for Removal |
|---|---|
| `scope` | Better Auth scopes exist only at the dashboard UI layer. They never flow to the Brain. The Brain does not evaluate scopes. |
| `bearer_token` (Brain path) | The Brain does not accept Bearer tokens. All operations require DPoP-bound tokens. |
| `action_tier` / `consequential_flag` | Classification is a vulnerability. There is no "consequential vs non-consequential" boundary. All operations use RAR uniformly. |

---

## Integration Checkpoints Summary

| Checkpoint | Artifacts | Failure Mode |
|---|---|---|
| Intent-to-token sync | brain_action, authorization_details | Token request rejected if authorization_details does not match intent brain_action |
| Key binding chain | jwk_thumbprint, cnf.jkt, computed_thumbprint | Token request rejected (Step 5) or Brain request rejected (Step 4) |
| Intent traceability | intent_id | Token cannot be issued without valid authorized intent |
| DPoP freshness | proof_jti, nonce cache | Replayed proofs rejected at Brain resource server |
| Operation scope | authorization_details, requested_action | Brain rejects out-of-scope operations |
| Constraint propagation | constrained_params, authorization_details | Human constraints must flow from consent -> token -> Brain resource server |
| Session-to-token separation | better_auth_session, access_token | Session cookie CANNOT access Brain directly. Must exchange via Bridge. |
| Uniform format | authorization_details | Agent and human tokens use identical brain_action format. Brain does not distinguish actor type. |
