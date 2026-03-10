# Test Scenarios: OAuth RAR+DPoP Sovereign Auth Model

## Scenario Inventory

Total scenarios: 56 (2 walking skeletons + 54 focused scenarios)
Error/edge path ratio: 30/56 = 54% (exceeds 40% target)

---

## Walking Skeletons (2)

| ID | Scenario | Traces | File |
|----|----------|--------|------|
| WS-1 | Agent generates key pair, submits intent, receives token, and accesses Brain | US-001, US-002, US-003, US-005, US-006 | walking-skeleton.test.ts |
| WS-2 | Human logs in, exchanges session for DPoP token, and accesses Brain | US-001, US-005, US-006, US-007 | walking-skeleton.test.ts |

---

## Milestone 1: DPoP Key Pair + Intent Submission (10 scenarios)

Traces: US-001, US-002

### US-001: DPoP Key Pair Lifecycle (4 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M1-K1 | Actor generates ES256 key pair with computable thumbprint | Happy | Active |
| M1-K2 | Key pair generation completes within 50ms | Boundary | Skip |
| M1-K3 | Thumbprint is deterministic for the same public key | Happy | Skip |
| M1-K4 | Different key pairs produce different thumbprints | Happy | Skip |
| M1-K5 | Key pair is reusable across multiple operations | Happy | Skip |

### US-002: Intent Submission with DPoP Binding (6 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M1-I1 | Intent with brain_action and thumbprint is accepted | Happy | Skip |
| M1-I2 | Intent without thumbprint is rejected (400) | Error | Skip |
| M1-I3 | Intent without authorization_details is rejected (400) | Error | Skip |
| M1-I4 | Intent with wrong authorization_details type is rejected | Error | Skip |
| M1-I5 | Low-risk read intent auto-approves | Happy | Skip |
| M1-I6 | Intent preserves authorization_details with constraints | Happy | Skip |

---

## Milestone 2: Token Issuance (9 scenarios)

Traces: US-003

### Happy path (3 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M2-T1 | Authorized intent receives DPoP-bound access token | Happy | Skip |
| M2-T2 | Issued token contains sender binding and authorization details | Happy | Skip |
| M2-T3 | Token has maximum TTL of 300 seconds | Boundary | Skip |

### Error path (5 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M2-E1 | Token rejected when intent not in authorized status | Error | Skip |
| M2-E2 | Token rejected when intent has been vetoed | Error | Skip |
| M2-E3 | Token rejected when DPoP proof key doesn't match intent | Error | Skip |
| M2-E4 | Token rejected when authorization_details don't match | Error | Skip |
| M2-E5 | Token rejected for non-existent intent | Error | Skip |
| M2-E6 | Token rejected when DPoP proof is missing | Error | Skip |

### Re-issuance (1 scenario)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M2-R1 | Agent can request new token after expiry | Happy | Skip |

---

## Milestone 3: Brain Verification (14 scenarios)

Traces: US-005, US-006

### US-005: DPoP Proof Verification (11 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M3-A1 | Brain rejects Bearer tokens with dpop_required | Error | Skip |
| M3-A2 | Brain rejects session cookies on DPoP endpoints | Error | Skip |
| M3-A3 | Brain rejects requests with no authentication | Error | Skip |
| M3-V1 | Valid DPoP proof grants access | Happy | Skip |
| M3-V2 | Brain rejects proof with wrong HTTP method | Error | Skip |
| M3-V3 | Brain rejects proof with wrong target URI | Error | Skip |
| M3-V4 | Brain rejects proof signed with different key | Error | Skip |
| M3-V5 | Brain rejects replayed DPoP proof (same jti) | Error | Skip |
| M3-V6 | Brain rejects proof 120s in the past (beyond 60s tolerance) | Edge | Skip |
| M3-V7 | Brain rejects proof 30s in the future (beyond 5s tolerance) | Edge | Skip |
| M3-V8 | Brain rejects proof with missing JWK header | Error | Skip |

### US-006: RAR Operation Scope Verification (3 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M3-S1 | Matching action and resource succeeds | Happy | Skip |
| M3-S2 | Mismatched action returns authorization_details_mismatch | Error | Skip |
| M3-S3 | Exceeding constraints returns authorization_params_exceeded | Error | Skip |

### Uniform pipeline (1 scenario)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M3-U1 | Agent and human tokens verified through same pipeline | Happy | Skip |

---

## Milestone 4: Bridge Exchange (9 scenarios)

Traces: US-007

### Happy path (4 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M4-B1 | Human exchanges session for DPoP token (low-risk read) | Happy | Skip |
| M4-B2 | Bridge token contains correct sender binding | Happy | Skip |
| M4-B3 | Low-risk read auto-approves without veto window | Happy | Skip |
| M4-B4 | Bridge token can access Brain endpoints | Happy | Skip |

### Veto window (1 scenario)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M4-V1 | High-risk write triggers evaluation before issuance | Happy | Skip |

### Error path (4 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M4-E1 | Expired/invalid session rejected (401) | Error | Skip |
| M4-E2 | Bridge without any session rejected (401) | Error | Skip |
| M4-E3 | Bridge without DPoP proof rejected | Error | Skip |
| M4-E4 | Bridge without authorization_details rejected (400) | Error | Skip |

---

## Milestone 5: Consent + Identity (8 scenarios)

Traces: US-004, US-008

### US-004: Human-Readable Consent (5 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M5-C1 | brain_action rendered in human-readable form | Happy | Skip |
| M5-C2 | Human approves pending intent | Happy | Skip |
| M5-C3 | Human vetoes pending intent with reason | Happy | Skip |
| M5-C4 | Human constrains to tighter bounds | Happy | Skip |
| M5-C5 | Constrain rejects looser bounds | Error | Skip |

### US-008: Managed Agent Identity (4 scenarios)

| ID | Scenario | Type | Status |
|----|----------|------|--------|
| M5-I1 | Agent identity records managed_by relationship | Happy | Skip |
| M5-I2 | Managed agent blocked when managing human inactive | Error | Skip |
| M5-I3 | Revoked agent cannot submit new intents | Error | Skip |
| M5-I4 | Revoked agent tokens rejected at Brain boundary | Error | Skip |

---

## Coverage Matrix: User Story -> Scenarios

| User Story | Happy | Error | Edge | Total |
|-----------|-------|-------|------|-------|
| US-001 | 4 | 0 | 1 | 5 |
| US-002 | 3 | 3 | 0 | 6 |
| US-003 | 4 | 6 | 0 | 10 |
| US-004 | 3 | 1 | 0 | 4 |
| US-005 | 2 | 7 | 2 | 11 |
| US-006 | 1 | 2 | 0 | 3 |
| US-007 | 5 | 4 | 0 | 9 |
| US-008 | 1 | 3 | 0 | 4 |

**Totals**: 26 happy + 30 error/edge = 56 scenarios (54% error coverage)
