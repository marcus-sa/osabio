# OpenTelemetry Observability Migration

**Date:** 2026-03-16
**Feature:** opentelemetry-observability
**ADR:** ADR-053 (OTEL-only over Pino+OTEL hybrid)

## Summary

Replaced Pino structured logging with OpenTelemetry for all three signals (traces, metrics, logs) and enabled Vercel AI SDK `experimental_telemetry` on all LLM calls. The migration covered ~409 log call sites across 62 files and 41 `generateObject`/`streamText` calls across 16 files.

## Phases and Steps

### Phase 1: Foundation

| Step | Name | Duration |
|------|------|----------|
| 01-01 | Install OTEL dependencies and create function ID constants | 15:05 - 15:14 |
| 01-02 | OTEL SDK bootstrap and graceful shutdown | 15:15 - 15:20 |
| 01-03 | OTEL logger wrapper and metric instruments | 15:21 - 15:24 |

- Installed 11 `@opentelemetry/*` packages
- Created `telemetry/function-ids.ts` with 15 typed function ID constants (`brain.*` taxonomy)
- SDK bootstrap: `TracerProvider`, `MeterProvider`, `LoggerProvider` with `BatchSpanProcessor`
- Console exporters for dev, OTLP HTTP exporters for prod (selected by `OTEL_EXPORTER_OTLP_ENDPOINT`)
- Graceful shutdown (`shutdownTelemetry`) wired to SIGTERM/SIGINT
- Logger wrapper (`log.info/warn/error/debug`) backed by OTEL Logs API with pre-init console fallback
- 7 metric instruments (histograms + counters)

### Phase 2: Instrumentation

| Step | Name | Duration |
|------|------|----------|
| 02-01 | HTTP request tracing wrapper | 15:26 - 15:29 |
| 02-02 | AI SDK experimental_telemetry on all LLM calls | 15:27 - 15:36 |

- `withTracing()` higher-order function replaces `withRequestLogging()` in `start-server.ts`
- Root span `brain.http.request` with method/route/status_code attributes
- `httpDuration` histogram and `httpRequests` counter recorded per request
- `x-request-id` response header preserved
- `createTelemetryConfig()` helper with `recordLlmMetrics`/`recordLlmError` callbacks
- All 41 `generateObject`/`streamText` calls instrumented with function IDs from approved taxonomy

### Phase 3: Migration and Cleanup

| Step | Name | Duration |
|------|------|----------|
| 03-01 | Migrate all log call sites to OTEL logger | 15:37 - 15:41 |
| 03-02 | Remove Pino and deprecated files | 15:42 - 15:44 |

- Replaced all `logInfo`/`logWarn`/`logError`/`logDebug` imports across 62 files (~409 call sites)
- `observability.ts` retained only `elapsedMs` and `userFacingError`
- Deleted `logging.ts`, `request-logging.ts`, `request-context.ts`
- Removed `pino` from `package.json` dependencies

## Key Decisions

| Decision | Choice | Rejected Alternative | Rationale |
|----------|--------|---------------------|-----------|
| OTEL integration depth | OTEL-only (ADR-053) | Pino+OTEL hybrid | Single telemetry stack; no dual-write overhead |
| SDK variant | `sdk-trace-base` | `sdk-node` | Simpler, no unnecessary Node.js auto-instrumentation dependencies |
| Export transport | OTLP HTTP | OTLP gRPC | Bun-compatible via native fetch; no gRPC dependency |
| SurrealDB graph traces | Separate concern | Unified with OTEL | Graph traces serve different purpose (audit vs. ops) |
| Dev exporter | Console | None | Immediate visibility without collector infrastructure |

## Files Created

| File | Purpose |
|------|---------|
| `app/src/server/telemetry/init.ts` | SDK bootstrap, provider init, graceful shutdown |
| `app/src/server/telemetry/logger.ts` | OTEL-backed log wrapper with pre-init fallback |
| `app/src/server/telemetry/metrics.ts` | 7 metric instruments (histograms + counters) |
| `app/src/server/telemetry/ai-telemetry.ts` | AI SDK telemetry config factory |
| `app/src/server/telemetry/function-ids.ts` | 15 typed function ID constants |
| `app/src/server/http/instrumentation.ts` | HTTP request tracing (replaces request-logging) |

## Files Removed

| File | Reason |
|------|--------|
| `app/src/server/logging.ts` | Pino configuration -- replaced by OTEL logger |
| `app/src/server/http/request-logging.ts` | Replaced by `instrumentation.ts` |
| `app/src/server/request-context.ts` | AsyncLocalStorage wrapper -- dead code after migration |

## Metrics

- **Total execution time:** ~39 minutes (15:05 - 15:44)
- **Steps:** 7/7 completed, all gates PASS
- **Files modified:** 62 (log migration) + 16 (AI telemetry) + infrastructure
- **Call sites migrated:** ~409 log calls + 41 LLM calls
- **Packages added:** 11 `@opentelemetry/*`
- **Packages removed:** 1 (`pino`)
- **Net file count:** +3 (6 created, 3 removed)

## Configuration

Standard OTEL environment variables control exporter behavior:

| Variable | Effect |
|----------|--------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | When set, enables OTLP HTTP exporters for all signals |
| `OTEL_SERVICE_NAME` | Service name in exported telemetry (default: `brain`) |

No Brain-specific env vars were introduced. All configuration follows OTEL conventions.
