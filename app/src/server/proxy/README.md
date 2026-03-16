# Proxy

Transparent LLM proxy with identity resolution, policy enforcement, cost tracking, brain context injection, and full audit trail.

## The Problem

Your coding agents call the Anthropic API directly. Brain has no visibility into what they're doing, what they're spending, or whether their requests align with workspace policies. The proxy sits between your agents and the LLM provider, adding identity resolution, budget enforcement, rate limiting, knowledge graph context injection, and forensic-grade audit trails — without changing how your agents work.

## What It Does

- **Transparent forwarding**: Proxies Anthropic Messages API requests — agents don't know they're going through Brain
- **9-step pipeline**: Identity resolution → session ID → conversation hashing → policy evaluation → context injection → forward → trace capture
- **Policy enforcement**: Model allowlists, daily budget limits, per-workspace rate limiting (60 req/min default)
- **Brain context injection**: Ranks decisions, learnings, and observations by cosine similarity to the request, injects within a token budget
- **Cost tracking**: Calculates token costs per request using a pricing table, aggregates spend per workspace
- **Audit trail**: Every request becomes a trace node in the graph with token costs, model, conversation hash, and response content
- **Spend monitoring**: Anomaly detection for unusual spending patterns

## Key Concepts

| Term | Definition |
|------|------------|
| **Conversation Hash** | UUIDv5 from system prompt + first user message — stable ID across turns for trace grouping |
| **Context Injection** | Embed the request, KNN search for relevant decisions/learnings, inject ranked results into system prompt |
| **Pricing Table** | Per-model input/output token costs for accurate spend calculation |
| **Rate Limiter** | Sliding-window counter per workspace (60 req/min default) |
| **Trace Node** | Graph record linking request to identity, workspace, session, conversation, with full cost breakdown |
| **Intelligence Config** | Per-workspace settings for context injection behavior (enabled, token budget, similarity threshold) |

## How It Works

**9-step proxy pipeline:**

1. **Identity resolution**: Extract identity from Claude Code metadata + `X-Brain-*` headers
2. **Session ID**: Resolve from header (priority) or metadata
3. **Conversation hash**: UUIDv5 from system prompt + first user message for stable trace grouping
4. **Policy evaluation**: Check model allowlist → check daily budget → check rate limit
5. **Context injection**: Embed request → KNN search for relevant decisions/learnings/observations → inject within token budget
6. **Forward**: Proxy request to Anthropic Messages API (streaming or non-streaming)
7. **Trace capture**: Async write trace node with token costs, model, conversation hash
8. **Cost calculation**: Input/output tokens × pricing table rate
9. **Spend update**: Aggregate workspace spend, check anomaly thresholds

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Budget exceeded** | 429 with remaining budget and reset time |
| **Rate limited** | 429 with retry-after header |
| **Model not in allowlist** | 403 with list of allowed models |
| **No relevant context** | Request forwarded without injection — transparent |
| **Anthropic API error** | Retry with exponential backoff (configurable retries) |
| **Unknown identity** | Request proceeds with anonymous trace (no workspace context) |

## Where It Fits

```text
Coding Agent (Claude Code, Cursor)
  |
  v
POST /api/proxy/anthropic/v1/messages
  |
  +---> 1. Identity Resolution (headers + metadata)
  +---> 2. Session ID Resolution
  +---> 3. Conversation Hash (UUIDv5)
  +---> 4. Policy Evaluation
  |       +-> Model allowlist check
  |       +-> Daily budget check
  |       +-> Rate limit check
  +---> 5. Context Injection
  |       +-> Embed request
  |       +-> KNN search (decisions, learnings)
  |       +-> Inject ranked results
  +---> 6. Forward to Anthropic API
  +---> 7. Trace Capture (async)
  +---> 8. Cost Calculation
  +---> 9. Spend Update
  |
  v
Response to Agent (transparent)
```

**Consumes**: LLM API requests, identity metadata, workspace policies, knowledge graph
**Produces**: Proxied responses, trace nodes, spend records, anomaly alerts

## File Structure

```text
proxy/
  anthropic-proxy-route.ts        # Main proxy orchestrator (9-step pipeline)
  identity-resolver.ts            # Resolve identity from headers + Claude Code metadata
  session-id-resolver.ts          # Session ID from header or metadata
  conversation-hash-resolver.ts   # UUIDv5 conversation hashing for trace grouping
  conversation-upserter.ts        # Upsert conversation records from proxy requests
  policy-evaluator.ts             # Model allowlist, budget, rate limit enforcement
  context-injector.ts             # Pure ranking and selection for brain context injection
  context-cache.ts                # TTL cache for workspace context (configurable)
  rate-limiter.ts                 # Sliding-window rate limiting per workspace
  cost-calculator.ts              # Token cost computation from pricing table
  pricing-table.ts                # Per-model input/output token prices
  trace-writer.ts                 # Async trace persistence to SurrealDB
  audit-api.ts                    # Trace queries, provenance chains, compliance reporting
  spend-api.ts                    # Spend monitoring, aggregation, anomaly detection
  intelligence-config.ts          # Per-workspace context injection settings
  retry.ts                        # Exponential backoff retry for API calls
```
