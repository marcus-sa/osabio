# Requirements: OAuth RAR + DPoP (Sovereign Hybrid Model)

## Business Context

The Brain platform orchestrates AI agents and human operators who perform operations on a shared knowledge graph (SurrealDB). The existing authorization system conflates authentication with authorization: Better Auth sessions grant direct Brain access, and agents use coarse-grained scopes (`task:write`) that cannot distinguish "read a project summary" from "delete all project data." The Sovereign Hybrid Model replaces this with two cleanly separated layers:

1. **Better Auth (Human Front Door)**: Standard sessions/scopes for human login to the dashboard UI. Scopes mean "I am a logged-in human." This is the entry point and NOTHING more.
2. **Custom Authorization Server (Brain Operations)**: Full RAR + Full DPoP for ANY actor (human or agent) performing ANY operation on the knowledge graph. No scopes. No tiering. Every operation is a structured `brain_action` intent.
3. **The Bridge**: When a human needs to touch the Brain, they exchange their Better Auth session for a DPoP-bound RAR token from the Custom AS.

## Business Rules

### BR-1: Uniform Authorization Model (No Tiering)

- ALL Brain operations -- reads, writes, integrations -- require RAR authorization with structured `brain_action` authorization_details
- There is NO distinction between "consequential" and "non-consequential" operations at the authorization layer
- Classification is a vulnerability: any tier boundary is an attack surface. The system has zero tier boundaries.
- The Authorizer Agent evaluates Rich Intent Objects only. It never evaluates scopes.

### BR-2: Intent-Token Binding

- Every RAR access token MUST reference a valid, authorized intent via `urn:brain:intent_id` claim
- The token's `authorization_details` MUST match the intent's `brain_action` (or its human-constrained variant)
- No RAR token can be issued without an authorized intent -- the Custom AS remains the authorization decision point

### BR-3: Sender Constraining (Universal)

- DPoP-bound tokens are cryptographically tied to the actor's key pair via `cnf.jkt` claim
- The actor's DPoP public key thumbprint is registered with the intent at submission time
- Only the holder of the matching private key can present the token to the Brain
- Private keys MUST NOT leave the actor's runtime boundary (sandbox, browser, CLI process)
- Both agents AND humans have DPoP key pairs

### BR-4: Human Oversight (Unchanged Trigger, Uniform Mechanism)

- Actions entering `veto_window` (risk_score > 30, decision = APPROVE) present RAR `authorization_details` to the human operator in human-readable form
- Humans can approve, constrain (reduce scope/budget), or veto
- Constraints modify the `authorization_details` that flow into the issued token
- Veto window expiry (default: 30 minutes) auto-authorizes medium-risk actions unless explicitly vetoed
- The risk router determines WHICH operations need human review, NOT which operations use RAR (all do)

### BR-5: Replay Protection

- Each DPoP proof MUST contain a unique `jti` nonce
- The Brain resource server maintains a time-windowed nonce cache (entries auto-expire after clock skew window)
- Reused `jti` values are rejected with a specific error code
- The nonce cache MUST be scoped per Brain resource server instance (injected via dependency injection, not module-level singleton)
- Nonce cache must be sized for ALL request volume (not just "consequential" operations)

### BR-6: Session-Brain Separation (The Bridge)

- Better Auth sessions CANNOT directly access Brain resources
- Session cookies presented to the Brain resource server are rejected with 401 "dpop_required"
- Bearer tokens presented to the Brain resource server are rejected with 401 "dpop_required"
- Humans must exchange their Better Auth session for a DPoP-bound RAR token via the Bridge endpoint
- The Custom AS validates the Better Auth session is active before issuing a Bridge token
- Better Auth scopes (e.g., "dashboard:access") are consumed by the dashboard UI only, never by the Brain

### BR-7: Human Parity

