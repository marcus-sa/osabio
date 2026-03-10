# User Stories: OAuth RAR + DPoP (Sovereign Hybrid Model)

---

## US-001: DPoP Key Pair Lifecycle for All Actors

### Problem

Agent "Kira" (code_agent in E2B sandbox, workspace "Lusaka") and human operator Marcus Santos (dashboard user) currently have no sender-constraining mechanism. Kira authenticates with a long-lived Bearer token that any interceptor can replay. Marcus authenticates with a session cookie that any XSS attack can steal. Neither can prove that a token presentation came from the same entity the token was issued to.

### Who

- AI agent runtime | Running in isolated sandbox (E2B) | Needs cryptographic identity for proof-of-possession
- Human operator | Using dashboard in browser | Needs browser-based cryptographic identity for Bridge tokens

### Solution

All actor runtimes (agent sandboxes, browser dashboard, CLI tools) generate and manage an ES256 key pair per session, computing a JWK thumbprint that serves as the binding identifier for all DPoP-bound tokens in that session.

### Domain Examples

#### 1: Agent Session Start Key Generation
Agent "Kira" starts a new session in workspace "Lusaka" for task T-4821 (Q1 invoicing for Acme Corp). During session initialization, the runtime generates an ES256 key pair. The private key is held in memory. The JWK thumbprint `NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs` is computed from the public key. Generation completes in under 50ms.

#### 2: Browser Session Key Generation (Bridge)
Marcus Santos opens the Brain dashboard in Chrome. The dashboard client library generates an ES256 key pair via Web Crypto API. The private key is held in browser memory (CryptoKey object, non-extractable). The thumbprint `BrowserKey-marcus-abc123` is computed. This key pair is used for all Bridge token exchanges during this browser session.

#### 3: Key Destruction on Runtime Termination
Agent "Kira" completes task T-4821 and the E2B sandbox shuts down. The in-memory private key is destroyed with the process. Marcus closes the dashboard tab -- the browser CryptoKey is garbage collected. Any tokens previously issued with `cnf.jkt` bound to these key pairs become unusable.

### UAT Scenarios (BDD)

#### Scenario: Agent key pair generated at session start
Given agent "Kira" starts a new session in workspace "Lusaka"
When the agent runtime initializes DPoP key management
Then an ES256 key pair is generated within 50ms
And the private key is stored in memory only (not persisted to disk)
And the JWK thumbprint is computed from the public key via RFC 7638

#### Scenario: Browser key pair generated for dashboard session
Given Marcus Santos opens the Brain dashboard
When the dashboard client library initializes
Then an ES256 key pair is generated via Web Crypto API
And the private key is non-extractable (CryptoKey)
And the JWK thumbprint is computed for Bridge token exchanges

#### Scenario: Key pair reused across multiple operations in same session
Given agent "Kira" has an active session with DPoP key pair (thumbprint "NzbLsXh8...")
When "Kira" submits a second intent in the same session
Then the same dpop_jwk_thumbprint "NzbLsXh8..." is used
And no new key pair is generated

#### Scenario: Key material destroyed on session end
Given agent "Kira" has an active DPoP key pair
When the agent sandbox terminates
Then the private key is no longer accessible
And DPoP proofs cannot be constructed for previously issued tokens

### Acceptance Criteria

- [ ] ES256 key pair generated per actor session (agent sandbox, browser session, CLI process)
- [ ] Key generation completes within 50ms
- [ ] Private key stored in memory only, never persisted or transmitted
- [ ] Browser keys use Web Crypto API with non-extractable flag
- [ ] JWK thumbprint computed via RFC 7638 and available for intent/Bridge submissions
- [ ] Key pair reused for all operations within the same session

### Technical Notes

- Agent: Web Crypto API (available in Bun) for ES256 key generation
- Browser: Web Crypto API with `extractable: false` for non-extractable private keys
- JWK thumbprint computation follows RFC 7638 (SHA-256 of canonical JWK)
- Key store is dependency-injected (not module-level singleton) per actor session
- Traces to Job 1 (Actor Obtaining a Brain Operation Token) and Job 4 (Bridge)

---

## US-002: Intent Submission with DPoP Thumbprint Binding

### Problem

Agent "Kira" submits intents describing exactly what it wants to do, but the resulting OAuth token has no binding to the agent's identity. If the token is intercepted between intent authorization and operation execution, any entity can use it. Additionally, ALL Brain operations -- including reads -- now require intent submission.

