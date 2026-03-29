# Component Boundaries: OpenTelemetry Observability Migration

## Component Diagram

```
app/src/server/
  telemetry/                         <-- NEW directory
    init.ts                          <-- SDK bootstrap (providers, exporters, resource)
    logger.ts                        <-- OTEL log wrapper (replaces Pino wrappers)
    metrics.ts                       <-- Metric instrument definitions
    ai-telemetry.ts                  <-- AI SDK experimental_telemetry config factory
    function-ids.ts                  <-- Function ID taxonomy constants
  http/
    instrumentation.ts               <-- NEW: HTTP request tracing (replaces withRequestLogging)
    observability.ts                 <-- MODIFIED: remove logInfo/logWarn/logError/logDebug; keep elapsedMs, userFacingError
    request-logging.ts               <-- REMOVED: replaced by instrumentation.ts
  logging.ts                         <-- REMOVED: Pino config (serializeError moves to telemetry/logger.ts)
  request-context.ts                 <-- REMOVED: only consumed by logging.ts and request-logging.ts
```

## Component Details

### `telemetry/init.ts` -- SDK Bootstrap

**Creates**: TracerProvider, MeterProvider, LoggerProvider

**Exports**:
- `initTelemetry()` -- called once at startup, before `Bun.serve()`
- `shutdownTelemetry()` -- graceful drain for server stop
- `tracer` -- the `Tracer` instance for manual span creation
- `meter` -- the `Meter` instance (used by metrics.ts to create instruments)

**Depends on**:
- `@opentelemetry/sdk-trace-base` (TracerProvider, BatchSpanProcessor, ConsoleSpanExporter)
- `@opentelemetry/sdk-metrics` (MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter)
- `@opentelemetry/sdk-logs` (LoggerProvider, BatchLogRecordProcessor, ConsoleLogRecordExporter)
- `@opentelemetry/resources` (Resource)
- `@opentelemetry/semantic-conventions` (ATTR_SERVICE_NAME)
- `@opentelemetry/context-async-hooks` (AsyncLocalStorageContextManager)
- `@opentelemetry/exporter-trace-otlp-http` (OTLPTraceExporter) -- conditional
- `@opentelemetry/exporter-metrics-otlp-http` (OTLPMetricExporter) -- conditional
- `@opentelemetry/exporter-logs-otlp-http` (OTLPLogExporter) -- conditional

**Depended on by**: All other telemetry modules (transitively), `runtime/start-server.ts`

**Env vars consumed** (standard OTEL, not in `config.ts`):
- `OTEL_SERVICE_NAME` (default: "brain")
- `OTEL_EXPORTER_OTLP_ENDPOINT` (triggers OTLP exporters)
- `OTEL_EXPORTER_OTLP_HEADERS` (auth headers for OTLP)
- `OTEL_METRIC_EXPORT_INTERVAL` (default: 60000ms)

---

### `telemetry/logger.ts` -- OTEL Log Wrapper

**Creates**: Ergonomic logging functions backed by OTEL Logs API

**Exports**:
- `log.info(event, attributes?)` -- INFO severity
- `log.warn(event, attributes?)` -- WARN severity
- `log.error(event, attributes?, error?)` -- ERROR severity, optional error serialization
- `log.debug(event, attributes?)` -- DEBUG severity
- `serializeError(error)` -- moved from `logging.ts`, reused by log.error and span exception recording

**Depends on**:
- `@opentelemetry/api-logs` (logs.getLogger)

**Depended on by**: All 64 files currently importing logInfo/logWarn/logError/logDebug

**Pre-init behavior**: Before `initTelemetry()` completes, the OTEL Logs API returns a no-op logger. The wrapper detects this and falls back to `console` methods with `[brain]` prefix. After `initTelemetry()`, the global LoggerProvider is registered and subsequent calls use the real OTEL logger.

**Trace correlation**: Automatic. When `logger.emit()` is called within an active span context, the OTEL SDK attaches the current `trace_id` and `span_id` to the log record. No manual injection needed.

---

### `telemetry/metrics.ts` -- Metric Instruments

**Creates**: All metric instruments as module-level singletons

**Exports**:
- `llmDuration` -- Histogram (`osabio.llm.duration`, unit: ms)
- `llmPromptTokens` -- Counter (`osabio.llm.tokens.prompt`, unit: tokens)
- `llmCompletionTokens` -- Counter (`osabio.llm.tokens.completion`, unit: tokens)
- `llmErrors` -- Counter (`osabio.llm.errors`, unit: count)
- `httpDuration` -- Histogram (`osabio.http.duration`, unit: ms)
- `httpRequests` -- Counter (`osabio.http.requests`, unit: count)
- `extractionEntities` -- Counter (`osabio.extraction.entities`, unit: count)

**Depends on**:
- `@opentelemetry/api` (metrics.getMeter or the `meter` from init.ts)

**Depended on by**: `ai-telemetry.ts`, `http/instrumentation.ts`, extraction pipeline

**Note**: Instruments are created once at module load. `meter.createHistogram()` and `meter.createCounter()` return no-op instruments if MeterProvider is not registered, which is safe.

---

### `telemetry/ai-telemetry.ts` -- AI SDK Telemetry Config Factory

**Creates**: Configuration objects for AI SDK's `experimental_telemetry` option

