# Runtime

Server bootstrap — environment configuration, dependency injection, SurrealDB connections, LLM client factories, and route registration.

## The Problem

The Osabio server has many moving parts: SurrealDB connections, multiple LLM model clients, Better Auth, authorization server keys, SSE registries, and 30+ route handlers. All of these need coordinated initialization with proper configuration validation, and every route handler needs access to the same set of dependencies. The runtime module handles this bootstrap sequence.

## What It Does

- **Environment parsing**: Validates and parses all env vars with provider-specific config (OpenRouter vs Ollama)
- **Dependency factory**: Creates SurrealDB connections (main + analytics read-only), LLM model clients, auth instances
- **Route registration**: Wires all route handlers to URL patterns with the dependency injection context
- **Provider abstraction**: Switches between OpenRouter and Ollama via `INFERENCE_PROVIDER` env var
- **InflightTracker**: Tracks background async work to prevent connection closure during pending operations

## Key Concepts

| Term | Definition |
|------|------------|
| **ServerDependencies** | Type containing all injectable dependencies: surreal, models, auth, inflight tracker |
| **Provider Abstraction** | Factory pattern: `INFERENCE_PROVIDER=openrouter` or `ollama` switches all model clients |
| **InflightTracker** | Tracks `Promise`s for background work — `drain()` lets tests wait for pending operations before teardown |
| **Dual Surreal** | Main connection (read/write) + analytics connection (read-only) for query isolation |
| **AS Bootstrap** | Authorization Server signing key generation on first start |

## How It Works

1. `config.ts`: Parse environment variables → validate required fields → produce typed `ServerConfig`
2. `dependencies.ts`: From config, create:
   - SurrealDB connections (main + analytics, using configured provider URL)
   - LLM model clients (chat, extraction, PM, observer, analytics, embedding — per provider)
   - Better Auth instance with SurrealDB adapter
   - Authorization Server signing keys
   - InflightTracker for background work
3. `start-server.ts`: Register all route handlers with dependencies:
   - Wire each domain module's routes to URL patterns
   - Inject `ServerDependencies` into every handler
   - Start `Bun.serve()` on configured port

## Where It Fits

```text
bun run dev
  |
  v
app/server.ts (entrypoint)
  |
  v
startServer() (runtime/start-server.ts)
  |
  +---> parseConfig() (runtime/config.ts)
  |       +-> validate env vars
  |       +-> detect provider (OpenRouter / Ollama)
  |
  +---> createDependencies() (runtime/dependencies.ts)
  |       +-> SurrealDB connections
  |       +-> LLM model clients
  |       +-> Better Auth + AS keys
  |       +-> InflightTracker
  |
  +---> Register routes (30+ handlers)
  |       +-> chat, feed, graph, entities, mcp, observer, ...
  |       +-> Each receives ServerDependencies
  |
  +---> Bun.serve({ port })
```

**Consumes**: Environment variables, SurrealDB server, LLM provider APIs
**Produces**: Running HTTP server with all dependencies wired

## File Structure

```text
runtime/
  config.ts          # Environment parsing and validation (OpenRouter / Ollama detection)
  dependencies.ts    # Factory for SurrealDB, LLM clients, auth, AS keys
  start-server.ts    # Route registration + Bun.serve() startup (~34KB)
  types.ts           # ServerDependencies, InflightTracker types
```
