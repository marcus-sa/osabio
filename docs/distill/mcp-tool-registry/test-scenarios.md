# Test Scenarios -- MCP Tool Registry (#178)

## Scenario Inventory

Total: 52 scenarios (29 happy path + 23 error/edge/boundary = 44% error coverage)

### 01 -- Tool Schema and Grants (US-3) [6 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 1.1 | Walking Skeleton: Admin grants agent access to registered tool | happy | FR-1, FR-2, AC-3 |
| 1.2 | Tool listing returns all tools in workspace | happy | FR-1 |
| 1.3 | Tool with rate-limited grant | happy | FR-2, AC-3 |
| 1.4 | Disabled tool excluded from effective toolset | edge | FR-3 |
| 1.5 | Multiple grants for one identity | happy | FR-3 |
| 1.6 | Identity with no grants has empty toolset | boundary | FR-3 |

### 02 -- Proxy Tool Injection (US-5) [4 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 2.1 | Walking Skeleton: Proxy injects granted tools into LLM request | happy | FR-3, FR-4, AC-5 |
| 2.2 | Runtime tools preserved alongside injected tools | happy | NFR-3 |
| 2.3 | No tools injected for identity with no grants | boundary | AC-5 |
| 2.4 | Runtime tool takes precedence over Brain tool with same name | edge | FR-4 |

### 03 -- Brain-Native Routing (US-6a) [3 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 3.1 | Walking Skeleton: Proxy intercepts and executes Brain-native tool call | happy | FR-5, AC-6 |
| 3.2 | Unknown tool call passed through to runtime | boundary | AC-6, NFR-3 |
| 3.3 | Brain-native tool execution error returns tool_result error | error | FR-5 |

### 04 -- Tool Call Tracing (US-9) [4 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 4.1 | Walking Skeleton: Brain-native tool call produces trace record | happy | FR-13, AC-9 |
| 4.2 | Trace records success outcome with duration | happy | FR-13, NFR-5 |
| 4.3 | Unknown tool calls do not produce trace records | boundary | AC-9 |
| 4.4 | Trace includes identity reference for auditability | happy | NFR-5 |

### 05 -- Credential Provider (US-1) [6 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 5.1 | Walking Skeleton: Admin registers OAuth2 credential provider | happy | FR-6, AC-1 |
| 5.2 | Register API key provider without OAuth fields | happy | FR-6, AC-1 |
| 5.3 | Register basic auth provider | happy | FR-6 |
| 5.4 | Reject duplicate provider name in workspace | error | AC-1 |
| 5.5 | Provider listing returns all workspace providers | happy | FR-6 |
| 5.6 | Client secret never returned as plaintext in API response | security | NFR-1 |

### 06 -- Account Connection (US-4) [6 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 6.1 | Walking Skeleton: User connects API key account | happy | FR-7, AC-4b |
| 6.2 | User connects basic auth account | happy | FR-7, AC-4b |
| 6.3 | OAuth2 initiation returns redirect URL with state | happy | FR-7, AC-4a |
| 6.4 | OAuth2 callback exchanges code for tokens | happy | FR-7, AC-4a |
| 6.5 | OAuth2 denied consent creates no account | error | AC-4a |
| 6.6 | Active connected account per identity+provider | edge | FR-7 |

### 07 -- Credential Brokerage (US-7) [9 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 7.1 | Walking Skeleton: API key credential injected | happy | FR-8, AC-7b |
| 7.2 | Basic auth credential injected as Authorization header | happy | FR-8, AC-7b |
| 7.3 | OAuth2 valid token injected as Bearer header | happy | FR-8, AC-7a |
| 7.4 | OAuth2 expired token triggers refresh before execution | happy | FR-9, AC-7a |
| 7.5 | Refresh failure marks account as expired | error | FR-9, AC-7a |
| 7.6 | Missing connected_account returns error | error | AC-7c |
| 7.7 | Revoked account returns error | error | AC-7c |
| 7.8 | @property: Credentials never leak to LLM context | security | NFR-1 |
| 7.9 | @property: All credential fields encrypted at rest | security | NFR-1 |

