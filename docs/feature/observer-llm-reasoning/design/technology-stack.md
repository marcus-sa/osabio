# Technology Stack: Observer LLM Reasoning

## Decisions

All technology choices extend the existing Brain stack. No new dependencies introduced.

### LLM Integration

| Component | Technology | License | Rationale |
|-----------|-----------|---------|-----------|
| AI SDK | Vercel AI SDK (`ai` package) | Apache 2.0 | Already used by extraction, onboarding, PM agent, authorizer. `generateObject` provides structured output with Zod schemas. |
| LLM Provider | OpenRouter / Ollama | N/A (service) | Provider-agnostic via `@openrouter/ai-sdk-provider`. Existing abstraction in `runtime/dependencies.ts`. |
| Default model | Haiku-class (e.g. `anthropic/claude-haiku-4-5-20251001`) | N/A (service) | Cheapest capable model for structured reasoning. Sufficient for contradiction detection and pattern synthesis. |
| Schema validation | Zod | MIT | Already used across codebase for structured output schemas. |

### Database

| Component | Technology | License | Rationale |
|-----------|-----------|---------|-----------|
| Graph store | SurrealDB | BSL 1.1 | Existing. Observation table + observes relation already support all needed fields. Minor schema migration for new fields. |

### Runtime

| Component | Technology | License | Rationale |
|-----------|-----------|---------|-----------|
| Runtime | Bun | MIT | Existing. All observer code runs in the same Bun process. |
| Language | TypeScript | Apache 2.0 | Existing. Functional paradigm with algebraic types. |

## No New Dependencies

This feature requires zero new npm packages. All functionality is built on:
- `ai` (Vercel AI SDK) -- already installed
- `zod` -- already installed
- `surrealdb` -- already installed
- `@openrouter/ai-sdk-provider` -- already installed

## Rejected Alternatives

### Alternative: Dedicated vector search for contradiction detection
- **What**: Use embedding similarity between decisions and tasks to detect contradictions
- **Why rejected**: LLM structured reasoning provides richer verdicts with explanations. Vector similarity only measures distance, not semantic contradiction. Also, embedding infrastructure already exists but contradiction detection requires reasoning, not similarity.

### Alternative: Separate observer microservice
- **What**: Deploy observer LLM reasoning as independent service
- **Why rejected**: Team size (1-2 devs) does not justify operational overhead. Observer already runs in-process via SurrealDB EVENT webhooks. Adding a service boundary adds latency, deployment complexity, and DB connection management for zero benefit.
