# ADR-040: LLM Proxy as In-Process Module

## Status
Proposed

## Context
The LLM Proxy needs to intercept all agent LLM calls, write traces to SurrealDB, evaluate policies, and track costs. We must decide whether the proxy runs as a separate process/service or as a module within the existing Osabio Bun server.

Team size is 1-3 developers. The existing Osabio server already has SurrealDB connections, inflight tracking, policy engine, and observation system. Operational maturity is early-stage (no container orchestration, no service mesh).

## Decision
Run the LLM Proxy as an in-process module within the existing Osabio Bun server, sharing `ServerDependencies`.

## Alternatives Considered

### Alternative 1: Separate Bun process on a dedicated port
- **What**: Standalone proxy server on port 4100, communicating with Osabio via HTTP
- **Expected impact**: Full isolation, independent scaling
- **Why insufficient**: Doubles operational complexity (two processes to manage), requires inter-process communication for policy checks and graph writes, duplicates SurrealDB connection management. Team of 1-3 cannot justify the operational overhead. No independent scaling need exists (single workspace, single developer workstation).

### Alternative 2: LiteLLM as proxy layer with Osabio plugin
- **What**: Deploy LiteLLM (Python) as the forwarding proxy, write a Osabio plugin for graph storage
- **Expected impact**: Proven proxy with 100+ provider support
- **Why insufficient**: Introduces Python dependency into a TypeScript/Bun stack. Plugin API does not support SurrealDB graph writes or Osabio's policy evaluation pipeline. Cross-language integration complexity exceeds building the proxy in TypeScript. LiteLLM's cost tracking uses PostgreSQL, not a knowledge graph.

### Alternative 3: Reverse proxy (nginx/Caddy) with webhook callbacks
- **What**: nginx/Caddy handles SSE relay, sends webhook to Osabio after each request
- **Expected impact**: Zero custom code for SSE passthrough
- **Why insufficient**: Cannot perform pre-request policy evaluation (budget, model access). Webhook callbacks cannot extract SSE usage data mid-stream. Adds nginx/Caddy as infrastructure dependency.

## Consequences
- **Positive**: Zero inter-process overhead; shared SurrealDB connection; reuses policy engine, observation system, inflight tracker; single deployment unit; simple local development
- **Positive**: Proxy routes registered alongside API routes in `start-server.ts`; same `withRequestLogging` wrapper for observability
- **Negative**: Proxy failure could affect main API server (mitigated by isolating proxy logic in pure functions with explicit error boundaries)
- **Negative**: Cannot scale proxy independently of API server (acceptable for current team size and single-workspace deployment)
