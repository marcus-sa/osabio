# ADR-053: Replace Pino with OpenTelemetry for All Observability

## Status

Accepted

## Context

Osabio uses Pino (v10.3.1) for structured logging via `logInfo`/`logWarn`/`logError`/`logDebug` wrappers (411 call sites across 64 files) and `withRequestLogging` for HTTP request lifecycle tracking. The system has 7 model configurations with 16+ `generateObject`/`streamText` call sites across extraction, chat, observer, PM agent, behavior scorer, onboarding, intent authorization, and analytics.

Current observability gaps:

- **No distributed tracing**: When a request is slow, the operator sees total duration but cannot identify which internal operation (extraction, LLM call, DB query) consumed the time. Reconstructing the call tree from flat log lines takes 20+ minutes.
- **No metrics**: Cannot answer "what is the p95 latency of chat responses?" or "how many tokens did extraction consume this week?" without ad-hoc log analysis.
- **No LLM call visibility**: When an LLM call produces wrong results, there is no way to see model ID, token usage, or latency without adding temporary logging and redeploying.
- **No cost attribution**: Cannot attribute token costs to specific functions (extraction vs chat vs observer).
- **No log-trace correlation**: Logs and request lifecycle are separate flat events with no structural connection.

The Vercel AI SDK (v6, already installed) provides `experimental_telemetry` which emits OpenTelemetry spans for every `generateObject`/`streamText` call, capturing model ID, token usage, latency, and function ID -- but requires an active TracerProvider.

## Decision

Replace Pino entirely with OpenTelemetry as the single observability system for all three signals: traces, metrics, and logs.

- **Traces**: Manual instrumentation via `@opentelemetry/sdk-trace-base` (not `sdk-node`, which bundles auto-instrumentation, gRPC exporters, and convenience wrappers we don't need — manual setup is simpler and avoids unnecessary dependencies). HTTP root spans via `withTracing()`. AI SDK spans via `experimental_telemetry`. Pipeline stage spans via manual `tracer.startSpan()`.
- **Metrics**: OTEL metric instruments (histograms + counters) for LLM duration, token usage, error counts, HTTP request metrics, and entity extraction counts.
- **Logs**: OTEL Logs API via `@opentelemetry/api-logs` with a thin wrapper providing `log.info()`/`log.warn()`/`log.error()`/`log.debug()`. Logs within an active span automatically inherit `trace_id` and `span_id` for trace correlation.
- **Exporters**: Console in dev (zero infrastructure), OTLP HTTP in prod (activated by `OTEL_EXPORTER_OTLP_ENDPOINT`).

Pino is removed from dependencies. All 411 logging call sites migrate to the OTEL log wrapper. `withRequestLogging` is replaced by `withTracing`.

## Alternatives Considered

### Alternative 1: Keep Pino + Add OTEL for Traces/Metrics Only

- **What**: Keep Pino for logging, add OTEL only for traces and metrics. Two observability systems coexist.
- **Expected Impact**: Solves tracing and metrics gaps (~70% of the problem). Logging stays familiar.
- **Why Insufficient**: Logs and traces remain disconnected. No automatic `trace_id`/`span_id` correlation on log records. To correlate, would need a Pino transport that injects OTEL context -- adding complexity for a half-solution. Two systems to configure, two export pipelines, two sets of dependencies. The Pino log format (JSON lines) and OTEL log records (structured with severity, body, attributes) are semantically different, creating confusion about which system captures what.

### Alternative 2: Pino with OTEL Log Bridge (`@opentelemetry/instrumentation-pino`)

- **What**: Keep Pino as the logging API, use `@opentelemetry/instrumentation-pino` to bridge Pino logs into the OTEL pipeline. Add OTEL for traces and metrics.
- **Expected Impact**: Solves correlation (~85% of the problem). Familiar Pino API preserved.
- **Why Insufficient**: `@opentelemetry/instrumentation-pino` uses Node.js-specific module patching (`require` hooks) that does not work on Bun. This adds a dependency bridge layer that introduces complexity and a failure mode where the bridge breaks silently. Pino's `pino.transport()` workers also rely on Node.js `worker_threads` which Bun has limited support for. The bridge approach preserves the API but not the simplicity -- same number of dependencies, more moving parts, and a fragile integration layer.

### Alternative 3: OTEL-Only (Selected)

- **What**: Remove Pino. Use OTEL Logs API for all application logging. Thin wrapper for ergonomics. Single observability system for all three signals.
- **Expected Impact**: 100% of the problem solved. Unified pipeline. Automatic trace correlation.
- **Why Selected**: Single system, single export pipeline, single configuration. Logs automatically correlate with traces via OTEL context. All OTEL packages are Apache-2.0, CNCF graduated, actively maintained. The OTLP HTTP exporters use `fetch` (Bun-native), avoiding Node.js-specific transports. The migration is mechanical (import swap + function rename). No bridge layer, no dual configuration, no runtime compatibility risk.

## Consequences

### Positive

- **Unified observability**: All three signals (traces, metrics, logs) flow through one pipeline with automatic correlation
- **Zero-infrastructure dev**: Console exporters work out of the box with `bun run dev`
- **AI SDK integration**: `experimental_telemetry` gives per-call visibility into model, tokens, latency, and function ID without custom logging
- **Cost attribution**: Token counters with `functionId` attribute enable per-function cost breakdown
- **Bun-compatible**: `NodeTracerProvider` from `sdk-trace-node` works on Bun (verified via open-telemetry/opentelemetry-js#5260), but we use `sdk-trace-base` since we don't need Node.js-specific context managers. HTTP exporters use `fetch` (Bun-native), avoiding gRPC native bindings. `AsyncLocalStorageContextManager` is supported by Bun
- **Reduced dependencies**: One logging library (OTEL) instead of Pino + potential bridge
- **Standard env vars**: OTEL configuration via standard `OTEL_*` env vars -- no custom config needed

### Negative

- **Migration volume**: 411 log call sites across 64 files must be updated (mechanical but large)
- **Unfamiliar API**: OTEL Logs API is less ergonomic than Pino's chainable API (mitigated by thin wrapper)
- **Console output format**: OTEL ConsoleLogRecordExporter output is more verbose than Pino's compact JSON (acceptable for dev; prod uses OTLP)
- **OTEL SDK maturity on Bun**: Core OTEL packages (`sdk-trace-base`, `sdk-logs`, `sdk-metrics`, OTLP HTTP exporters) work on Bun. Known incompatibilities are limited to `PrometheusExporter` (uses `http.createServer().unref()`) and gRPC exporters (native bindings) — neither of which we use. Graceful degradation (no-op on SDK failure) mitigates remaining edge-case risk.
- **LOG_LEVEL env var**: Pino's `LOG_LEVEL` is no longer used. OTEL log filtering happens at the exporter/collector level, not at the application level. For dev console output, the wrapper can implement a simple severity filter.