### Who

- AI agent runtime | Submitting Brain operation intents | Needs to pre-register cryptographic binding
- Dashboard client | Requesting Bridge tokens | Needs to include DPoP binding

### Solution

The intent submission endpoint requires a `dpop_jwk_thumbprint` field for ALL Brain operations, linking the intent to the actor's DPoP key pair before any token is issued.

### Domain Examples

#### 1: Invoice Intent with DPoP Binding
Agent "Kira" submits an intent to create a Stripe invoice for Acme Corp ($2,400). The submission includes `dpop_jwk_thumbprint: "NzbLsXh8uDCcd..."` and `authorization_details: [{ type: "brain_action", action: "create", resource: "invoice", constraints: { provider: "stripe", customer: "cus_acme_corp", amount: 240000 } }]`. The Authorizer Agent evaluates the Rich Intent Object.

#### 2: Graph Read Intent with DPoP Binding
Agent "Kira" submits an intent to read the project graph. The submission includes `authorization_details: [{ type: "brain_action", action: "read", resource: "knowledge_graph", constraints: { project: "lusaka", depth: 2 } }]` with DPoP thumbprint. The Authorizer Agent auto-approves (read, low risk).

#### 3: Deployment Intent with DPoP Binding
Agent "Atlas" (architect type) submits an intent to deploy service "payment-gateway" to staging with `authorization_details: [{ type: "brain_action", action: "deploy", resource: "service", constraints: { service: "payment-gateway", environment: "staging" } }]` and DPoP thumbprint.

### UAT Scenarios (BDD)

#### Scenario: Intent submitted with DPoP thumbprint for Brain operation
Given agent "Kira" has a DPoP key pair with thumbprint "NzbLsXh8uDCcd..."
And "Kira" needs to create a Stripe invoice for Acme Corp, amount $2,400
When "Kira" submits the intent with brain_action authorization_details and dpop_jwk_thumbprint
Then the intent is created with status "draft"
And the dpop_jwk_thumbprint is stored in the intent record
And the Authorizer Agent evaluates the Rich Intent Object
And the intent transitions through draft -> pending_auth -> (routing decision)

#### Scenario: Read intent auto-approved by Authorizer Agent
Given agent "Kira" submits an intent to read the project graph
And the brain_action is: type=brain_action, action=read, resource=knowledge_graph
When the Authorizer Agent evaluates the intent
Then the risk_score is 10 (low risk read operation)
And the intent is auto-approved without human review

#### Scenario: Intent rejected for missing DPoP thumbprint
Given agent "Kira" submits an intent for any Brain operation
And the submission does not include dpop_jwk_thumbprint
When the intent endpoint validates the submission
Then the request is rejected with 400 "dpop_jwk_thumbprint required for all Brain operations"

### Acceptance Criteria

- [ ] Intent submission requires `dpop_jwk_thumbprint` for ALL Brain operations (no exceptions)
- [ ] Intent submission requires `authorization_details` with type "brain_action"
- [ ] Thumbprint stored in intent record for later token issuance verification
- [ ] Authorizer Agent evaluates brain_action Rich Intent Objects (never scopes)
- [ ] Low-risk operations (reads) auto-approve through the pipeline

### Technical Notes

- Schema migration: add `dpop_jwk_thumbprint` field to `intent` table (type: `string`, required)
- Schema migration: update `authorization_details` to require `type: "brain_action"`
- Existing evaluation pipeline functions preserved
- Traces to Job 1 (Actor Obtaining a Brain Operation Token)

---

## US-003: RAR Token Issuance with DPoP Binding (Custom AS)

### Problem

Agent "Kira" has an authorized intent. But the current token system issues Bearer tokens with broad scopes. There is no mechanism to issue a token that is both narrowly scoped to the specific authorized brain_action AND cryptographically bound to Kira's key pair.

### Who

- AI agent runtime | Intent authorized, needs a Brain token | Wants narrowly-scoped, sender-constrained credential
- Dashboard client | Bridge exchange authorized | Wants a Brain token for dashboard operations

### Solution

A Custom AS token endpoint with grant type `urn:brain:intent-authorization` that validates the authorized intent, verifies the DPoP proof, and issues a DPoP-bound access token with brain_action `authorization_details` and `cnf.jkt` claims.

