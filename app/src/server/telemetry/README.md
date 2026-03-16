# Telemetry

OpenTelemetry-based observability — traces, metrics, and structured logs for the Brain server.

## The Problem

When an LLM call produces wrong results, you need to see the full request lifecycle: which model was called, how many tokens it consumed, how long it took, and what happened upstream. When a user reports a slow interaction, you need to trace from the HTTP request through the chat agent, tool calls, and extraction pipeline to find the bottleneck. Flat log lines don't give you this — you need correlated traces, structured metrics, and logs that link to both.

## What It Does

- **Traces**: Root spans for HTTP requests (`brain.http.request`), child spans for LLM calls via AI SDK `experimental_telemetry`, manual spans for pipeline stages
- **Metrics**: Histograms for LLM and HTTP latency, counters for token usage, errors, and extracted entities
- **Logs**: Structured log records via OTEL Logs API with automatic trace/span ID correlation
- **AI SDK integration**: `experimental_telemetry` on all `generateObject`/`streamText` calls — emits model ID, token usage, latency, and function ID as span attributes
- **Exporter selection**: Console exporters for dev (zero infrastructure), OTLP HTTP for prod (via `OTEL_EXPORTER_OTLP_ENDPOINT`)

## Key Concepts

| Term | Definition |
|------|------------|
| **Function ID** | A `brain.*` identifier (e.g. `brain.extraction`, `brain.chat-agent`) that tags each LLM call for cost attribution and filtering |
| **TracerProvider** | Manages span creation and export. Uses `BasicTracerProvider` with `BatchSpanProcessor` |
| **MeterProvider** | Manages metric instruments. Uses `PeriodicExportingMetricReader` |
| **LoggerProvider** | Manages log record emission. Uses `SimpleLogRecordProcessor` |
| **TelemetryHandle** | Return value of `initTelemetry()` — holds references to all three providers and the shutdown function |

## How It Works

**Example — tracing a chat request end-to-end:**

1. HTTP request arrives at `POST /api/chat/messages`
2. `withTracing()` creates root span `brain.http.request` with method, route, requestId
3. Chat handler calls `streamText()` with `experimental_telemetry: createTelemetryConfig(FUNCTION_IDS.CHAT_AGENT)`
4. AI SDK automatically creates child span with model ID, token usage, latency
5. Chat agent invokes extraction tool — `generateObject()` with `FUNCTION_IDS.EXTRACTION` creates another child span
6. `log.info("extraction.completed", ...)` emits a log record that inherits `trace_id` and `span_id` from the active span
7. `recordLlmMetrics()` records token counters and duration histogram with `functionId` attribute
8. On response completion, root span closes with `http.status_code` and HTTP metrics are recorded

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **No OTLP endpoint configured** | Console exporters used — spans/metrics/logs print to stdout |
| **OTEL SDK init failure** | Server starts normally; all telemetry calls become no-ops |
| **SIGTERM received** | `shutdownTelemetry()` flushes all three providers before process exit |
| **Pre-init log calls** | OTEL API returns no-op logger — records silently dropped (nothing logs before init) |

## Where It Fits

```text
initTelemetry() (server startup)
  |
  +---> TracerProvider (traces)
  +---> MeterProvider (metrics)
  +---> LoggerProvider (logs)
  |
  v
withTracing() (HTTP layer)
  |
  +---> Root span: brain.http.request
  |       |
  |       v
  |     Route Handler
  |       +-> log.info/error() — inherits trace_id/span_id
  |       +-> streamText/generateObject — AI SDK child spans
  |       +-> recordLlmMetrics() — token/latency counters
  |       |
  |       v
  +---> httpDuration histogram + httpRequests counter
  |
  v
Exporters
  +---> Console (dev) or OTLP HTTP (prod)
```

**Consumes**: HTTP requests, LLM call results, application events
**Produces**: OTEL spans, metric data points, log records

## File Structure

```text
telemetry/
  init.ts            # SDK bootstrap: providers, exporters, resource, shutdown
  logger.ts          # log.info/warn/error/debug backed by OTEL Logs API + serializeError
  metrics.ts         # 7 metric instruments: LLM duration/tokens/errors, HTTP duration/requests, extraction entities
  ai-telemetry.ts    # createTelemetryConfig() factory for AI SDK experimental_telemetry + recordLlmMetrics/recordLlmError
  function-ids.ts    # 15 brain.* function ID constants with FunctionId union type
```