**Exports**:
- `createTelemetryConfig(functionId, metadata?)` -- returns `{ isEnabled: true, functionId, metadata }` for use in `generateObject`/`streamText` options
- `recordLlmMetrics(functionId, model, usage, durationMs)` -- records duration histogram + token counters
- `recordLlmError(functionId, model, errorType)` -- increments error counter

**Depends on**:
- `telemetry/metrics.ts` (metric instruments)
- `telemetry/function-ids.ts` (type checking)

**Depended on by**: All 16 files with `generateObject`/`streamText` calls:
- `extraction/extract-graph.ts`
- `chat/handler.ts`
- `chat/chat-route.ts`
- `observer/llm-reasoning.ts`
- `observer/llm-synthesis.ts`
- `observer/learning-diagnosis.ts`
- `observer/session-trace-analyzer.ts`
- `observer/trace-response-analyzer.ts`
- `observer/schemas.ts`
- `agents/observer/prompt.ts`
- `mcp/mcp-route.ts`
- `learning/collision.ts`
- `intent/authorizer.ts`
- `onboarding/onboarding-reply.ts`
- `behavior/llm-scorer.ts`
- `descriptions/generate.ts`

---

### `telemetry/function-ids.ts` -- Function ID Taxonomy

**Creates**: Typed string constants for the `osabio.*` function ID namespace

**Exports**: Named constants for each function ID

**Depends on**: Nothing

**Depended on by**: `ai-telemetry.ts`, any call site needing a function ID

**Taxonomy**:
```
osabio.extraction.generate
osabio.extraction.dedupe
osabio.chat.agent
osabio.chat.stream
osabio.pm.agent
osabio.observer.verify
osabio.observer.peer-review
osabio.observer.synthesis
osabio.observer.trace-analysis
osabio.behavior.score
osabio.onboarding.generate
osabio.intent.authorize
osabio.analytics.agent
brain.learning.collision
brain.descriptions.generate
```

---

### `http/instrumentation.ts` -- HTTP Request Tracing

**Creates**: Root spans for HTTP requests, replaces `withRequestLogging`

**Exports**:
- `withTracing(route, method, handler)` -- same signature as `withRequestLogging`

**Depends on**:
- `@opentelemetry/api` (trace.getTracer, context)
- `telemetry/metrics.ts` (httpDuration, httpRequests)
- ~~`request-context.ts`~~ (removed — OTEL context replaces it)
- `http/response.ts` (withRequestIdHeader, jsonError)

**Depended on by**: `runtime/start-server.ts` (all route registrations)

**Behavior**:
1. Generate/extract `requestId` (same logic as current `withRequestLogging`)
2. Start root span `osabio.http.request` with method, route, path, requestId attributes
3. Run handler within OTEL context (`context.with()`)
4. On completion: set `http.status_code`, record httpDuration + httpRequests metrics
5. On error: set span ERROR status, record exception, return 500 response

---

## Dependency Graph

```
telemetry/init.ts
  |
  +-- telemetry/logger.ts  (uses LoggerProvider from init)
  |     |
  |     +-- [64 files] (import log.info/warn/error/debug)
  |
  +-- telemetry/metrics.ts  (uses Meter from init)
  |     |
  |     +-- telemetry/ai-telemetry.ts  (records LLM metrics)
  |     |     |
  |     |     +-- telemetry/function-ids.ts  (function ID constants)
  |     |     |
  |     |     +-- [16 files] (AI SDK call sites)
  |     |
  |     +-- http/instrumentation.ts  (records HTTP metrics)
  |           |
  |           +-- runtime/start-server.ts  (all route registrations)
  |
  +-- runtime/start-server.ts  (calls initTelemetry at startup)
```

## Migration Surface

### Mechanical migrations (import swap + function rename)

| Current import | New import | Call change |
|---------------|------------|-------------|
| `import { logInfo, logError, ... } from "../http/observability"` | `import { log } from "../telemetry/logger"` | `logInfo("event", "msg", data)` -> `log.info("event", data)` |
| `import { logInfo, logError } from "../../http/observability"` | `import { log } from "../../telemetry/logger"` | Same pattern, adjust relative path |
| `import { withRequestLogging } from "../http/request-logging"` | `import { withTracing } from "../http/instrumentation"` | `withRequestLogging(...)` -> `withTracing(...)` |

### AI SDK call sites (add telemetry config)

Each `generateObject({...})` call adds:
```
experimental_telemetry: createTelemetryConfig(FUNCTION_IDS.EXTRACTION_GENERATE, { workspaceId })
```

Each `streamText({...})` call adds the same pattern with the appropriate function ID.

### Files removed

| File | Replacement |
|------|-------------|
| `app/src/server/logging.ts` | `telemetry/logger.ts` (serializeError moved there) |
| `app/src/server/http/request-logging.ts` | `http/instrumentation.ts` |

### Functions removed from `observability.ts`

| Function | Replacement |
|----------|-------------|
| `logDebug()` | `log.debug()` |
| `logInfo()` | `log.info()` |
| `logWarn()` | `log.warn()` |
| `logError()` | `log.error()` |

### Functions retained in `observability.ts`

| Function | Reason |
|----------|--------|
| `elapsedMs()` | Used for manual timing outside span contexts |
| `userFacingError()` | Error message formatting for HTTP responses (not logging) |