### Domain Examples

#### 1: Token Issued for Auto-Approved Read Intent
Agent "Kira" submits an intent for a graph read (risk_score=10, auto-approved). Kira immediately requests a token with `grant_type=urn:brain:intent-authorization`, `intent_id=read-001`, and a DPoP proof. The Custom AS issues a 300-second DPoP-bound token with `authorization_details: [{ type: "brain_action", action: "read", resource: "knowledge_graph", constraints: { project: "Lusaka" } }]`.

#### 2: Token Issued After Human Approval
Agent "Kira" submitted an intent for a $2,400 Stripe invoice (risk_score=45, veto window). Marcus Santos approved it. Kira requests a token. The Custom AS verifies Marcus's approval and issues a token with brain_action authorization_details matching the approved intent.

#### 3: Token Request Rejected -- Key Mismatch
Agent "Kira" submitted an intent with thumbprint "thumb-AAA" but the DPoP proof in the token request is signed with a different key (thumbprint "thumb-BBB"). The Custom AS rejects with 401 "dpop_key_mismatch."

### UAT Scenarios (BDD)

#### Scenario: DPoP-bound token issued for authorized intent
Given intent "read-001" is in status "authorized" with brain_action for graph read
And intent "read-001" has dpop_jwk_thumbprint "NzbLsXh8..."
When agent "Kira" requests a token with grant_type "urn:brain:intent-authorization"
And the DPoP proof is signed with the key matching thumbprint "NzbLsXh8..."
Then the Custom AS issues a DPoP-bound access token
And the token contains cnf.jkt "NzbLsXh8..."
And the token contains authorization_details with type "brain_action"
And the token contains urn:brain:intent_id "read-001"
And the token expires in 300 seconds

#### Scenario: Token request rejected for unauthorized intent
Given intent "inv-002" is in status "pending_veto" (not yet authorized)
When agent "Kira" requests a token for intent "inv-002"
Then the Custom AS rejects with 403 "intent_not_authorized"

#### Scenario: Token request rejected for DPoP key mismatch
Given intent "inv-003" has dpop_jwk_thumbprint "thumb-AAA"
And intent "inv-003" is in status "authorized"
When the DPoP proof is signed with a key having thumbprint "thumb-BBB"
Then the Custom AS rejects with 401 "dpop_key_mismatch"

#### Scenario: Token re-issuance for expired token
Given intent "inv-004" is in status "authorized" and has not expired
And the previously issued token for this intent has expired
When agent "Kira" requests a new token with a fresh DPoP proof
Then the Custom AS issues a new DPoP-bound access token with fresh TTL

### Acceptance Criteria

- [ ] Custom AS accepts `grant_type=urn:brain:intent-authorization`
- [ ] Token includes `cnf.jkt` claim matching the DPoP proof key thumbprint
- [ ] Token includes `authorization_details` with `type: "brain_action"` matching the authorized intent
- [ ] Token includes `urn:brain:intent_id` linking to the authorizing intent
- [ ] Token TTL is 300 seconds (configurable)
- [ ] Token rejected if intent is not in "authorized" status
- [ ] Token rejected if DPoP proof key does not match intent dpop_jwk_thumbprint

### Technical Notes

- Custom AS is a separate authorization layer from Better Auth
- DPoP proof validation: structure (typ, alg, jwk), signature, claims (htm, htu, iat, jti)
- JWK thumbprint computation uses the same RFC 7638 algorithm as key generation
- Dependency: US-002 (intent with DPoP thumbprint)
- Traces to Job 1 (Actor Obtaining a Brain Operation Token)

---

## US-004: Human-Readable RAR Consent for Veto Window

### Problem

Marcus Santos (workspace owner, "Lusaka") receives veto window notifications when agent "Kira" requests authorization for medium-risk actions. Currently, the notification shows generic OAuth scopes. Marcus cannot distinguish "create a $50 invoice" from "create a $50,000 invoice" because both fall under the same scope. He either rubber-stamps everything or blocks everything.

### Who

- Workspace owner | Reviewing agent authorization requests | Needs structured, understandable brain_action presentation

### Solution

Transform RAR `brain_action` authorization_details into human-readable consent presentation with approve, constrain, and veto actions.

### Domain Examples

