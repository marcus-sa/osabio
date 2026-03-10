# Journey: Actor Token Acquisition (Sovereign Hybrid Model)

## Overview

The complete flow from any actor (AI agent or human operator) recognizing it needs authorization for a Brain operation, through the Custom Authorization Server (with optional human consent for high-risk actions), to receiving a DPoP-bound access token with `brain_action` authorization_details. Includes the Bridge path for human operators exchanging Better Auth sessions.

## Actors

- **Agent Runtime** (e.g., code_agent "Kira" running in E2B sandbox within workspace "Lusaka")
- **Human Operator** (Marcus Santos, workspace owner -- via dashboard Bridge OR reviewing agent authorizations)
- **Custom Authorization Server** (Brain platform -- evaluates Rich Intent Objects, issues DPoP-bound RAR tokens)
- **Better Auth IdP** (identity provider for human login -- session/scopes for dashboard UI ONLY)

## Emotional Arc

```
Start: Purposeful     Middle: Transparent/Waiting     End: Confident
  |                        |                             |
  v                        v                             v
"I need to act         "I can see what's            "I hold exactly
 on the Brain"          happening and why"           the authority I need"
```

## Journey Flow: Agent Path

```
+------------------------------------------------------------------+
|  STEP 1: Intent Formation                                         |
|  Actor: Agent Runtime (Kira)                                      |
|  Emotion: Purposeful -- "I know what I need to do"                |
+------------------------------------------------------------------+
|                                                                    |
|  Agent identifies a Brain operation during task execution.         |
|  Constructs a brain_action intent from the task context.           |
|  ALL operations require this -- reads, writes, integrations.       |
|                                                                    |
|  brain_action:                                                     |
|    type: "brain_action"                                            |
|    action: "create"                                                |
|    resource: "invoice"                                             |
|    constraints:                                                    |
|      provider: "stripe"                                            |
|      customer: "cus_acme_corp"                                     |
|      amount: 240000          # $2,400.00 in cents                  |
|      currency: "usd"                                               |
|      description: "Q1 2026 consulting - Project Lusaka"            |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 2: DPoP Key Pair Generation                                 |
|  Actor: Agent Runtime (Kira)                                      |
|  Emotion: Methodical -- "generating my cryptographic identity"     |
+------------------------------------------------------------------+
|                                                                    |
|  IF no existing key pair for this agent session:                   |
|    Generate ES256 key pair within the sandbox                      |
|    Store private key in memory (never persisted, never exported)   |
|    Compute JWK thumbprint (RFC 7638) of the public key             |
|                                                                    |
|  Key pair lifecycle:                                               |
|    - Created once per agent session                                |
|    - Destroyed when sandbox terminates                             |
|    - Never leaves the sandbox boundary                             |
|                                                                    |
|  jwk_thumbprint: "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs"   |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 3: Intent Submission to Custom AS                           |
|  Actor: Agent Runtime (Kira) -> Custom Authorization Server       |
|  Emotion: Transparent -- "the system is evaluating my request"     |
+------------------------------------------------------------------+
|                                                                    |
|  POST /api/auth/intents                                            |
|  {                                                                 |
|    goal: "Invoice Acme Corp for Q1 consulting"                     |
|    reasoning: "Task T-4821 requires invoicing upon milestone..."   |
|    authorization_details: [{                                       |
|      type: "brain_action",                                         |
|      action: "create",                                             |
|      resource: "invoice",                                          |
|      constraints: {                                                |
|        provider: "stripe",                                         |
|        customer: "cus_acme_corp",                                  |
|        amount: 240000,                                             |
|        currency: "usd"                                             |
|      }                                                             |
|    }],                                                             |
|    dpop_jwk_thumbprint: "NzbLsXh8uDCcd-6MNwXF4W..."               |
|  }                                                                 |
|                                                                    |
|  Intent status: draft -> pending_auth                              |
|  Triggers evaluation pipeline:                                     |
|    1. Policy Gate (budget cap, action allowlist)                    |
|    2. Authorizer Agent (evaluates Rich Intent Object,              |
|       checks workspace state, never evaluates scopes)              |
|    3. Risk Router (auto_approve / veto_window / reject)            |
|    4. Status Update                                                |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                  +------------+------------+
                  |            |            |
                  v            v            v
        +-----------+  +-----------+  +-----------+
        | REJECTED  |  | VETO      |  | AUTO      |
        | risk=     |  | WINDOW    |  | APPROVE   |
        | reject    |  | risk>30   |  | risk<=30  |
        +-----------+  +-----------+  +-----------+
              |              |              |
              v              v              v
+------------------+  +--------------+  +------------------+
| STEP 3a: Reject  |  | STEP 4       |  | STEP 5           |
| Return error     |  | Human Review |  | Token Issuance   |
| Agent retries or |  | (see below)  |  | (skip to Step 5) |
| escalates        |  |              |  |                  |
+------------------+  +--------------+  +------------------+

+------------------------------------------------------------------+
|  STEP 4: Human Consent (veto_window path only)                    |
|  Actor: Marcus Santos (workspace owner)                           |
|  Emotion: Informed -- "I can see exactly what my agent wants"      |
+------------------------------------------------------------------+
|                                                                    |
|  Notification delivered (in-app / email / push):                   |
|                                                                    |
|  +------------------------------------------------------------+   |
|  | Agent "Kira" requests Brain authorization                 [!] |  |
|  |------------------------------------------------------------|   |
|  |                                                            |   |
|  | Operation: Create Invoice                                  |   |
|  | Resource: Stripe Integration                               |   |
|  | Customer: Acme Corp (cus_acme_corp)                        |   |
|  | Amount: $2,400.00 USD                                      |   |
|  | Description: Q1 2026 consulting - Project Lusaka           |   |
|  |                                                            |   |
|  | Risk Score: 45/100 (medium)                                |   |
|  | Authorizer: "Action is well-scoped to a single invoice     |   |
|  |   creation. Amount is within historical range for this      |   |
|  |   customer. No privilege escalation detected."              |   |
|  |                                                            |   |
|  | Veto window expires: 30 minutes (11:45 AM)                 |   |
|  |                                                            |   |
|  | [Approve]  [Constrain...]  [Veto]                          |   |
|  +------------------------------------------------------------+   |
|                                                                    |
|  If Approve -> intent status: authorized                           |
|  If Constrain -> modify authorization_details, then authorize      |
|  If Veto -> intent status: vetoed, reason logged                   |
|  If Timeout -> auto-authorize (medium risk accepted)               |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 5: RAR Token Request                                        |
|  Actor: Agent Runtime (Kira) -> Custom Authorization Server       |
|  Emotion: Expectant -- "my intent was approved, requesting token"  |
+------------------------------------------------------------------+
|                                                                    |
|  POST /api/auth/token                                              |
|  Content-Type: application/x-www-form-urlencoded                   |
|  DPoP: <signed DPoP proof JWT>                                     |
|                                                                    |
|  grant_type=urn:brain:intent-authorization                         |
|  &intent_id=intent:abc123                                          |
|  &authorization_details=[{                                         |
|      "type": "brain_action",                                       |
|      "action": "create",                                           |
|      "resource": "invoice",                                        |
|      "constraints": {                                              |
|        "provider": "stripe",                                       |
|        "customer": "cus_acme_corp",                                |
|        "amount": 240000,                                           |
|        "currency": "usd"                                           |
|      }                                                             |
|  }]                                                                |
|                                                                    |
|  DPoP proof JWT contains:                                          |
|    header: { typ: "dpop+jwt", alg: "ES256", jwk: <public key> }   |
|    payload: { jti: "unique-nonce", htm: "POST",                    |
|               htu: "https://brain.example/api/auth/token",         |
|               iat: 1710000000 }                                    |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 6: Token Issuance                                           |
|  Actor: Custom Authorization Server                               |
|  Emotion: (system step -- no human emotion)                        |
+------------------------------------------------------------------+
|                                                                    |
|  Custom AS validates:                                              |
|    1. Intent exists and status = authorized                        |
|    2. Intent requester matches token requestor identity             |
|    3. authorization_details matches intent brain_action             |
|    4. DPoP proof is valid (signature, jti unique, iat fresh)       |
|    5. DPoP JWK thumbprint matches intent dpop_jwk_thumbprint       |
|                                                                    |
|  Issues DPoP-bound access token:                                   |
|  {                                                                 |
|    "access_token": "<signed JWT>",                                 |
|    "token_type": "DPoP",                                          |
|    "expires_in": 300,                   # 5 minutes                |
|    "authorization_details": [{ ... }]   # echo back                |
|  }                                                                 |
|                                                                    |
|  Access token JWT claims:                                          |
|    sub: "identity:kira-agent-001"                                  |
|    aud: "https://brain.example"                                    |
|    iss: "https://brain.example/api/auth"                           |
|    cnf: { jkt: "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs" }   |
|    authorization_details: [{ type: "brain_action", ... }]          |
|    urn:brain:workspace: "lusaka-ws-001"                             |
|    urn:brain:intent_id: "abc123"                                   |
|    exp: <now + 300s>                                               |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 7: Brain Operation Execution                                |
|  Actor: Agent Runtime (Kira) -> Brain Resource Server             |
|  Emotion: Confident -- "I hold exactly the authority I need"       |
+------------------------------------------------------------------+
|                                                                    |
|  POST /api/brain/integrations/stripe/invoices                      |
|  Authorization: DPoP <access_token>                                |
|  DPoP: <fresh DPoP proof JWT for this request>                     |
|                                                                    |
|  The Brain resource server validates (SAME pipeline for ALL        |
|  actors -- agent or human):                                        |
|    1. Access token signature (JWKS)                                |
|    2. DPoP proof signature and freshness                           |
|    3. DPoP JWK thumbprint matches cnf.jkt in access token          |
|    4. authorization_details covers the requested operation          |
|    5. Request params match authorization_details constraints        |
|                                                                    |
|  NO scope check. NO Bearer fallback. RAR + DPoP only.              |
|                                                                    |
|  On success: 201 Created, invoice created                          |
|  Intent status: authorized -> executing -> completed               |
|                                                                    |
+------------------------------------------------------------------+
```

