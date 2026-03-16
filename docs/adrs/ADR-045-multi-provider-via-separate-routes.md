# ADR-045: Multi-Provider Support via Separate Route Handlers

## Status
Proposed

## Context
Brain must proxy both Anthropic (Claude Code) and OpenAI-compatible (OpenRouter, Ollama, Cursor) LLM requests. These use different wire formats: Anthropic Messages API vs OpenAI Chat Completions API. SSE event structures and usage extraction differ between the two.

## Decision
Implement two separate route handler modules (`anthropic-proxy-route.ts`, `openai-proxy-route.ts`) that share common infrastructure (identity resolver, policy evaluator, cost calculator, trace writer) but implement provider-specific request forwarding and SSE usage extraction.

Shared components are pure functions passed as dependencies, not inherited via class hierarchies.

## Alternatives Considered

### Alternative 1: Single route with format auto-detection
- **What**: One `/proxy/llm/*` route that detects Anthropic vs OpenAI format from the request body
- **Expected impact**: Simpler routing, single entry point
- **Why insufficient**: Format detection adds complexity and fragility. The two APIs have different SSE event structures, different usage field locations, different header conventions. Mixing them in one handler creates a branching maze. Separate routes are explicit and independently testable.

### Alternative 2: Protocol translation layer (normalize to one format)
- **What**: Translate all requests to a canonical internal format, forward in that format, translate responses back
- **Expected impact**: Single internal pipeline regardless of provider
- **Why insufficient**: Protocol translation is the main source of bugs in LLM proxies (LiteLLM's issue tracker confirms this). Breaks prompt caching (Anthropic-specific). Breaks provider-specific features (extended thinking, tool use formats). The proxy's value is transparency, not transformation.

## Consequences
- **Positive**: Each route handler is simple and testable; no format detection or translation
- **Positive**: Provider-specific SSE parsing is isolated; adding a new provider means adding one route handler
- **Positive**: Preserves prompt caching (no request body modification)
- **Negative**: Some code duplication in request forwarding logic (mitigated: shared pure functions for identity, policy, cost, trace)