#### 1: Stripe Invoice Consent
Agent "Kira" requests authorization to create a Stripe invoice. Marcus sees: "Operation: Create Invoice | Resource: Stripe Integration | Customer: Acme Corp | Amount: $2,400.00 USD | Description: Q1 2026 consulting". Not raw JSON.

#### 2: Constrained Approval
Marcus reviews Kira's invoice request and decides $2,400 is too much. He clicks "Constrain...", sets maximum amount to $2,000, and approves. The constrained `authorization_details` flows into the token.

#### 3: Graph Read Consent (auto-approved, never shown)
Agent "Kira" requests a graph read. The Authorizer Agent auto-approves (risk_score=10). Marcus never sees this -- only high-risk actions trigger human consent. But the read still uses RAR internally.

### UAT Scenarios (BDD)

#### Scenario: Consent notification shows structured brain_action
Given agent "Kira" submitted an intent for Stripe invoice creation ($2,400, Acme Corp)
And the intent is in "pending_veto" status with risk_score 45
When Marcus Santos opens the consent notification
Then Marcus sees "Create Invoice" (not "invoices.create")
And Marcus sees "Amount: $2,400.00 USD" (not "240000")
And Marcus sees "Customer: Acme Corp" (not "cus_acme_corp")
And Marcus sees the risk score and Authorizer Agent reasoning
And Marcus sees the veto window expiry time

#### Scenario: Human constrains authorization
Given Marcus is reviewing Kira's $2,400 Stripe invoice intent
When Marcus clicks "Constrain..." and sets max amount to $2,000
And Marcus clicks "Approve with constraints"
Then the intent authorization_details constraints are updated with amount cap 200000
And the intent status transitions to "authorized"
And the constraint is recorded in the audit trail

#### Scenario: Human vetoes with reason
Given Marcus is reviewing Kira's intent
When Marcus clicks "Veto" and enters reason "Not authorized for this customer"
Then the intent status transitions to "vetoed"
And the veto reason is stored in the vetoed_by relation
And agent "Kira" receives the veto reason in the error response

### Acceptance Criteria

- [ ] brain_action authorization_details rendered in human-readable form (not raw JSON)
- [ ] Provider-specific formatting (e.g., Stripe amounts in dollars, not cents)
- [ ] Risk score, Authorizer Agent reasoning, and veto window expiry displayed
- [ ] Approve, Constrain, and Veto actions available
- [ ] Constrain produces modified authorization_details with tighter bounds
- [ ] Veto requires a reason, stored in vetoed_by relation

### Technical Notes

- Rendering layer: brain_action-to-display mapping (e.g., "create" + "invoice" -> "Create Invoice")
- Constrain modifies authorization_details constraints (e.g., capping amount)
- Existing veto window mechanism (30 min, risk-router.ts) preserved
- Dependency: existing intent notification system
- Traces to Job 2 (Human Owner Authorizing/Constraining Agent Actions)

---

## US-005: DPoP Proof Verification at Brain Resource Server

### Problem

The Brain API resource server validates Bearer tokens by checking JWT signature and claims. Any entity holding the token can use it. If agent "Kira"'s token appears in a log file or is intercepted, an attacker can replay it. Worse, session cookies from Better Auth can access the Brain directly, meaning XSS attacks grant full Brain access.

### Who

- Brain resource server | Receiving ALL actor requests | Needs to verify the presenter is the token owner, reject non-DPoP requests

### Solution

Replace the existing Bearer-based authentication at the Brain boundary with a DPoP-only verification pipeline. The Brain rejects Bearer tokens, session cookies, and scope-only tokens. Every request must present a DPoP-bound token with brain_action authorization_details.

### Domain Examples

#### 1: Valid Agent DPoP Request
Agent "Kira" sends POST to create a Stripe invoice with `Authorization: DPoP <token>` and `DPoP: <proof>`. The Brain validates everything. All checks pass -- the invoice is created.

#### 2: Stolen Token Rejection
Attacker "Eve" intercepts Kira's access token. Eve constructs a DPoP proof with her own key. The Brain computes Eve's thumbprint and compares it to the token's `cnf.jkt`. Mismatch -- rejected with 401. Security event logged.

#### 3: Session Cookie Rejected
A dashboard component sends a request with Marcus's session cookie directly to the Brain API. The Brain rejects with 401 "dpop_required" -- session cookies cannot access the Brain.

### UAT Scenarios (BDD)