## Journey Flow: Human Bridge Path

```
+------------------------------------------------------------------+
|  BRIDGE STEP 1: Human Login via Better Auth                       |
|  Actor: Marcus Santos (dashboard)                                 |
|  Emotion: Seamless -- "I'm logging into my dashboard"              |
+------------------------------------------------------------------+
|                                                                    |
|  Standard Better Auth login (email/password, OAuth, SSO)           |
|  Receives session cookie with scopes (e.g., "dashboard:access")    |
|  Scopes mean: "I am a logged-in human." Nothing more.              |
|  This session CANNOT directly access the Brain.                    |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  BRIDGE STEP 2: Dashboard Requests Brain Operation                |
|  Actor: Dashboard Client (browser)                                |
|  Emotion: Transparent -- handled by client library                 |
+------------------------------------------------------------------+
|                                                                    |
|  User clicks "View Project Lusaka" in the dashboard.               |
|  Dashboard client library:                                         |
|    1. Constructs brain_action:                                     |
|       { type: "brain_action", action: "read",                      |
|         resource: "knowledge_graph",                               |
|         constraints: { project: "lusaka", depth: 2 } }            |
|    2. Generates/reuses DPoP key pair (browser session-scoped)      |
|    3. Sends token exchange request to Custom AS:                   |
|                                                                    |
|  POST /api/auth/bridge/exchange                                    |
|  Cookie: better_auth_session=<session_cookie>                      |
|  DPoP: <signed DPoP proof JWT>                                     |
|  {                                                                 |
|    authorization_details: [{                                       |
|      type: "brain_action",                                         |
|      action: "read",                                               |
|      resource: "knowledge_graph",                                  |
|      constraints: { project: "lusaka", depth: 2 }                  |
|    }]                                                              |
|  }                                                                 |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  BRIDGE STEP 3: Custom AS Validates and Issues Token              |
|  Actor: Custom Authorization Server                               |
|  Emotion: (system step)                                            |
+------------------------------------------------------------------+
|                                                                    |
|  Custom AS validates:                                              |
|    1. Better Auth session is still active (API call to Better Auth)|
|    2. Human identity resolved from session (userId -> identity)    |
|    3. Identity has workspace membership                            |
|    4. brain_action is consistent with workspace state              |
|       (Authorizer Agent evaluates the Rich Intent Object)          |
|    5. DPoP proof is valid                                          |
|                                                                    |
|  For low-risk reads: auto-approve (no human consent needed)        |
|  For high-risk writes: same veto_window path as agents             |
|                                                                    |
|  Issues DPoP-bound access token (same format as agent tokens):     |
|    sub: "identity:marcus-human-001"                                |
|    cnf: { jkt: "<browser_key_thumbprint>" }                        |
|    authorization_details: [{ type: "brain_action", ... }]          |
|    urn:brain:workspace: "lusaka-ws-001"                             |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  BRIDGE STEP 4: Dashboard Accesses Brain                          |
|  Actor: Dashboard Client -> Brain Resource Server                 |
|  Emotion: Seamless -- "the dashboard just works"                   |
+------------------------------------------------------------------+
|                                                                    |
|  GET /api/brain/projects/lusaka/graph                              |
|  Authorization: DPoP <access_token>                                |
|  DPoP: <fresh DPoP proof JWT>                                      |
|                                                                    |
|  Brain resource server runs the SAME verification pipeline:        |
|    DPoP proof + cnf.jkt + authorization_details matching           |
|                                                                    |
|  Marcus's request is indistinguishable from Kira's at the          |
|  Brain boundary. Human parity achieved.                            |
|                                                                    |
+------------------------------------------------------------------+
```

