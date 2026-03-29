# US-LP-005: Policy Enforcement at the LLM Call Boundary

## Problem
Marcus Olsson is a workspace admin who has granted agents elevated authority scopes but has no enforcement at the LLM call boundary. A coding agent could call claude-opus-4 (15x the cost of Haiku) without restriction. A bug in an agent loop could burn through $500 in minutes with no guardrail. Today, agents self-regulate their model usage -- there is no external enforcement.

## Who
- Workspace Admin | Grants agent authority | Needs LLM-layer enforcement to match granted permissions
- Autonomous Agent | Makes LLM calls within scope | Needs clear, fast authorization feedback

## Job Story Trace
- JS-3: Governed Agent Autonomy

## Solution
Before forwarding each LLM request, query the Osabio policy graph to verify: (1) the agent type is allowed to use the requested model, (2) workspace/project budget has not been exceeded, (3) rate limits are within bounds. Block violations with clear error messages including policy reference and remediation guidance.

## Domain Examples

### 1: Happy Path -- Policy check passes quickly
Priya's Claude Code (coding-agent) requests "claude-sonnet-4". The proxy checks: model access policy allows coding-agent to use sonnet-4, workspace daily spend ($12.40) is under the $50.00 limit, rate (45 req/min) is under 60/min limit. All three checks pass in 3ms. Request forwarded.

### 2: Error Path -- Model access denied
The Observer agent (agent type: observer) requests "claude-opus-4". The policy graph shows observers are restricted to "claude-haiku-3.5" only. The proxy returns HTTP 403 with body: `{"error": "policy_violation", "message": "Model claude-opus-4 not authorized for agent type observer in workspace osabio-v1", "policy_ref": "policy:model-access-prod-v2", "remediation": "Use claude-haiku-3.5 or request Opus access from workspace admin"}`.

### 3: Error Path -- Budget exceeded
Marcus set a $50/day workspace budget. At 4:30 PM, workspace spend hits $49.80. The next request from Priya (estimated cost ~$0.50 for a Sonnet call) would push over budget. The proxy returns HTTP 429 with: `{"error": "budget_exceeded", "current_spend": "$49.80", "daily_limit": "$50.00", "remediation": "Contact workspace admin to increase daily budget or wait until tomorrow"}`.

### 4: Error Path -- Rate limit exceeded
A runaway agent loop sends 120 requests in 60 seconds against a 60/min limit. After the 60th request, subsequent requests receive HTTP 429 with `Retry-After` header indicating seconds until the rate window resets. The error body includes: `{"error": "rate_limit_exceeded", "limit": "60/min", "current": "120/min", "remediation": "Reduce request frequency or contact workspace admin to increase rate limit"}`.

### 5: Edge Case -- No policies configured
A new workspace has no model access policies defined. The proxy defaults to allowing all models (permissive by default). A warning observation is created: "Workspace osabio-v1 has no LLM model access policies. All models are accessible to all agent types."

## UAT Scenarios (BDD)

### Scenario: Authorized request passes policy check within 10ms
Given workspace "osabio-v1" allows "coding-agent" to use "claude-sonnet-4"
And daily spend is $12.40 against a $50.00 limit
And request rate is 45/min against a 60/min limit
When a coding-agent requests "claude-sonnet-4"
Then the policy check completes in under 10ms
And the request is forwarded to Anthropic

### Scenario: Unauthorized model returns 403 with policy reference
Given workspace "osabio-v1" allows "observer" to use only "claude-haiku-3.5"
When the observer agent requests "claude-opus-4"
Then the proxy returns HTTP 403
And the error body contains "policy_violation"
And the error body contains policy reference "policy:model-access-prod-v2"
And the error body contains remediation suggesting haiku or requesting admin access

### Scenario: Budget exceeded returns 429 with spend details
Given workspace "osabio-v1" has daily budget $50.00 and current spend $49.80
When any agent makes an LLM request
Then the proxy returns HTTP 429
And the error body contains "budget_exceeded"
And the error body contains current spend and limit
And the error body contains remediation guidance

### Scenario: Rate limit exceeded returns 429 with Retry-After
Given workspace "osabio-v1" rate limit is 60 requests per minute
And 60 requests have been made in the current minute window
When request number 61 arrives
Then the proxy returns HTTP 429
And the Retry-After header indicates seconds until the window resets
And the error body contains "rate_limit_exceeded"

### Scenario: No policies defaults to permissive with warning
Given workspace "osabio-v1" has no model access policies configured
When any agent requests any model
Then the request is forwarded (permissive default)
And a warning observation is created noting the missing policies

## Acceptance Criteria
- [ ] Policy check evaluates model access, budget, and rate limit before forwarding
- [ ] Policy check latency under 10ms at p99
- [ ] Model access violation returns HTTP 403 with policy_ref and remediation
- [ ] Budget exceeded returns HTTP 429 with current spend, limit, and remediation
- [ ] Rate limit exceeded returns HTTP 429 with Retry-After header and remediation
- [ ] Missing policies default to permissive with warning observation
- [ ] Policy decisions logged for audit trail (pass or fail with policy reference)

## Technical Notes
- Query Osabio's existing policy graph -- do not create a separate policy system
- Cache policy decisions per workspace (policies change infrequently; cache TTL: 60s)
- Rate limiting: sliding window counter per workspace (in-memory, not DB -- too frequent for graph writes)
- Budget check: read spend counters (from US-LP-004) against configured limits
- Error response format must be valid JSON parseable by Claude Code (it displays errors to the user)
- Agent type determination: from custom header (X-Osabio-Agent-Type) or inferred from metadata patterns

## Dependencies
- US-LP-002 (identity resolution -- need workspace context for policy evaluation)
- US-LP-004 (cost attribution -- budget check reads spend counters)
- Osabio policy engine (existing -- policies managed via policy CRUD UI)