#### Scenario: Valid DPoP-bound request succeeds
Given agent "Kira" holds a DPoP-bound token with cnf.jkt "thumb-KIRA"
And "Kira" constructs a fresh DPoP proof (unique jti, current iat, correct htm/htu)
And the proof is signed with Kira's private key (thumbprint "thumb-KIRA")
When "Kira" sends the request with DPoP token and proof
Then the Brain verifies the access token
And verifies the DPoP proof structure and signature
And confirms the computed thumbprint matches cnf.jkt
And confirms the jti is not in the nonce cache
And the request is processed successfully

#### Scenario: Stolen token with wrong key rejected
Given attacker "Eve" holds Kira's access token (cnf.jkt = "thumb-KIRA")
And "Eve" constructs a DPoP proof signed with her own key (thumbprint "thumb-EVE")
When "Eve" sends the request
Then the Brain computes thumbprint "thumb-EVE"
And "thumb-EVE" does not match cnf.jkt "thumb-KIRA"
And the request is rejected with 401 "dpop_binding_mismatch"
And a security event is logged

#### Scenario: Session cookie rejected at Brain boundary
Given Marcus has a valid Better Auth session cookie
When a request is sent to the Brain with only the session cookie
Then the Brain rejects with 401 "dpop_required"
And no scope-based authorization is attempted

#### Scenario: Bearer token rejected at Brain boundary
Given any actor holds a Bearer token (traditional scopes)
When the actor sends a request with "Authorization: Bearer <token>"
Then the Brain rejects with 401 "dpop_required"
And the error states "Brain does not accept Bearer tokens"

#### Scenario: Replayed DPoP proof rejected
Given a request with jti "nonce-001" was previously processed
When the same DPoP proof (jti "nonce-001") is presented again
Then the Brain finds "nonce-001" in the nonce cache
And the request is rejected with 401 "dpop_proof_reused"

#### Scenario: Clock-skewed DPoP proof rejected
Given any actor constructs a DPoP proof with iat 90 seconds in the past
And the acceptable clock skew window is 60 seconds
When the actor sends the request
Then the Brain rejects with 401 "dpop_proof_expired"
And the error suggests clock synchronization

### Acceptance Criteria

- [ ] Brain rejects Bearer tokens with 401 "dpop_required"
- [ ] Brain rejects session cookies with 401 "dpop_required"
- [ ] DPoP proof validated: structure (typ, alg, jwk), signature, claims (htm, htu, iat, jti)
- [ ] JWK thumbprint computed and matched against cnf.jkt
- [ ] Nonce cache rejects reused jti values
- [ ] Clock skew tolerance configurable (default 60s past, 5s future)
- [ ] Specific error codes for each failure mode
- [ ] Security events logged for thumbprint mismatch
- [ ] Same verification pipeline for agent and human (Bridge) tokens

### Technical Notes

- Replaces existing `authenticateMcpRequest` Bearer pipeline at Brain boundary
- Nonce cache: time-windowed set, dependency-injected (not module-level singleton)
- Uses `jose` library for DPoP proof JWT validation and JWK thumbprint computation
- Dependency: US-003 (tokens with cnf.jkt claim)
- Traces to Job 3 (Brain Resource Server Verifying Uniform Authorization)

---

## US-006: RAR Operation Scope Verification at Brain Resource Server

### Problem

The Brain resource server currently authorizes requests based on coarse-grained scopes (`task:write`, `graph:read`). A token with `task:write` can create, update, delete, or complete any task. There is no mechanism to verify that the token's scope covers the specific operation being performed.

### Who

- Brain resource server | Receiving operation-specific requests | Needs to verify the token's brain_action covers this exact operation

### Solution

Verify the access token's `brain_action` authorization_details against the actual operation being requested, matching type, action, resource, and constraint bounds.

### Domain Examples

#### 1: Matching Operation Authorized
Agent "Kira" sends POST to create a Stripe invoice. The token's `authorization_details` specifies `{ type: "brain_action", action: "create", resource: "invoice", constraints: { provider: "stripe", customer: "cus_acme_corp", amount: 240000 } }`. The Brain confirms all fields match. Request proceeds.

#### 2: Operation Mismatch Rejected
Agent "Kira" sends DELETE using a token authorized for `action: "create", resource: "invoice"`. The Brain rejects with 403.