## Error Paths

### E1: Policy Gate Rejection
```
Intent submission -> Policy gate finds budget_limit exceeds workspace cap
-> Status: draft -> pending_auth -> vetoed (policy)
-> Actor receives: { error: "budget_exceeds_cap", detail: "Intent budget
   $2,400 USD exceeds workspace budget cap of $1,000 USD" }
-> Actor can: reduce amount and resubmit, or escalate to human
```

### E2: Authorizer Agent Timeout
```
Intent submission -> Authorizer Agent evaluation times out after 30 seconds
-> Fallback: APPROVE with risk_score=50, policy_only=true
-> Routes to veto_window (human review)
-> Actor waits for human decision or veto expiry
```

### E3: DPoP Key Mismatch
```
Token request -> DPoP proof JWK thumbprint does not match
   the dpop_jwk_thumbprint submitted with the intent
-> 401: { error: "dpop_key_mismatch", detail: "The DPoP proof was
   signed by a different key than the one registered with the intent" }
-> Actor must: re-submit intent with correct thumbprint
```

### E4: Token Expired Before Use
```
Actor obtains token (5-min TTL) but operation execution is delayed
-> Brain resource server rejects: 401 { error: "token_expired" }
-> Actor must: request a new token (intent still authorized,
   re-issuance allowed within intent expiry window)
```

### E5: Veto by Human
```
Intent enters veto_window -> Human reviews and clicks [Veto]
-> Status: pending_veto -> vetoed
-> Reason logged: "Amount too high for this customer relationship"
-> Actor receives: { error: "intent_vetoed", reason: "..." }
-> Actor can: modify params and create new intent, or report to user
```

### E6: Better Auth Session Expired (Bridge Path)
```
Human dashboard requests Bridge token exchange
-> Custom AS calls Better Auth to validate session
-> Session has expired (timeout, logout, revocation)
-> 401: { error: "session_expired", detail: "Better Auth session
   is no longer active. Please re-authenticate." }
-> Dashboard redirects to Better Auth login page
```

### E7: Session Cookie Rejected at Brain Boundary
```
Dashboard code sends request with session cookie directly to Brain
-> Brain resource server: no Authorization: DPoP header found
-> 401: { error: "dpop_required", detail: "Brain operations require
   DPoP-bound RAR tokens. Use the Bridge to exchange your session." }
-> No scope fallback. No Bearer path. Brain is DPoP+RAR only.
```
