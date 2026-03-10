# Acceptance Criteria: OAuth RAR + DPoP (Sovereign Hybrid Model)

## Traceability Matrix

| Story | Job | Journey | Scenarios | Size Est. |
|---|---|---|---|---|
| US-001: DPoP Key Pair Lifecycle (All Actors) | Job 1, Job 4 | J1 Steps 1-2, Bridge B2 | 4 | 1-2 days |
| US-002: Intent with DPoP Binding | Job 1 | J1 Step 3 | 3 | 1-2 days |
| US-003: RAR Token Issuance (Custom AS) | Job 1 | J1 Steps 5-6 | 4 | 2-3 days |
| US-004: RAR Consent Rendering | Job 2 | J1 Step 4 | 3 | 2 days |
| US-005: DPoP Verification (Brain Boundary) | Job 3 | J2 Steps 1-4 | 6 | 2-3 days |
| US-006: RAR Scope Verification (Brain) | Job 3 | J2 Step 5 | 3 | 1-2 days |
| US-007: Bridge Token Exchange | Job 4 | Bridge B1-B3 | 4 | 2-3 days |
| US-008: Managed Agent Identity | Job 4, BR-8 | Bridge + Custom AS | 3 | 1-2 days |

---

## US-001: DPoP Key Pair Lifecycle for All Actors

### AC-001.1: Key Generation Performance
- ES256 key pair generated within 50ms per actor session (agent sandbox or browser)
- Derived from: Scenario "Agent key pair generated at session start"

### AC-001.2: Key Isolation
- Private key stored in memory only, never persisted to disk or transmitted over network
- Browser keys use Web Crypto API with non-extractable flag
- Derived from: Scenarios "Agent key pair generated at session start", "Browser key pair generated for dashboard session"

### AC-001.3: Session-Scoped Reuse
- Same key pair used for all intents/operations within a single actor session
- No new key generation for subsequent operations in the same session
- Derived from: Scenario "Key pair reused across multiple operations"

### AC-001.4: Thumbprint Determinism
- JWK thumbprint computed via RFC 7638 (SHA-256 of canonical JWK representation)
- Same key always produces the same thumbprint
- Derived from: Scenario "Agent key pair generated at session start"

---

## US-002: Intent Submission with DPoP Thumbprint Binding

### AC-002.1: Thumbprint Required for All Brain Operations
- Intent submission endpoint REQUIRES `dpop_jwk_thumbprint` field for ALL Brain operations
- Submission without thumbprint returns 400 -- no exceptions for reads or low-risk operations
- Derived from: Scenario "Intent rejected for missing DPoP thumbprint"

### AC-002.2: brain_action Required
- Intent submission endpoint REQUIRES `authorization_details` with `type: "brain_action"`
- No scope-based intents accepted
- Derived from: Scenario "Intent submitted with DPoP thumbprint for Brain operation"

### AC-002.3: Authorizer Agent Evaluates Rich Intent Objects
- Authorizer Agent evaluates brain_action intents, never scopes
- Low-risk operations (reads) auto-approve through the pipeline
- Derived from: Scenario "Read intent auto-approved by Authorizer Agent"

---

## US-003: RAR Token Issuance with DPoP Binding (Custom AS)

### AC-003.1: Custom Grant Type
- Custom AS accepts `grant_type=urn:brain:intent-authorization`
- Requires `intent_id` and `authorization_details` parameters
- Derived from: Scenario "DPoP-bound token issued for authorized intent"

### AC-003.2: Token Claims (brain_action)
- Issued token contains `cnf.jkt` matching the DPoP proof key thumbprint
- Issued token contains `authorization_details` with `type: "brain_action"` matching authorized intent
- Issued token contains `urn:brain:intent_id` referencing the authorizing intent
- Issued token expires in 300 seconds (configurable)
- Derived from: Scenario "DPoP-bound token issued for authorized intent"

### AC-003.3: Intent Status Gate
- Token request rejected with 403 if intent is not in "authorized" status
- Derived from: Scenario "Token request rejected for unauthorized intent"

### AC-003.4: Key Binding Enforcement
- Token request rejected with 401 if DPoP proof key thumbprint does not match intent `dpop_jwk_thumbprint`
- Derived from: Scenario "Token request rejected for DPoP key mismatch"

### AC-003.5: Token Re-Issuance
- New token can be issued for an authorized intent if the previous token expired
- Fresh DPoP proof with unique jti required for re-issuance
- Intent must not have expired
- Derived from: Scenario "Token re-issuance for expired token"

---

## US-004: Human-Readable RAR Consent for Veto Window

### AC-004.1: Structured Display
- brain_action authorization_details rendered in human-readable form
- Provider-specific formatting (e.g., Stripe amounts in dollars not cents, customer names not IDs)
- Risk score, Authorizer Agent reasoning, and veto window expiry displayed
- Derived from: Scenario "Consent notification shows structured brain_action"

### AC-004.2: Constrain Action
- Human can modify authorization_details constraints (e.g., cap amount)
- Constraints must be more restrictive than original (cannot expand scope)
- Constrained authorization_details flows into the issued token
- Derived from: Scenario "Human constrains authorization"