#### 3: Constraint Exceeded
Marcus constrained Kira's authorization to max $2,000. Token has `constraints.amount: 200000`. Kira requests amount 240000. Brain rejects with 403.

### UAT Scenarios (BDD)

#### Scenario: Matching operation and constraints authorized
Given a DPoP-bound token with brain_action: create invoice (amount: 240000)
When the request is POST with body amount 240000
Then the Brain matches type, action, resource, and constraints
And the request proceeds

#### Scenario: Operation mismatch rejected
Given a DPoP-bound token with brain_action: create invoice
When the request is DELETE /api/brain/integrations/stripe/invoices/inv_123
Then the Brain rejects with 403 "authorization_details_mismatch"

#### Scenario: Constraint exceeded
Given a DPoP-bound token with brain_action constraints.amount cap 200000
When the request body contains amount 240000
Then the Brain rejects with 403 "authorization_params_exceeded"

### Acceptance Criteria

- [ ] Type must be "brain_action" (always -- no scope fallback)
- [ ] Action and resource matched exactly against authorization_details
- [ ] Request constraints verified within authorized bounds
- [ ] Amount constraints compared as numeric (requested <= authorized)
- [ ] Specific error codes: authorization_details_mismatch, authorization_params_exceeded

### Technical Notes

- Operation extraction from route: mapping from API path + method to brain_action
- Route-to-action mapping is configurable per integration endpoint
- Dependency: US-003 (tokens with authorization_details claim), US-005 (DPoP verification)
- Traces to Job 3 (Brain Resource Server Verifying Uniform Authorization)

---

## US-007: Bridge Token Exchange for Human Operators

### Problem

Marcus Santos logs into the Brain dashboard via Better Auth and currently accesses the Brain API directly with his session cookie. If the session is hijacked (XSS, CSRF, cookie theft), the attacker has full access to the knowledge graph. There is no separation between "I am a logged-in human" (authentication) and "I am authorized to perform this Brain operation" (authorization).

### Who

- Human operator | Logged into dashboard | Needs to access the Brain with the same structured authorization as agents
- Dashboard client | Browser application | Needs transparent session-to-token exchange

### Solution

A Bridge endpoint that exchanges a Better Auth session + DPoP proof for a DPoP-bound RAR token with brain_action authorization_details, making the human's Brain access indistinguishable from an agent's.

### Domain Examples

#### 1: Dashboard Graph Read via Bridge
Marcus clicks "View Project Lusaka" in the dashboard. The client library constructs `brain_action: { type: "brain_action", action: "read", resource: "knowledge_graph", constraints: { project: "lusaka", depth: 2 } }`, generates a DPoP proof, and sends a Bridge exchange request with the session cookie. The Custom AS validates the session, auto-approves the read, and issues a DPoP-bound token. The dashboard uses the token to read from the Brain.

#### 2: Dashboard Task Creation via Bridge
Marcus creates a new task via the dashboard. The client library constructs `brain_action: { type: "brain_action", action: "create", resource: "task", constraints: { project: "lusaka", title: "Review Q1 invoicing" } }`. The Custom AS evaluates risk (medium), routes to auto-approve. Token issued. Task created.

#### 3: Bridge Rejects Expired Session
Marcus's session expires while the dashboard is open. The client library attempts a Bridge exchange. The Custom AS calls Better Auth, finds the session expired, and returns 401 "session_expired". The dashboard redirects Marcus to login.

### UAT Scenarios (BDD)

#### Scenario: Human obtains Brain token via Bridge for graph read
Given Marcus Santos is logged into the dashboard with a valid Better Auth session
And the dashboard client has a DPoP key pair
When Marcus clicks "View Project Lusaka"
Then the dashboard client constructs a brain_action for read/knowledge_graph
And sends a Bridge exchange request with session cookie + DPoP proof
And the Custom AS validates the Better Auth session is active
And the Authorizer Agent auto-approves the read operation
And a DPoP-bound token is issued with brain_action authorization_details
And the dashboard uses the token to read from the Brain

#### Scenario: Bridge rejects expired Better Auth session
Given Marcus's Better Auth session has expired
When the dashboard client attempts a Bridge exchange
Then the Custom AS returns 401 "session_expired"
And the dashboard redirects to the Better Auth login page

#### Scenario: Session cookie directly rejected at Brain
Given Marcus has a valid Better Auth session cookie
When any request is sent to the Brain with only the session cookie
Then the Brain returns 401 "dpop_required"
And the error guides the client to use the Bridge

