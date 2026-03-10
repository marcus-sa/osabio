# Journey: Brain Resource Server Verification (Sovereign Hybrid Model)

## Overview

The complete flow when the Brain resource server receives ANY request -- from an agent sandbox or a human dashboard client -- bearing a DPoP-bound access token. The Brain has ONE verification pipeline: DPoP proof-of-possession + RAR brain_action scope. No scope fallback. No Bearer path. No distinction between human and agent at the Brain boundary.

## Actors

- **Any Actor** (agent "Kira" or human "Marcus" via Bridge -- the token presenter)
- **Brain Resource Server** (the single verification pipeline for ALL Brain operations)
- **Nonce Cache** (time-windowed set for DPoP replay protection)

## Emotional Arc

```
Start: Vigilant          Middle: Methodical           End: Assured
  |                          |                           |
  v                          v                           v
"Every request is       "Each check has a          "All checks passed --
 potentially hostile"    clear pass/fail"           request is legitimate"
```

## Verification Pipeline

```
+------------------------------------------------------------------+
|  INCOMING REQUEST (from ANY actor -- agent or human)              |
|                                                                    |
|  POST /api/brain/integrations/stripe/invoices                      |
|  Authorization: DPoP eyJhbGciOiJFUzI1NiIs...  (access token)      |
|  DPoP: eyJ0eXAiOiJkcG9wK2p3dCIs...            (proof JWT)         |
|  Content-Type: application/json                                    |
|  { customer: "cus_acme_corp", amount: 240000, currency: "usd" }   |
|                                                                    |
|  NOTE: No "Authorization: Bearer" path exists to the Brain.        |
|  NOTE: No session cookie path exists to the Brain.                 |
|  NOTE: No scope-based authorization exists at the Brain.           |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 1: Header Extraction                                        |
|  Emotion: Vigilant -- "parse before trusting"                      |
+------------------------------------------------------------------+
|                                                                    |
|  Extract from request:                                             |
|    1. Authorization header -> token_type + access_token            |
|       - MUST be "DPoP <token>"                                     |
|       - "Bearer <token>" -> 401 "dpop_required"                    |
|       - Session cookie only -> 401 "dpop_required"                 |
|       - Missing header -> 401 "dpop_required"                      |
|    2. DPoP header -> dpop_proof (JWT)                              |
|       - MUST be present                                            |
|       - Missing DPoP header -> 401 "missing_dpop_proof"            |
|                                                                    |
|  Fail-fast: missing or malformed headers -> 401 immediately        |
|  No fallback to scopes. No fallback to Bearer. One path only.      |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 2: Access Token Validation                                  |
|  Emotion: Methodical -- "standard JWT verification"                |
+------------------------------------------------------------------+
|                                                                    |
|  Validate the access token JWT:                                    |
|    1. Signature verification via JWKS (Custom AS signing key)      |
|    2. Issuer: "https://brain.example/api/auth"                     |
|    3. Audience: "https://brain.example"                            |
|    4. Expiration: exp > now (with clock tolerance)                 |
|    5. Required claims present: sub, cnf.jkt,                       |
|       authorization_details, urn:brain:workspace                   |
|                                                                    |
|  Extract for downstream checks:                                    |
|    ${cnf_jkt} = token.cnf.jkt                                      |
|    ${authorization_details} = token.authorization_details           |
|    ${workspace_id} = token["urn:brain:workspace"]                   |
|    ${intent_id} = token["urn:brain:intent_id"]                     |
|                                                                    |
|  Tokens MUST contain authorization_details with type               |
|  "brain_action". Tokens without authorization_details are          |
|  rejected -- no scope fallback.                                    |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 3: DPoP Proof Validation                                    |
|  Emotion: Vigilant -- "this is the sender-constraining check"      |
+------------------------------------------------------------------+
|                                                                    |
|  Validate the DPoP proof JWT:                                      |
|                                                                    |
|  3a. Structure check:                                              |
|    - Header typ MUST be "dpop+jwt"                                 |
|    - Header alg MUST be an approved asymmetric algorithm (ES256)   |
|    - Header jwk MUST contain the public key                        |
|                                                                    |
|  3b. Signature verification:                                       |
|    - Verify proof signature using the embedded JWK public key      |
|                                                                    |
|  3c. Claims validation:                                            |
|    - htm (HTTP method) MUST match the request method ("POST")      |
|    - htu (HTTP URI) MUST match the request URI                     |
|    - iat (issued at) MUST be within acceptable window              |
|      (e.g., now - 60s <= iat <= now + 5s for clock skew)           |
|    - jti (unique identifier) MUST be present                       |
|                                                                    |
|  3d. Replay protection:                                            |
|    - Check jti against the nonce cache                             |
|    - If jti already seen -> 401 "dpop_proof_reused"                |
|    - If jti is fresh -> add to nonce cache with TTL                |
|                                                                    |
|  +------------------------------------------------------------+   |
|  | Nonce Cache (time-windowed set)                             |   |
|  |------------------------------------------------------------|   |
|  | jti: "abc123" | expires: now + 5min                         |   |
|  | jti: "def456" | expires: now + 4min                         |   |
|  | jti: "ghi789" | expires: now + 3min                         |   |
|  | (auto-prune entries older than window)                      |   |
|  +------------------------------------------------------------+   |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 4: Sender Binding Verification                              |
|  Emotion: Critical -- "the core proof-of-possession check"         |
+------------------------------------------------------------------+
|                                                                    |
|  Compute the JWK thumbprint (RFC 7638) of the public key           |
|  embedded in the DPoP proof header.                                |
|                                                                    |
|  Compare:                                                          |
|    computed_thumbprint  ==  ${cnf_jkt} from access token           |
|                                                                    |
|  +------------------------------------------------------------+   |
|  |  DPoP Proof JWK                Access Token cnf.jkt         |   |
|  |  (public key in proof)         (thumbprint in token)        |   |
|  |                                                             |   |
|  |  thumbprint(proof.jwk) ----?=---- token.cnf.jkt             |   |
|  |                                                             |   |
|  |  MATCH    -> presenter IS the entity the token was          |   |
|  |              issued to (same key pair)                      |   |
|  |  MISMATCH -> presenter is NOT the token owner               |   |
|  |              (stolen/intercepted token) -> 401              |   |
|  +------------------------------------------------------------+   |
|                                                                    |
|  This check is identical for agents and humans. The Brain          |
|  does not know or care whether the presenter is human or agent.    |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 5: Operation Scope Verification (RAR brain_action)          |
|  Emotion: Precise -- "does this token cover this exact operation?" |
+------------------------------------------------------------------+
|                                                                    |
|  Extract the requested operation from the API route + body:        |
|    requested_action = {                                            |
|      type: "brain_action",                                         |
|      action: "create",                                             |
|      resource: "invoice",                                          |
|      constraints: {                                                |
|        provider: "stripe",                                         |
|        customer: "cus_acme_corp",                                  |
|        amount: 240000                                              |
|      }                                                             |
|    }                                                               |
|                                                                    |
|  Match against ${authorization_details} from the access token:     |
|                                                                    |
|  5a. Type match: authorization_details[].type == "brain_action"    |
|  5b. Action match: authorization_details[].action == "create"      |
|  5c. Resource match: authorization_details[].resource == "invoice" |
|  5d. Constraints match: requested constraints are within the       |
|      bounds of authorized constraints                              |
|      - amount <= authorized amount (if constrained by human)       |
|      - provider matches authorized provider                        |
|                                                                    |
|  +------------------------------------------------------------+   |
|  | Scope Matching Rules:                                       |   |
|  |                                                             |   |
|  | TYPE: must be "brain_action" (always)                       |   |
|  | ACTION: must match exactly (read, create, update, delete)   |   |
|  | RESOURCE: must match exactly (knowledge_graph, invoice, ...) |   |
|  | CONSTRAINTS: requested values must be within authorized      |   |
|  |              bounds                                         |   |
|  +------------------------------------------------------------+   |
|                                                                    |
|  Mismatch -> 403 "authorization_details_mismatch"                  |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 6: Identity and Workspace Resolution                        |
|  Emotion: Methodical -- "resolve who is acting and where"          |
+------------------------------------------------------------------+
|                                                                    |
|  From the validated access token claims:                           |
|    1. Resolve identity from sub claim                              |
|       - Could be "identity:kira-agent-001" (agent)                 |
|       - Could be "identity:marcus-human-001" (human via Bridge)    |
|    2. Verify workspace membership                                  |
|       (existing flow using member_of relation)                     |
|    3. Extract actor_type from identity record                      |
|                                                                    |
|  The Brain does not differentiate verification logic based on      |
|  actor type. All actors are equal at the Brain boundary.           |
|                                                                    |
+------------------------------|-------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|  STEP 7: Operation Execution                                      |
|  Emotion: Assured -- "all checks passed, safe to proceed"          |
+------------------------------------------------------------------+
|                                                                    |
|  All verification steps passed:                                    |
|    [x] Access token valid (signature, expiry, claims)              |
|    [x] authorization_details contains brain_action (not scopes)    |
|    [x] DPoP proof valid (structure, signature, freshness)          |
|    [x] Sender binding verified (thumbprint match)                  |
|    [x] Replay protection checked (jti unique)                      |
|    [x] Operation scope verified (brain_action match)               |
|    [x] Identity and workspace resolved                             |
|                                                                    |
|  Execute the requested operation with the verified context:        |
|    - Forward to integration (Stripe, deployment, etc.)             |
|    - Or execute Brain graph operation directly                     |
|    - Log the operation with intent_id for audit trail              |
|    - Update intent status: executing -> completed (or failed)      |
|                                                                    |
|  Response: 201 Created                                             |
|  { invoice_id: "inv_abc123", status: "open", ... }                 |
|                                                                    |
+------------------------------------------------------------------+
```