### 08 -- Integration Routing (US-6b) [6 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 8.1 | Walking Skeleton: Integration tool executed with brokered credentials | happy | FR-5, FR-8, AC-6 |
| 8.2 | Response sanitization strips auth headers | security | NFR-1 |
| 8.3 | Response sanitization strips credential JSON fields | security | NFR-1 |
| 8.4 | Response truncated to 100KB limit | boundary | NFR-1 |
| 8.5 | Integration execution error returned as tool_result error | error | FR-5 |
| 8.6 | Integration tool execution produces trace record | happy | FR-13 |

### 09 -- Tool Governance (US-8) [7 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 9.1 | Walking Skeleton: Policy denies tool call with reason | happy | FR-10, AC-8 |
| 9.2 | Policy denial writes trace with denial reason | happy | FR-10, FR-13 |
| 9.3 | Policy with max_per_day limit enforced | boundary | FR-10 |
| 9.4 | Tool with no governs_tool edge proceeds normally | happy | FR-10 |
| 9.5 | Multiple policies evaluated (most restrictive wins) | edge | FR-10 |
| 9.6 | Rate limit enforced via can_use.max_calls_per_hour | error | FR-2, AC-3 |
| 9.7 | Rate limited call writes trace with rate_limited outcome | happy | FR-13 |

### 10 -- Account Revocation (US-10) [4 scenarios]

| # | Scenario | Type | Traces |
|---|----------|------|--------|
| 10.1 | Walking Skeleton: Revoke account, credentials deleted, status set | happy | AC-10 |
| 10.2 | Subsequent tool calls return "account disconnected" | error | AC-10 |
| 10.3 | Revocation is idempotent | edge | AC-10 |
| 10.4 | Other accounts for same identity unaffected | edge | AC-10 |

## Scenario Type Breakdown

| Type | Count | Percentage |
|------|-------|------------|
| Happy path | 29 | 56% |
| Error | 9 | 17% |
| Edge case | 8 | 15% |
| Boundary | 5 | 10% |
| Security | 4 | 8% |
| **Error+Edge+Boundary+Security** | **23** | **44%** |

## Requirements Coverage

| Requirement | Scenarios | Covered |
|-------------|-----------|---------|
| FR-1 | 1.1, 1.2 | Yes |
| FR-2 | 1.3, 9.6 | Yes |
| FR-3 | 1.4, 1.5, 1.6, 2.1 | Yes |
| FR-4 | 2.1, 2.2, 2.4 | Yes |
| FR-5 | 3.1, 3.3, 8.1, 8.5 | Yes |
| FR-6 | 5.1, 5.2, 5.3, 5.5 | Yes |
| FR-7 | 6.1-6.6 | Yes |
| FR-8 | 7.1-7.3, 8.1 | Yes |
| FR-9 | 7.4, 7.5 | Yes |
| FR-10 | 9.1-9.5 | Yes |
| FR-11 | N/A (US-2, deferred) | Deferred |
| FR-12 | N/A (US-2, deferred) | Deferred |
| FR-13 | 4.1-4.4, 8.6, 9.2, 9.7 | Yes |
| NFR-1 | 5.6, 7.8, 7.9, 8.2-8.3 | Yes |
| NFR-3 | 2.2, 3.2 | Yes |
| NFR-5 | 4.2, 4.4 | Yes |

## Property-Shaped Scenarios

| Scenario | Signal | Test Strategy |
|----------|--------|---------------|
| 7.8 | "never" (credentials never in LLM context) | Property: for any tool call, response contains no credential fields |
| 7.9 | "all" (all credential fields encrypted) | Property: for any connected_account, encrypted fields decode to non-plaintext |
