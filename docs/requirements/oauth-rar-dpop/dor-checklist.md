# Definition of Ready Checklist: OAuth RAR + DPoP (Sovereign Hybrid Model)

---

## US-001: DPoP Key Pair Lifecycle for All Actors

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "Neither can prove that a token presentation came from the same entity the token was issued to" -- uses domain terms (sender-constraining, proof-of-possession). Covers both agents and humans. |
| 2. User/persona with specific characteristics | PASS | Agent "Kira" (code_agent) in E2B sandbox, Marcus Santos (dashboard user) in browser, workspace "Lusaka" |
| 3. 3+ domain examples with real data | PASS | 3 examples: agent session key gen, browser session key gen (Bridge), key destruction on termination |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 4 scenarios covering agent gen, browser gen, reuse, and destruction |
| 5. AC derived from UAT | PASS | 4 acceptance criteria derived from the 4 scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 1-2 days estimate, 4 scenarios |
| 7. Technical notes identify constraints | PASS | Web Crypto API (Bun + browser), RFC 7638, DI for key store, non-extractable browser keys |
| 8. Dependencies resolved or tracked | PASS | No blocking dependencies -- uses built-in Web Crypto in both environments |

**DoR Status: PASSED**

---

## US-002: Intent Submission with DPoP Thumbprint Binding

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "ALL Brain operations -- including reads -- now require intent submission" -- clear statement of the uniform model |
| 2. User/persona with specific characteristics | PASS | Agent "Kira" (code_agent), Agent "Atlas" (architect), workspace "Lusaka" |
| 3. 3+ domain examples with real data | PASS | 3 examples: invoice intent, graph read intent, deployment intent -- all with brain_action format |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 3 scenarios covering submission, auto-approve for reads, and missing thumbprint rejection |
| 5. AC derived from UAT | PASS | 3 acceptance criteria derived from the 3 scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 1-2 days estimate, 3 scenarios |
| 7. Technical notes identify constraints | PASS | Schema migration for dpop_jwk_thumbprint (required, not optional), brain_action type requirement |
| 8. Dependencies resolved or tracked | PASS | Depends on US-001 (key pair generation) -- tracked |

**DoR Status: PASSED**

---

## US-003: RAR Token Issuance with DPoP Binding (Custom AS)

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "No mechanism to issue a token that is both narrowly scoped to the specific authorized brain_action AND cryptographically bound to Kira's key pair" |
| 2. User/persona with specific characteristics | PASS | Agent "Kira" (code_agent), workspace "Lusaka", specific intent IDs (read-001, inv-002, inv-003, inv-004) |
| 3. 3+ domain examples with real data | PASS | 3 examples: auto-approved read token, human-approved write token, key mismatch rejection |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 4 scenarios: happy path issuance, unauthorized intent, key mismatch, re-issuance |
| 5. AC derived from UAT | PASS | 5 acceptance criteria derived from the 4 scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2-3 days estimate, 4 scenarios -- at upper bound but acceptable for complexity |
| 7. Technical notes identify constraints | PASS | Custom AS (separate from Better Auth), DPoP proof validation, RFC 7638, dependency on US-002 |
| 8. Dependencies resolved or tracked | PASS | Depends on US-002 -- tracked. Custom AS architecture is a new component. |

**DoR Status: PASSED**

---

## US-004: Human-Readable RAR Consent for Veto Window

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "Marcus cannot distinguish 'create a $50 invoice' from 'create a $50,000 invoice' because both fall under the same scope" |
| 2. User/persona with specific characteristics | PASS | Marcus Santos, workspace owner "Lusaka", reviewing agent "Kira"'s brain_action authorization requests |
| 3. 3+ domain examples with real data | PASS | 3 examples: Stripe invoice consent, constrained approval, auto-approved read (never shown to human) |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 3 scenarios: structured display, constrain, veto |
| 5. AC derived from UAT | PASS | 3 acceptance criteria derived from the 3 scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2 days estimate, 3 scenarios |
| 7. Technical notes identify constraints | PASS | brain_action-to-display mapping, constrain modifies constraints, existing veto mechanism |
| 8. Dependencies resolved or tracked | PASS | Depends on existing intent notification system -- available |

**DoR Status: PASSED**

---

## US-005: DPoP Proof Verification at Brain Resource Server

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "session cookies from Better Auth can access the Brain directly, meaning XSS attacks grant full Brain access" -- clear statement of the session-separation problem |
| 2. User/persona with specific characteristics | PASS | Agent "Kira" (legitimate), attacker "Eve" (adversary), Marcus (session cookie test), Brain resource server as system actor |
| 3. 3+ domain examples with real data | PASS | 3 examples: valid agent request, stolen token, session cookie rejected |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 6 scenarios: valid, stolen, session rejected, Bearer rejected, replayed, clock skew |
| 5. AC derived from UAT | PASS | 6 acceptance criteria derived from the 6 scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2-3 days estimate, 6 scenarios -- at upper bound for complexity |
| 7. Technical notes identify constraints | PASS | Replaces existing authenticateMcpRequest, nonce cache via DI, jose library, no Bearer fallback |
| 8. Dependencies resolved or tracked | PASS | Depends on US-003 (tokens with cnf.jkt) -- tracked |

**DoR Status: PASSED**

---