### AC-004.3: Veto Action
- Human can veto with a required reason
- Veto transitions intent to "vetoed" status
- Reason stored in vetoed_by relation with human identity
- Agent receives veto reason in error response
- Derived from: Scenario "Human vetoes with reason"

---

## US-005: DPoP Proof Verification at Brain Resource Server

### AC-005.1: Brain Rejects Non-DPoP Requests
- Bearer tokens rejected with 401 "dpop_required"
- Session cookies rejected with 401 "dpop_required"
- Missing Authorization header rejected with 401 "dpop_required"
- No scope-based authorization attempted
- Derived from: Scenarios "Session cookie rejected at Brain boundary", "Bearer token rejected at Brain boundary"

### AC-005.2: Proof Structure Validation
- DPoP proof typ must be "dpop+jwt"
- DPoP proof alg must be an approved asymmetric algorithm (ES256)
- DPoP proof header must contain jwk (public key)
- Derived from: Scenario "Valid DPoP-bound request succeeds"

### AC-005.3: Proof Claims Validation
- htm must match the HTTP request method
- htu must match the HTTP request URI (scheme + host + path, no query)
- iat must be within configurable clock skew window (default: 60s past, 5s future)
- jti must be present and unique
- Derived from: Scenarios "Valid DPoP-bound request succeeds", "Clock-skewed proof rejected"

### AC-005.4: Sender Binding
- Computed JWK thumbprint of proof's public key must match access token cnf.jkt
- Mismatch produces 401 "dpop_binding_mismatch"
- Mismatch logged as security event with both thumbprints
- Derived from: Scenario "Stolen token with wrong key rejected"

### AC-005.5: Replay Protection
- jti checked against nonce cache before processing
- Seen jti produces 401 "dpop_proof_reused"
- Fresh jti added to nonce cache with configurable TTL
- Nonce cache entries auto-expire (no unbounded growth)
- Derived from: Scenario "Replayed DPoP proof rejected"

### AC-005.6: Uniform Pipeline
- Same verification pipeline for agent tokens and human Bridge tokens
- No branching on actor type at Brain boundary
- Derived from: Property "Human and agent tokens are indistinguishable at Brain boundary"

---

## US-006: RAR Operation Scope Verification at Brain Resource Server

### AC-006.1: brain_action Type Required
- authorization_details must contain type "brain_action" -- no scope fallback
- Tokens without brain_action authorization_details rejected
- Derived from: Property "Brain only accepts brain_action authorization_details"

### AC-006.2: Action and Resource Matching
- Action must match exactly between authorization_details and requested operation
- Resource must match exactly between authorization_details and requested operation
- Derived from: Scenario "Matching operation and constraints authorized"

### AC-006.3: Operation Mismatch Rejection
- Different action (e.g., create vs delete) produces 403 "authorization_details_mismatch"
- Error detail states which operation was authorized vs requested
- Derived from: Scenario "Operation mismatch rejected"

### AC-006.4: Constraint Bound Enforcement
- Numeric constraints (e.g., amount) compared: requested must be <= authorized
- Exceeding bounds produces 403 "authorization_params_exceeded"
- Error detail states the specific constraint and bounds
- Derived from: Scenario "Constraint exceeded"

---

## US-007: Bridge Token Exchange for Human Operators

### AC-007.1: Bridge Endpoint Functional
- Bridge endpoint accepts Better Auth session cookie + DPoP proof + authorization_details
- Validates Better Auth session is active via API call
- Issues DPoP-bound token with brain_action authorization_details
- Derived from: Scenario "Human obtains Brain token via Bridge for graph read"

### AC-007.2: Session Validation
- Expired Better Auth session returns 401 "session_expired"
- Error includes guidance to redirect to Better Auth login
- Derived from: Scenario "Bridge rejects expired Better Auth session"

### AC-007.3: Brain Boundary Enforcement
- Session cookie presented directly to Brain returns 401 "dpop_required"
- Error guides client to use the Bridge
- Derived from: Scenario "Session cookie directly rejected at Brain"

### AC-007.4: Risk-Based Routing for Bridge Operations
- Low-risk reads auto-approve through Authorizer Agent
- High-risk operations trigger veto window (same as agent path)
- Derived from: Scenario "High-risk Bridge operation triggers veto window"

---

## US-008: Managed Agent Identity Registration

### AC-008.1: Identity Creation with Managed-By Relationship
- Agent identity creation records managed_by relationship to human Better Auth userId
- Identity is available for subsequent token requests
- Derived from: Scenario "Human creates managed agent identity"

### AC-008.2: Managing Human Validation
- Token requests validate that the managing human's Better Auth account is active
- Inactive managing human blocks agent token issuance with 403
- Derived from: Scenarios "Token request validates managing human is active", "Deactivated human blocks agent tokens"

### AC-008.3: Identity Revocation
- Managing human can revoke agent identity
- Revoked identity cannot obtain new tokens
- Derived from: Scenario "Deactivated human blocks agent tokens"
