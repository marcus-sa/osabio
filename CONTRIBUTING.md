# Contributing to Brain

Thank you for your interest in contributing. Brain is an early-stage project and contributions are welcome.

## Contributor License Agreement

By submitting a pull request, you agree to the [Contributor License Agreement](CLA.md). This allows the project to offer commercial licenses alongside the AGPL-3.0 open source license without requiring per-contributor approval.

All commits must include a `Signed-off-by` line (DCO) certifying you wrote the code or have the right to submit it:

```bash
git commit -s -m "your commit message"
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Docker](https://www.docker.com/) (for SurrealDB)
- An [OpenRouter](https://openrouter.ai) API key (or local Ollama)

### Setup

```bash
# Install dependencies
bun install

# Start SurrealDB
docker compose up -d surrealdb surrealdb-init

# Copy and configure environment
cp .env.example .env
# Edit .env with your API key

# Apply migrations
bun migrate

# Start dev server
bun run dev
```

### Running Tests

```bash
# Unit tests (no external dependencies)
bun test tests/unit/

# Acceptance tests (requires running SurrealDB)
bun test --env-file=.env tests/acceptance/

# Type checking
bun run typecheck
```

## Code Conventions

### TypeScript

- **No `null`.** Use `undefined` via optional properties (`field?: Type`). If `null` appears in domain data, fix the producer.
- **No module-level mutable singletons.** Pass shared state via dependency injection.
- **Fail fast.** Throw on invalid state. No silent fallbacks, no synthetic defaults, no empty `.catch(() => {})`.

### SurrealDB

- All tables are `SCHEMAFULL`. Every persisted field must be declared in `schema/surreal-schema.surql`.
- Read the schema before writing queries. Guessing field names leads to silent rejections.
- Use `RecordId` objects, not `"table:id"` strings, in TypeScript code.
- Graph edges use `RELATE`, never `CREATE`.
- Schema changes require a versioned migration in `schema/migrations/` applied via `bun migrate`.

### IDs

- Fixed-table ID fields (`session_id`, `task_id`, etc.) are raw UUIDs without table prefix.
- Polymorphic fields (`entity_id`, `target`) may use `table:id` format with an allowlist.
- Parse IDs once at the HTTP boundary. Never re-wrap a prefixed ID.

### Testing

- Use `crypto.randomUUID()` for test identifiers, not `Date.now()`.
- Acceptance tests get an isolated SurrealDB namespace per suite.
- MCP endpoints require DPoP auth. Use `createTestUserWithMcp()` from the test kit.

### LLM Tools (Vercel AI SDK)

- Tool `description` says what it does and when to use it. Keep it short.
- Parameter guidance goes in Zod `.describe()`, not in the tool description or system prompt.

## Pull Requests

1. Fork the repo and create a branch from `main`.
2. Write tests for new functionality.
3. Ensure `bun test tests/unit/` and `bun run typecheck` pass.
4. Include `Signed-off-by` in your commits.
5. Keep PRs focused. One feature or fix per PR.

## Reporting Bugs

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Bun version, SurrealDB version)

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
