# Requirements: OpenTelemetry Observability Migration

## Feature Overview

Replace Pino structured logging with OpenTelemetry distributed tracing, metrics, and logs across the Brain server. Enable Vercel AI SDK `experimental_telemetry` on all LLM calls. Provide developer/operator visibility into LLM behavior, request lifecycle, operational health, and token costs. Application logging migrates entirely to the OTEL Logs API, giving logs automatic trace correlation (trace_id/span_id) when emitted within a traced context.

## Scope

**In scope**:
- OTEL SDK setup with trace, metric, and log providers
- Console exporter (dev) and OTLP exporter (prod) for traces, metrics, and logs
- AI SDK `experimental_telemetry` on all `generateObject`, `streamText`, and `ToolLoopAgent` calls
- HTTP request tracing (root spans replacing `withRequestLogging`)
- Pipeline-stage child spans (extraction, chat agent, tool calls, subagents)
- OTEL metrics (LLM duration, token counters, HTTP request metrics)
- OTEL Logs API replacing Pino for all application logging
- Automatic trace correlation: logs emitted within a traced context inherit trace_id and span_id
- Pino removal and replacement with OTEL logger (thin wrapper for ergonomics)
- Migration of all `logInfo`/`logWarn`/`logError`/`logDebug` call sites to OTEL logger

**Out of scope**:
- SurrealDB graph traces (application-level audit trail -- stays as-is)
- Trace/metrics backend infrastructure (Jaeger, Grafana, etc.)
- Dashboard creation (downstream of OTLP export)
- Alerting rules
- Compliance/audit requirements beyond existing graph traces

## Constraints

- Must work on Bun runtime (not just Node.js)
- Must coexist with existing `AsyncLocalStorage`-based `requestContext`
- Console exporter must work with zero infrastructure in dev
- OTLP exporter activation controlled by standard OTEL env vars only
- No application code should reference specific telemetry backends
- SurrealDB graph traces must remain completely independent
- Telemetry must not expose raw prompt content in spans by default

## Dependencies

- `@opentelemetry/sdk-node` (or equivalent Bun-compatible OTEL SDK)
- `@opentelemetry/api`
- `@opentelemetry/sdk-trace-node`
- `@opentelemetry/sdk-metrics`
- `@opentelemetry/exporter-trace-otlp-http`
- `@opentelemetry/exporter-metrics-otlp-http`
- `@opentelemetry/api-logs`
- `@opentelemetry/sdk-logs`
- `@opentelemetry/exporter-logs-otlp-http`
- Vercel AI SDK `experimental_telemetry` API (already available in installed version)

## Non-Functional Requirements

### Performance
- OTEL instrumentation must add less than 5ms overhead per request
- Metric recording must be non-blocking
- Span export must be asynchronous and buffered (never block request handling)

### Reliability
- OTEL SDK failure must not crash the server
- Unreachable OTLP endpoint must not affect request processing
- Graceful degradation: if OTEL SDK fails to initialize, spans and log emits become no-ops

### Compatibility
- Must work with Bun >= 1.3
- Must support standard OTEL environment variables per specification
- Must not conflict with `@ai-sdk/devtools` middleware (currently wrapping all models)

## Function ID Taxonomy

Every AI SDK call must include a `functionId` from this taxonomy:

| Function ID | Call Site | Description |
|---|---|---|
| `brain.extraction.generate` | extraction pipeline | Entity extraction from messages |
| `brain.extraction.dedupe` | extraction pipeline | Deduplication scoring |
| `brain.chat.agent` | chat handler | Chat agent tool-use responses |
| `brain.chat.stream` | chat route | Streaming chat responses |
| `brain.pm.agent` | PM subagent | Work planning and organization |
| `brain.observer.verify` | observer | Observation verification |
| `brain.observer.peer-review` | observer | Peer review cross-validation |
| `brain.behavior.score` | behavior scorer | Behavior scoring |
| `brain.onboarding.generate` | onboarding | Onboarding responses |
| `brain.intent.authorize` | intent auth | Intent authorization |
| `brain.analytics.agent` | analytics agent | Analytics queries |

## Metrics Definitions

