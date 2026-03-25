# Technology Stack: Intent-Gated MCP Tool Access

## Principle: Reuse Existing

This feature introduces zero new technology dependencies. Every component reuses the existing Brain stack.

---

## Stack Summary

| Layer | Technology | License | Rationale |
|-------|-----------|---------|-----------|
| Runtime | Bun (`Bun.serve`) | MIT | Existing Brain runtime. New route registered in `start-server.ts`. |
| Language | TypeScript (strict) | Apache 2.0 | Existing codebase language. Functional paradigm per CLAUDE.md. |
| Database | SurrealDB | BSL 1.1 | Existing graph database. No new tables; reuses `proxy_token`, `gates`, `intent`, `mcp_tool`, `mcp_server`, `can_use`. |
| MCP Client | `@modelcontextprotocol/sdk` | MIT | Existing dependency for upstream MCP server communication via `McpClientFactory`. |
| Auth | Proxy token (X-Brain-Auth) | N/A (internal) | Existing auth mechanism from `proxy/proxy-auth.ts`. No DPoP for sandbox agents. |
| Policy | Policy gate + predicate evaluator | N/A (internal) | Existing policy evaluation pipeline from `policy/policy-gate.ts`. |
| LLM Eval | Vercel AI SDK (`ai` package) | Apache 2.0 | Existing dependency for intent risk evaluation via `generateObject`. |
| Tracing | OpenTelemetry | Apache 2.0 | Existing instrumentation via `withTracing` and `captureToolTrace`. |
| Schema | Zod | MIT | Existing validation library for MCP tool input schemas and intent validation. |

---

## New Runtime Dependencies

**None.** All dependencies are already in `package.json`.

---

## Architecture Enforcement Tooling

| Tool | License | Purpose |
|------|---------|---------|
| `dependency-cruiser` | MIT | Import dependency validation. Enforces module boundary rules (pure modules cannot import IO modules). Recommended for CI integration. |

`dependency-cruiser` is the recommended enforcement tool for this architecture. It can express rules like:
- `scope-engine.ts` pure functions must not import from `surrealdb`, `http/`, or `runtime/`
- `error-response-builder.ts` must not import any IO module
- No circular dependencies within `mcp/` module group

This is a recommendation for the platform-architect wave, not a requirement for the DESIGN wave.