## US-006: RAR Operation Scope Verification at Brain Resource Server

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "A token with task:write can create, update, delete, or complete any task. No mechanism to verify the token covers the specific operation being performed." |
| 2. User/persona with specific characteristics | PASS | Agent "Kira" performing Brain operations, Marcus Santos as constraining authority |
| 3. 3+ domain examples with real data | PASS | 3 examples: matching operation, operation mismatch, constraint exceeded |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 3 scenarios: matching, mismatch, constraint exceeded |
| 5. AC derived from UAT | PASS | 4 acceptance criteria derived from the 3 scenarios + brain_action type requirement |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 1-2 days estimate, 3 scenarios |
| 7. Technical notes identify constraints | PASS | Route-to-action mapping produces brain_action, configurable per integration, dependency on US-003 and US-005 |
| 8. Dependencies resolved or tracked | PASS | Depends on US-003, US-005 -- tracked |

**DoR Status: PASSED**

---

## US-007: Bridge Token Exchange for Human Operators

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "If the session is hijacked (XSS, CSRF, cookie theft), the attacker has full access to the knowledge graph. There is no separation between authentication and authorization." |
| 2. User/persona with specific characteristics | PASS | Marcus Santos (human operator), dashboard client (browser app), Custom AS (system) |
| 3. 3+ domain examples with real data | PASS | 3 examples: dashboard graph read via Bridge, dashboard task creation via Bridge, expired session rejection |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 4 scenarios: Bridge read, expired session, session cookie rejection, high-risk veto window |
| 5. AC derived from UAT | PASS | 4 acceptance criteria derived from the 4 scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2-3 days estimate, 4 scenarios |
| 7. Technical notes identify constraints | PASS | Bridge endpoint path, Custom AS validates via Better Auth API, token caching for reads, dependencies |
| 8. Dependencies resolved or tracked | PASS | Depends on US-001, US-003, US-005 -- tracked |

**DoR Status: PASSED**

---

## US-008: Managed Agent Identity Registration

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear, domain language | PASS | "There is no formal registration linking the agent's identity to the human who created it, making it impossible to trace agent authorization back to a responsible human." |
| 2. User/persona with specific characteristics | PASS | Marcus Santos (creating agent), Agent "Kira" (managed agent), Custom AS (system) |
| 3. 3+ domain examples with real data | PASS | 3 examples: Marcus creates Kira, token checked against managing human, identity revocation |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS | 3 scenarios: identity creation, managing human validation, deactivated human blocks tokens |
| 5. AC derived from UAT | PASS | 3 acceptance criteria derived from the 3 scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 1-2 days estimate, 3 scenarios |
| 7. Technical notes identify constraints | PASS | Schema migration for managed_by field, Better Auth API for human status check |
| 8. Dependencies resolved or tracked | PASS | Depends on US-007 (Bridge for dashboard agent creation) -- tracked |

**DoR Status: PASSED**

---

## Summary

| Story | DoR Status | Scenarios | Estimated Days | Dependencies |
|---|---|---|---|---|
| US-001: DPoP Key Pair Lifecycle (All Actors) | PASSED | 4 | 1-2 | None |
| US-002: Intent DPoP Binding (All Operations) | PASSED | 3 | 1-2 | US-001 |
| US-003: RAR Token Issuance (Custom AS) | PASSED | 4 | 2-3 | US-002 |
| US-004: RAR Consent Rendering | PASSED | 3 | 2 | Existing intent system |
| US-005: DPoP Verification (Brain Boundary) | PASSED | 6 | 2-3 | US-003 |
| US-006: RAR Scope Verification (Brain) | PASSED | 3 | 1-2 | US-003, US-005 |
| US-007: Bridge Token Exchange | PASSED | 4 | 2-3 | US-001, US-003, US-005 |
| US-008: Managed Agent Identity | PASSED | 3 | 1-2 | US-007 |

**All 8 stories pass the 8-item DoR gate.** Total estimated effort: 12-19 days.

### Recommended Implementation Order

```
US-001 (key lifecycle -- agent + browser)
  |
  v
US-002 (intent binding -- all operations) -----> US-004 (consent rendering, parallel)
  |
  v
US-003 (token issuance -- Custom AS)
  |
  v
US-005 (DPoP verification -- Brain boundary)
  |
  +--> US-006 (RAR scope verification, parallel)
  |
  +--> US-007 (Bridge token exchange, parallel)
        |
        v
        US-008 (managed agent identity)
```

Critical path: US-001 -> US-002 -> US-003 -> US-005 -> US-007 -> US-008 (9-15 days)
Parallel: US-004 (after US-002), US-006 (after US-005)

### Design Decisions

| Decision | Rationale |
|---|---|
| No Bearer path to Brain, no scope fallback | Existing MCP auth (Bearer+scopes) is replaced wholesale. When the Custom AS is deployed, old tokens are immediately invalid. No coexistence period. |
| Uniform brain_action for ALL operations | Classification is a vulnerability -- no tier boundary between consequential and non-consequential |
| Better Auth sessions cannot access Brain | Bridge required -- session cookies alone cannot touch the knowledge graph |
| 8 stories, 12-19 days | US-001 through US-008 cover key lifecycle, intent binding, token issuance, consent, verification, scope matching, Bridge, and managed identity |