- Human and agent tokens are verified identically at the Brain boundary
- The Brain resource server does not differentiate verification logic based on actor type
- Audit trail entries use the same `brain_action` format for both human and agent operations
- If Marcus wants to create an invoice, he generates a DPoP-signed intent just like agent Kira

### BR-8: Better Auth as Proxy IdP

- Human logs into dashboard via Better Auth (standard session)
- Human can create "Managed Agent" identity nodes
- Custom AS records `identity:agent_123` is `managed_by` Better Auth `userId:human_456`
- When agent requests token, Custom AS can check Better Auth to verify managing human is still active
- Better Auth = "Soul" (human identity). Custom AS = "Skeleton" (actor tokens + DPoP).

## Functional Requirements

### FR-1: DPoP Key Pair Management (All Actors)

- Agent runtimes generate ES256 key pairs within their sandbox
- Dashboard clients generate ES256 key pairs in browser memory (Web Crypto API)
- CLI tools generate ES256 key pairs in process memory
- Key pairs persist for the duration of the actor session (not per-operation)
- JWK thumbprint (RFC 7638) computed from the public key is the binding identifier
- Key pair lifecycle: generated at session start, destroyed at runtime termination

### FR-2: Intent Submission with DPoP Binding

- Extend the intent submission endpoint to accept `dpop_jwk_thumbprint`
- The thumbprint links the intent to the actor's key pair before token issuance
- ALL Brain operations require intent submission -- reads, writes, integrations
- The evaluation pipeline (Policy Gate -> Authorizer Agent -> Risk Router -> Status Update) processes every intent
- Low-risk operations (reads, observations) auto-approve through the pipeline without human involvement

### FR-3: RAR Token Endpoint (Custom AS)

- New grant type: `urn:brain:intent-authorization`
- Accepts `intent_id` and `authorization_details` parameters
- Validates DPoP proof header (structure, signature, freshness)
- Verifies intent exists, is authorized, and requestor identity matches
- Verifies authorization_details matches intent brain_action
- Verifies DPoP proof key thumbprint matches intent dpop_jwk_thumbprint
- Issues DPoP-bound access token with `cnf.jkt`, `authorization_details`, `urn:brain:intent_id` claims
- Token TTL: configurable per operation risk level (default: 300 seconds)

### FR-4: Bridge Token Exchange Endpoint