## Error Paths

### E1: Missing Authorization Header / Session Cookie Only
```
Request has no Authorization header (or only a session cookie)
-> 401 { error: "dpop_required",
         detail: "Brain operations require DPoP-bound RAR tokens.
                  Session cookies cannot access the Brain.
                  Use the Bridge to exchange your session for a Brain token." }
```

### E2: Bearer Scheme Rejected
```
Request has Authorization: Bearer <any-token>
-> 401 { error: "dpop_required",
         detail: "Brain does not accept Bearer tokens.
                  All operations require DPoP-bound tokens with
                  brain_action authorization_details." }
No distinction between DPoP-bound tokens sent as Bearer vs plain Bearer.
The Brain only speaks DPoP.
```

### E3: Missing DPoP Proof Header
```
Request has Authorization: DPoP <token> but no DPoP header
-> 401 { error: "missing_dpop_proof",
         detail: "DPoP-bound token requires DPoP proof header" }
```

### E4: Clock Skew Rejection
```
DPoP proof iat is 90 seconds in the past (window is 60 seconds)
-> 401 { error: "dpop_proof_expired",
         detail: "DPoP proof iat is outside acceptable window.
                  Ensure client clock is synchronized (NTP)" }
```

### E5: Replay Attack Detected
```
DPoP proof jti "abc123" has already been seen in the nonce cache
-> 401 { error: "dpop_proof_reused",
         detail: "DPoP proof nonce has already been used.
                  Each request must use a unique jti" }
```

### E6: Thumbprint Mismatch (Stolen Token)
```
DPoP proof signed by key with thumbprint "thumb-BBB"
Access token cnf.jkt is "thumb-AAA"
-> 401 { error: "dpop_binding_mismatch",
         detail: "DPoP proof key does not match token binding.
                  Token may have been intercepted" }
-> Security event logged with both thumbprints for forensic analysis
```

### E7: Operation Scope Mismatch
```
Token authorization_details: action=create, resource=invoice
Request: DELETE /api/brain/integrations/stripe/invoices/inv_123
-> 403 { error: "authorization_details_mismatch",
         detail: "Token authorizes 'create invoice'
                  but request is 'delete invoice'" }
```

### E8: Constraint Violation
```
Token authorization_details: constraints.amount <= 200000 (constrained by human)
Request body: amount = 240000
-> 403 { error: "authorization_params_exceeded",
         detail: "Requested amount 240000 exceeds authorized cap 200000" }
```

### E9: Missing authorization_details
```
Token does not contain authorization_details claim
(e.g., a token without brain_action authorization_details)
-> 401 { error: "missing_authorization_details",
         detail: "Brain tokens must contain brain_action
                  authorization_details. No scope fallback." }
```