| Metric Name | Type | Unit | Attributes | Purpose |
|---|---|---|---|---|
| `brain.llm.duration` | Histogram | ms | functionId, model | LLM call latency distribution |
| `brain.llm.tokens.prompt` | Counter | tokens | functionId, model | Prompt token usage |
| `brain.llm.tokens.completion` | Counter | tokens | functionId, model | Completion token usage |
| `brain.llm.errors` | Counter | count | functionId, model, error_type | LLM call failures |
| `brain.http.duration` | Histogram | ms | method, route, status_code | HTTP request latency |
| `brain.http.requests` | Counter | count | method, route, status_code | HTTP request volume |
| `brain.extraction.entities` | Counter | count | entity_type | Extracted entity volume |

## Migration Strategy

### What Gets Removed
1. `pino` dependency (v10.3.1)
2. `app/src/server/logging.ts` -- Pino configuration
3. `logInfo`, `logWarn`, `logError`, `logDebug` from `app/src/server/http/observability.ts`
4. `withRequestLogging` from `app/src/server/http/request-logging.ts`
5. All `logInfo("event.name", { data })` call sites across the codebase

### What Gets Added
1. `app/src/server/telemetry/init.ts` -- OTEL provider initialization (TracerProvider, MeterProvider, LoggerProvider)
2. `app/src/server/telemetry/ai-telemetry.ts` -- AI SDK telemetry config factory
3. `app/src/server/telemetry/metrics.ts` -- metric instrument definitions
4. `app/src/server/telemetry/function-ids.ts` -- function ID constants
5. `app/src/server/telemetry/logger.ts` -- thin wrapper over OTEL Logs API for ergonomic `log.info()`/`log.warn()`/`log.error()`/`log.debug()` usage
6. HTTP request tracing wrapper (replaces `withRequestLogging`)

### Log Migration Strategy
All existing `logInfo`/`logWarn`/`logError`/`logDebug` call sites migrate to the OTEL logger wrapper:
- `logInfo("event.name", { key: value })` becomes `log.info("event.name", { key: value })` using OTEL Logs API under the hood
- The wrapper calls `logger.emit({ body, severityText, attributes })` on the OTEL logger obtained via `logs.getLogger('brain-server')`
- Logs emitted within an active span automatically inherit `trace_id` and `span_id` from the OTEL context -- no manual correlation needed
- LoggerProvider configured alongside TracerProvider and MeterProvider: console log exporter in dev, OTLP log exporter in prod
- Startup/config logs emitted before OTEL SDK initialization gracefully degrade to `console.log` output

### What Stays
1. `app/src/server/request-context.ts` -- `AsyncLocalStorage` (coexists with OTEL context)
2. `app/src/server/http/errors.ts` -- error primitives (unchanged)
3. `elapsedMs()` from observability.ts -- may be retained for non-span timing
4. SurrealDB graph traces -- completely independent, not touched
5. `@ai-sdk/devtools` middleware -- must coexist with `experimental_telemetry`

## Traceability Matrix

| Requirement Area | Jobs Served |
|---|---|
| AI SDK telemetry on all LLM calls | Job 1 (Debug LLM), Job 4 (Cost Visibility) |
| HTTP request root spans | Job 2 (Request Tracing), Job 3 (Monitoring) |
| Pipeline child spans | Job 2 (Request Tracing), Job 1 (Debug LLM) |
| LLM metrics (duration, tokens, errors) | Job 3 (Monitoring), Job 4 (Cost Visibility) |
| HTTP metrics | Job 3 (Monitoring) |
| OTEL Logs with trace correlation | Job 1 (Debug LLM), Job 2 (Request Tracing), Job 5 (Log-Trace Correlation) |
| Console exporter for dev | Job 1 (Debug LLM), Job 2 (Request Tracing), Job 5 (Log-Trace Correlation) |
| OTLP exporter for prod | Job 3 (Monitoring), Job 4 (Cost Visibility), Job 5 (Log-Trace Correlation) |
| Function ID taxonomy | Job 1 (Debug LLM), Job 4 (Cost Visibility) |
| Pino removal + OTEL log migration | All jobs (migration prerequisite) |