#### Scenario: High-risk Bridge operation triggers veto window
Given Marcus attempts to delete a project via the dashboard
And the brain_action is: type=brain_action, action=delete, resource=project
When the Bridge exchange evaluates the intent
Then the Authorizer Agent assigns risk_score 80
And the operation enters veto_window for another workspace admin to review

### Acceptance Criteria

- [ ] Bridge endpoint accepts Better Auth session + DPoP proof + authorization_details
- [ ] Custom AS validates Better Auth session is active before issuing token
- [ ] Issued token has brain_action authorization_details (same format as agent tokens)
- [ ] Issued token has cnf.jkt bound to the browser's DPoP key
- [ ] Low-risk reads auto-approve without human consent
- [ ] High-risk operations follow the same veto window path as agents
- [ ] Expired Better Auth sessions return 401 with login redirect guidance
- [ ] Session cookie rejected at Brain boundary with 401 "dpop_required"

### Technical Notes

- Bridge endpoint: `POST /api/auth/bridge/exchange`
- Custom AS validates session via Better Auth API call (not by directly reading cookies)
- Token caching: dashboard client caches read tokens for 60 seconds to reduce Bridge round-trips
- Dependency: US-001 (browser key pair), US-003 (token issuance), US-005 (Brain DPoP verification)
- Traces to Job 4 (Human Operator Exchanging Session for Brain Token)

---

## US-008: Managed Agent Identity Registration

### Problem

When a human operator creates an AI agent in the Brain dashboard, the agent needs an identity that the Custom AS recognizes. Currently, agent identities are created ad-hoc. There is no formal registration linking the agent's identity to the human who created it, making it impossible to trace agent authorization back to a responsible human.

### Who

- Human operator | Creating agents in the dashboard | Needs to formally register agent identities with the Custom AS
- Custom Authorization Server | Issuing tokens to agents | Needs to verify the managing human's relationship

### Solution

When a human creates a "Managed Agent" in the dashboard, the Custom AS records an identity node with a `managed_by` relationship to the human's Better Auth userId, enabling authorization chains.

### Domain Examples

#### 1: Marcus Creates Agent Kira
Marcus clicks "Create Agent" in the dashboard, naming it "Kira" with type "code_agent". The Custom AS creates `identity:kira-agent-001` with `managed_by: userId:marcus-456`. When Kira requests tokens, the Custom AS can verify Marcus's account is still active.

#### 2: Agent Token Checked Against Managing Human
Agent "Kira" requests a token for a high-risk operation. The Custom AS checks that the managing human (Marcus, userId:marcus-456) has an active Better Auth account and workspace membership. If Marcus's account is deactivated, Kira's token request is rejected.

#### 3: Agent Identity Revocation
Marcus removes agent "Kira" from the workspace. The Custom AS marks `identity:kira-agent-001` as revoked. All future token requests from Kira are rejected.

### UAT Scenarios (BDD)

#### Scenario: Human creates managed agent identity
Given Marcus Santos is logged into the dashboard
When Marcus creates a new agent named "Kira" with type "code_agent"
Then the Custom AS creates identity:kira-agent-001
And records managed_by relationship to Marcus's Better Auth userId
And the agent identity is available for token requests

#### Scenario: Token request validates managing human is active
Given agent "Kira" is managed_by Marcus (userId:marcus-456)
When "Kira" requests a Brain token
Then the Custom AS verifies Marcus's Better Auth account is active
And the token is issued (if all other checks pass)

#### Scenario: Deactivated human blocks agent tokens
Given Marcus's Better Auth account has been deactivated
When agent "Kira" (managed_by Marcus) requests a Brain token
Then the Custom AS rejects with 403 "managing_human_inactive"

### Acceptance Criteria

- [ ] Agent identity creation records managed_by relationship to human userId
- [ ] Custom AS can validate managing human's Better Auth account status
- [ ] Agent token requests are blocked if managing human is inactive
- [ ] Agent identity can be revoked by managing human

### Technical Notes

- Schema migration: `identity` table gains `managed_by` field (record link to Better Auth user)
- Custom AS queries Better Auth API to check human account status
- Dependency: US-007 (Bridge, for dashboard-based agent creation)
- Traces to Job 4 (Bridge) and BR-8 (Better Auth as Proxy IdP)
