# Opportunity Scores — MCP Tool Registry (#178)

## Scoring Method

**Opportunity Score** = Importance + max(Importance - Satisfaction, 0)

Scale: 1-10 for each dimension.

| Job | Importance | Current Satisfaction | Opportunity Score | Priority |
|-----|-----------|---------------------|-------------------|----------|
| **J3: Tool Injection** | 10 | 1 | 19 | 1 (highest) |
| **J4: Credential Brokerage** | 9 | 0 | 18 | 2 |
| **J1: Provider Registration** | 8 | 0 | 16 | 3 |
| **J2: Account Connection** | 8 | 0 | 16 | 4 |

## Analysis

**All jobs are severely underserved** (satisfaction near 0) — the entire capability is missing. Priority order follows the dependency chain:

1. **Tool injection (J3)** scores highest because it's the architectural foundation. Without the proxy intercepting and injecting tools, nothing else works. The proxy already handles context injection — extending to tool injection has the highest leverage.

2. **Credential brokerage (J4)** is the complement to injection. Tools injected without credentials can't execute integration calls. This must follow immediately after J3.

3. **Provider registration (J1)** is the admin prerequisite — but a walking skeleton can hardcode providers initially and add dynamic registration later.

4. **Account connection (J2)** is user-facing OAuth flow — important but can be bootstrapped with manual token insertion before the full OAuth flow is built.

## Walking Skeleton Recommendation

Given the exploration of existing infrastructure:

**Existing foundation**:
- Proxy pipeline with 9-step flow (identity, policy, context injection, forward, trace)
- DPoP auth with RAR scopes
- Context injection via cosine similarity ranking
- Trace infrastructure with `tool_call` type
- Policy evaluation framework

**Walking skeleton scope** (validates the full vertical):
1. `mcp_tool` schema + `can_use` relation (J1 minimal)
2. Proxy tool resolution for identity (J3 core)
3. Proxy tool injection into LLM request `tools` parameter (J3 core)
4. Proxy tool_call interception + Osabio-native tool execution (J4 partial — no OAuth yet)
5. Pass-through for unknown tools (J3 boundary)

This validates the tool injection loop without requiring OAuth credentials. Integration tool execution (J4 full) and provider registration UI (J1 full) layer on afterward.
