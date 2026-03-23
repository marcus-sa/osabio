## Git Commits

- Always use `--no-verify` when committing. The pre-commit hook requires `brain init` which is not available in worktree environments.
- Always use `-s` (GPG sign) when committing.

## Data Value Contract

- Never persist, publish, or return `null` for domain data values (Surreal records, API payloads, events, UI state).
- Absence must be represented by omitted optional fields only (`field?: Type`), not by `null`.
- If `null` appears in domain data, treat it as a contract violation and fix the producer. Do NOT sanitize/coerce it at consumers.

## TypeScript Conventions

- Do NOT use `null`. Use `undefined` via optional properties (`field?: Type`) instead.
- Do NOT create wrapper/helper functions for simple operations. Cast directly with `as`.
- Type result payloads once and avoid repetitive per-field casting.
- Do NOT use module-level mutable singletons (e.g. `let cache` at file scope) for caching or shared state. Module-level state is shared across the entire process — when multiple server instances run concurrently (e.g. smoke tests with `--concurrent`), they silently corrupt each other. Pass shared state via dependency injection or use per-instance caches scoped to the owning object.

## Agentic Design: No Hardcoded Modes

- Do NOT introduce hardcoded processing modes (e.g. `"deterministic" | "llm"`) when behavior should be workspace-configurable via data.
- This is an agentic system — capabilities are defined by workspace admins through definitions, not by code branches. If something can be expressed as a definition with configurable logic, it should be.
- Avoid dual-path dispatchers that route between "built-in" and "dynamic" implementations. One path, driven by data. See ADR-038 for the precedent.

## Failure Handling

- Do NOT add fallback logic that masks invalid state, malformed payloads, or contract violations.
- Fail fast: throw immediately when required data is missing or does not match the expected shape.
- Prefer explicit hard failures over silent degradation, synthetic defaults, or "best effort" recovery.
- Only introduce fallback behavior when explicitly requested, and document the reason in code comments.
- Never silently ignore errors (e.g. empty `.catch(() => {})`). Always surface them via logging or re-throw.

## Graph Node Types

- Read @README.md § "Key Concepts" for graph node types and § "Architecture" for the layered architecture diagram.

## Server Architecture Overview

- Entrypoint is `app/server.ts`; it only calls `startServer()` from `app/src/server/runtime/start-server.ts`.
- Runtime bootstrap is split into:
  - `runtime/config.ts` (env parsing/validation)
  - `runtime/dependencies.ts` (Surreal + model clients)
  - `runtime/start-server.ts` (route registration + Bun server startup)
- HTTP cross-cutting concerns live in `app/src/server/http`:
  - `instrumentation.ts` (`withTracing()` — wide-event span per request with business context)
  - `response.ts` (JSON/headers helpers)
  - `parsing.ts` (request/form-data parsing)
  - `errors.ts` + `observability.ts` (error/log primitives)
- SSE state management is isolated in `app/src/server/streaming/sse-registry.ts`.
- Route/business domains are separated by workflow:
  - `auth/*` for authentication (Better Auth, OAuth, DPoP)
  - `workspace/*` for workspace create/bootstrap/scope checks
  - `chat/*` for ingress, chat agent, async message processing
  - `entities/*` for entity search, detail, actions, and work item accept endpoints
  - `onboarding/*` for onboarding state and guided replies
  - `extraction/*` for extraction generation, persistence, dedupe/upsert, and context loaders
  - `agents/*` for specialized subagent implementations (PM agent, analytics agent)
  - `observation/*` / `observer/*` for observation CRUD and Observer scan endpoints
  - `intent/*` for intent creation/evaluation
  - `mcp/*` for MCP server endpoints (context, decisions, observations, constraints)
  - `orchestrator/*` for orchestrator session management
  - `learning/*` for learning CRUD endpoints
  - `policy/*` for policy CRUD, versioning, and lifecycle
  - `objective/*` for objective CRUD and progress tracking
  - `behavior/*` for behavior scoring and definitions
  - `proxy/*` for proxy compliance, sessions, spend, and traces
  - `feed/*` for governance feed and feed streaming
  - `webhook/*` for GitHub webhook integration
  - `iam/*` for identity/access management
- `tools/*` for shared AI SDK tool definitions (used by chat agent, PM agent, observer, proxy)
- `graph/*` contains reusable Surreal graph queries used by tools and higher-level workflows.

## MCP Protocol: outputSchema and structuredContent (Draft Spec)

- The MCP draft spec adds `outputSchema` (optional JSON Schema) to tool definitions alongside `inputSchema`. When a tool declares an `outputSchema`, its `CallToolResult` includes both `content` (text blocks for backwards compat) and `structuredContent` (typed JSON conforming to the schema).
- The `output_schema` field exists in the SurrealDB schema (`mcp_tool` table) but must also be present in all TypeScript types that represent tools: `McpToolRecord`, `ToolDetail`, `ToolSyncDetail`, `ResolvedTool`.
- Discovery must capture `outputSchema` from MCP `tools/list` responses and store it as `output_schema`.
- The proxy must forward `output_schema` when injecting tools into LLM requests and handle `structuredContent` in `CallToolResult` responses from upstream MCP servers.
- Reference: https://modelcontextprotocol.io/specification/draft/server/tools#output-schema

## Domain Knowledge

Load these references when working in the relevant domain:

- SurrealDB schema, queries, migrations, SDK, and known bugs: @docs/agents/surrealdb.md
- Chat agent architecture, tools, and subagents: @docs/agents/chat-agent.md
- Testing infrastructure and conventions: @docs/agents/testing.md
- Observability and instrumentation: @docs/agents/observability.md
- Extraction pipeline, structured output, and Vercel AI SDK: @docs/agents/extraction.md