- New endpoint: `POST /api/auth/bridge/exchange`
- Accepts Better Auth session cookie + DPoP proof + `authorization_details`
- Validates Better Auth session is still active (API call to Better Auth)
- Resolves human identity from session
- Authorizer Agent evaluates the brain_action (same pipeline as agent intents)
- Issues DPoP-bound access token with brain_action authorization_details
- Low-risk reads auto-approve (no human consent needed for the human's own reads)
- High-risk operations from the Bridge follow the same veto window path

### FR-5: RAR Consent Rendering

- Transform `authorization_details` JSON into human-readable consent display
- Provider-specific rendering rules (e.g., Stripe amounts in dollars, not cents)
- Display risk score, Authorizer Agent reasoning, and veto window expiry
- Support approve, constrain, and veto actions
- Constrain action produces modified authorization_details with tighter bounds

### FR-6: DPoP Proof Verification at Brain Resource Server

- Extract and validate DPoP proof from request headers
- Reject Bearer tokens, session cookies, and missing Authorization headers with "dpop_required"
- Verify proof structure (typ, alg, jwk), signature, and claims (htm, htu, iat, jti)
- Compute JWK thumbprint and compare against access token `cnf.jkt`
- Check `jti` against nonce cache for replay protection
- Clock skew tolerance: configurable, default 60 seconds past, 5 seconds future
- ONE verification pipeline for ALL requests -- no branching on actor type

### FR-7: RAR Operation Scope Verification at Brain Resource Server

- Extract requested operation from API route and request body as a `brain_action`
- Match against access token `authorization_details`
- Type must be "brain_action" (always)
- Action and resource must match exactly
- Request constraints must be within authorized bounds
- Tokens without authorization_details are rejected (no scope fallback)

### FR-8: Audit Trail (Uniform)

- Every intent submission, evaluation, routing decision, human consent action, token issuance, and Brain resource server verification is logged
- Audit entries link to intent_id and include DPoP JWK thumbprint
- Security events (thumbprint mismatch, replay detection) are logged at elevated severity
- Human and agent operations use the same audit format -- `brain_action` entries

## Non-Functional Requirements

### NFR-1: Performance

- DPoP key pair generation: < 50ms per session (agent sandbox or browser)
- DPoP proof construction: < 5ms per request
- Token endpoint response time: < 200ms (excluding intent evaluation, which is async)
- Bridge exchange response time: < 300ms (includes Better Auth session validation)
- DPoP proof verification at Brain resource server: < 10ms per request
- Nonce cache lookup: < 1ms

### NFR-2: Security

- Private keys never leave the actor's runtime boundary (enforced by runtime isolation)
- DPoP proofs are single-use (replay protection via nonce cache)
- Access tokens have short TTL (300 seconds default, configurable)
- Clock skew tolerance is configurable but defaults to conservative values
- All verification failures produce specific, actionable error codes (not generic 401)
- Session cookies cannot access the Brain (enforced at Brain boundary)
- No scope fallback at the Brain (enforced at Brain boundary)

### NFR-3: Reliability

- Authorizer Agent timeout (30 seconds) falls back to APPROVE with risk_score=50, routing to veto_window (existing behavior preserved)
- Nonce cache entries auto-expire (no unbounded memory growth)
- Token re-issuance is allowed within intent expiry window if original token expires before use
- Better Auth session expiry during Bridge exchange returns clear error with redirect guidance

### NFR-4: Compatibility

- TypeScript/Bun runtime
- SurrealDB SCHEMAFULL mode for all new tables
- Functional paradigm: pure functions, pipeline composition, no classes
- No `null` in domain data -- use `undefined` via optional properties
- No module-level mutable singletons -- nonce cache and key stores injected via dependency injection
- Better Auth IdP integration preserved for human login -- Custom AS is a separate service/layer

## Dependencies

| Dependency | Status | Impact |
|---|---|---|
| Better Auth IdP (existing) | Available | Human login, session management, Proxy IdP for Bridge |
| Intent Node (existing) | Available | Evaluation pipeline, risk router |
| Unified Identity (existing) | Available | Identity resolution for token claims |
| Authority System (existing) | Available | Permission matrix for intent lifecycle actions |
| jose library (existing) | Available | JWT signing/verification, JWKS, JWK thumbprint |
| SurrealDB (existing) | Available | Schema extension for DPoP binding fields, brain_action types |
| Web Crypto API (Bun built-in) | Available | ES256 key generation for agent runtimes |
| Web Crypto API (browser) | Available | ES256 key generation for dashboard Bridge |

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Clock skew between actor runtimes and Brain resource server | Medium | Medium | Configurable tolerance window, NTP requirement, actionable error messages |
| Nonce cache memory growth for ALL requests (not just writes) | Medium | Medium | Time-windowed set with aggressive TTLs, dependency-injected per instance |
| DPoP complexity discouraging agent and dashboard developers | Medium | High | Client libraries abstract key management and proof construction for both agent and browser |
| Bridge latency perceived by dashboard users | Medium | Medium | Token caching for common read patterns (60s TTL), batch token requests for dashboard initialization |
| Browser DPoP key management compatibility | Low | Medium | Web Crypto API is widely supported; fallback is not possible -- security is non-negotiable |
| Better Auth plugin compatibility with Bridge endpoint | Low | High | Spike to validate Custom AS can validate Better Auth sessions via API |
| Developer resistance to "session cookie cannot access API" paradigm | High | Medium | Clear documentation, client library that makes Bridge transparent, emphasize security model |
