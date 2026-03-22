# Test Scenarios -- Tool Registry UI

## Scenario Inventory

Total: 56 scenarios
- Walking skeletons: 4 (7%)
- Happy path: 22 (39%)
- Error path: 24 (43%)
- Security: 6 (11%)

Error path ratio: 43% (target: >= 40%) -- PASS

## Story Coverage Map

### US-UI-01: Page Shell and Navigation
| AC | Scenario | File |
|----|----------|------|
| AC-01d | Empty provider list returned | milestone-1, "returns empty list when no providers exist" |
| AC-01d | Empty tool list returned | milestone-3, "returns empty list when no tools exist" |
| AC-01d | Empty account list returned | milestone-5, "returns empty list when member has no connected accounts" |

Note: Route registration (AC-01a), sidebar (AC-01b), tab rendering (AC-01c), keyboard nav (AC-01e) are UI-only concerns tested at component level, not HTTP acceptance level.

### US-UI-02: Browse Tools
| AC | Scenario | File |
|----|----------|------|
| AC-02a | Tools grouped by toolkit with counts | walking-skeleton #3, milestone-3 "grouped by toolkit" |
| AC-02b | Tool row has all display fields | milestone-3 "complete data shape for UI rendering" |
| AC-02a | Grant count per tool | milestone-3 "includes grant count per tool" |
| AC-02a | Governance count per tool | milestone-3 "includes governance count per tool" |
| AC-02f | Empty tool list | milestone-3 "returns empty list when no tools exist" |

Note: Client-side filters (AC-02c/d/e) and color badges (AC-02g) are UI-only.

### US-UI-03: Register Credential Provider
| AC | Scenario | File |
|----|----------|------|
| AC-03b | OAuth2 provider with all fields | milestone-1 "OAuth2 provider with all OAuth-specific fields" |
| AC-03c | API key provider with base fields | milestone-1 "API key provider with only base fields" |
| AC-03c | Bearer token provider | milestone-1 "bearer token provider" |
| AC-03c | Basic auth provider | milestone-1 "basic auth provider" |
| AC-03e | Duplicate name rejection | milestone-1 "rejects duplicate provider name" |
| AC-03f | Provider appears in list after creation | walking-skeleton #1 |
| AC-03g | Missing name rejected | milestone-1 "rejects missing required name field" |
| AC-03g | Missing display_name rejected | milestone-1 "rejects missing required display_name" |
| AC-03g | Invalid auth_method rejected | milestone-1 "rejects invalid auth_method" |
| AC-03g | Malformed JSON rejected | milestone-1 "rejects malformed JSON body" |
| AC-03d | Client secret never in response | milestone-1 "client_secret is not returned" (x2) |

### US-UI-04: Connect Account (Static)
| AC | Scenario | File |
|----|----------|------|
| AC-04a | API key connection | milestone-2 "connects account with API key" |
| AC-04b | Basic auth connection | milestone-2 "connects account with basic auth" |
| AC-04c | Bearer token connection | milestone-2 "connects account with bearer token" |
| AC-04e | Empty API key rejected | milestone-2 "rejects empty API key" |
| AC-04e | Empty basic auth rejected | milestone-2 "rejects empty basic auth" |
| AC-04e | Empty bearer rejected | milestone-2 "rejects empty bearer token" |
| AC-04f | Account appears active | walking-skeleton #2 |
| | Nonexistent provider rejected | milestone-2 "rejects connection to nonexistent provider" |
| | Duplicate connection rejected | milestone-2 "rejects duplicate connection" |
| | API key not in response | milestone-2 "API key is not returned" |
| | Credentials not in list response | milestone-2 "credentials are not returned in account list" |

### US-UI-05: Grant Tool Access
| AC | Scenario | File |
|----|----------|------|
| AC-05b | Grant with rate limit | milestone-4 "grants access with rate limit" |
| AC-05b | Grant without rate limit | milestone-4 "grants access without rate limit" |
| AC-05c | Grant count updates | milestone-4 "grant_count updates after new grants" |
| AC-05d | Duplicate grant rejected | milestone-4 "rejects duplicate grant" |
| AC-05e | Grant list with details | milestone-4 "sees grant in list" |
| | Multiple identities granted | milestone-4 "multiple identities can be granted" |
| | Nonexistent identity rejected | milestone-4 "rejects grant to nonexistent identity" |
| | Nonexistent tool rejected | milestone-4 "rejects grant to nonexistent tool" |
| | Missing identity_id rejected | milestone-4 "rejects grant without identity_id" |

### US-UI-06: OAuth2 Flow
| AC | Scenario | File |
|----|----------|------|
| AC-06a/b | Redirect URL returned | milestone-2 "returns redirect URL with state parameter" |

Note: Full OAuth2 browser redirect (AC-06c/d/e) cannot be tested in acceptance suite. Tested at integration level with mock IdP.

### US-UI-07: Connected Accounts Dashboard
| AC | Scenario | File |
|----|----------|------|
| AC-07a | Mixed-status account list | milestone-5 "lists accounts with mixed statuses" |
| AC-07e/f | Revoke active account | milestone-5 "revokes active account" |
| AC-07e | Credentials deleted on revoke | milestone-5 "permanently deletes encrypted credentials" |
| AC-07g | Empty accounts state | milestone-5 "returns empty list" |
| AC-07h | Reconnect after revocation | milestone-5 "reconnect after revocation" |
| | Identity isolation | milestone-5 "only returns accounts for authenticated identity" |
| | Nonexistent account revoke | milestone-5 "returns 404 when revoking nonexistent" |
| | Idempotent revocation | milestone-5 "revocation is idempotent" |

### US-UI-08: Tool Governance
| AC | Scenario | File |
|----|----------|------|
| AC-08d | Attach policy with condition + limits | milestone-6 "attaches policy with condition" |
| AC-08d | Attach rate-limit-only policy | milestone-6 "attaches policy with rate limit only" |
| AC-08a | Governance indicator (count > 0) | milestone-6 "governance_count" |
| AC-08e | Governance details in tool detail | milestone-6 "attaches policy" (detail verification) |
| AC-08b | Only active policies allowed | milestone-6 "rejects attachment of deprecated policy" |
| | Multiple policies on same tool | milestone-6 "multiple policies can be attached" |
| | Nonexistent policy rejected | milestone-6 "rejects attachment of nonexistent policy" |
| | Nonexistent tool rejected | milestone-6 "rejects attachment to nonexistent tool" |
| | Missing policy_id rejected | milestone-6 "rejects attachment without policy_id" |

## Implementation Sequence

1. Walking skeleton (all 4 scenarios enabled)
2. Milestone 1: Provider CRUD (11 scenarios)
3. Milestone 2: Account Connection (11 scenarios)
4. Milestone 3: Tool Browsing (9 scenarios)
5. Milestone 4: Access Grants (9 scenarios)
6. Milestone 5: Account Dashboard (8 scenarios)
7. Milestone 6: Tool Governance (9 scenarios)
