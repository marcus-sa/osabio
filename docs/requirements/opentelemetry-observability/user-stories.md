# User Stories: OpenTelemetry Observability Migration

---

## US-OT01: OTEL SDK Bootstrap

### Problem
Marcus is the sole operator of the Osabio platform. He wants to add distributed tracing and metrics but currently has no OpenTelemetry infrastructure. He needs the SDK initialized at startup with zero-config dev experience (console exporter) and standard OTLP export for production -- without the SDK failure ever crashing the server.

### Who
- Developer/Operator | Running Osabio locally and in production | Needs observable telemetry from day one of migration

### Solution
Initialize OpenTelemetry TracerProvider, MeterProvider, and LoggerProvider at server startup, before `Bun.serve()`. Console exporters active by default (traces, metrics, and logs). OTLP exporters activate when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Graceful degradation if SDK fails.

### Jobs Served
- Job 1 (Debug LLM Calls) -- prerequisite
- Job 2 (Request Tracing) -- prerequisite
- Job 3 (Operational Monitoring) -- prerequisite
- Job 4 (Cost Visibility) -- prerequisite

### Domain Examples
#### 1: Dev startup with console exporter
Marcus runs `bun run dev` without any OTEL env vars set. The server starts, TracerProvider initializes with ConsoleSpanExporter, and he sees span output in the terminal when the first request arrives.

#### 2: Prod startup with OTLP exporter
Marcus sets `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318` and `OTEL_SERVICE_NAME=brain`. The server starts, TracerProvider initializes with OTLPTraceExporter, spans are sent to the collector. Console exporter is not active.

#### 3: SDK initialization failure
Marcus upgrades Bun to a version with a breaking change in the async hooks API. The OTEL SDK fails to initialize. The server starts anyway, all tracer/meter calls return no-op instances, and a startup warning is logged to console.

### UAT Scenarios (BDD)

#### Scenario: Console exporter active in dev
```
Given Marcus starts the Osabio server with no OTEL environment variables set
When the first HTTP request is processed
Then span data for the request appears in the terminal console output
And the span includes service.name "brain"
```

#### Scenario: OTLP exporter active in prod
```
Given Marcus has set OTEL_EXPORTER_OTLP_ENDPOINT to "http://collector:4318"
And Marcus has set OTEL_SERVICE_NAME to "brain"
When the Osabio server starts
Then the TracerProvider is configured with OTLPTraceExporter
And spans are exported to the configured endpoint
And no spans appear in the console
```

#### Scenario: Graceful degradation on SDK failure
```
Given the OTEL SDK fails to initialize due to a runtime incompatibility
When the Osabio server starts
Then the server starts successfully without crashing
And a warning message appears in the console: "OTEL SDK failed to initialize, telemetry disabled"
And all subsequent tracer calls return no-op spans
```

#### Scenario: All three providers initialize (Tracer, Meter, Logger)
```
Given Marcus starts the Osabio server with default configuration
When the server has started
Then TracerProvider, MeterProvider, and LoggerProvider are all active
And metric instruments can be created without errors
And the OTEL logger can emit log records
```

### Acceptance Criteria
- [ ] TracerProvider, MeterProvider, and LoggerProvider initialize before `Bun.serve()` starts
- [ ] Console exporter is the default when no OTLP endpoint is configured
- [ ] OTLP exporter activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
- [ ] SDK initialization failure does not prevent server startup
- [ ] Service name defaults to "brain" and is overridable via `OTEL_SERVICE_NAME`

### Technical Notes
- OTEL SDK must be compatible with Bun runtime (test during spike if needed)
- Initialization must run before any route handlers are registered
- Standard OTEL env vars per spec: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`

### Dependencies
- None (first story in the chain)

---

## US-OT02: Pino Removal & OTEL Logs Migration

### Problem
Marcus currently has Pino (v10.3.1) as the structured logging library with `logInfo`/`logWarn`/`logError`/`logDebug` wrappers used across the codebase. With OTEL replacing structured event logging via spans, Pino becomes redundant. However, startup messages (before OTEL initializes) and non-request-scoped messages still need a simple output path.

### Who
- Developer/Operator | Maintaining the codebase | Needs clean migration without losing startup visibility

### Solution
Remove Pino dependency and migrate all `logInfo`/`logWarn`/`logError`/`logDebug` call sites to the OTEL Logs API. A thin wrapper provides ergonomic `log.info()`/`log.warn()`/`log.error()`/`log.debug()` functions that call `logger.emit()` on the OTEL logger (`logs.getLogger('osabio-server')`). Logs emitted within an active span automatically inherit `trace_id` and `span_id` for trace correlation. LoggerProvider is configured alongside TracerProvider and MeterProvider: console log exporter in dev, OTLP log exporter in prod. Startup messages emitted before OTEL initialization gracefully fall back to `console.log`.

### Jobs Served
- All jobs (migration prerequisite -- removes the old system)

### Domain Examples
#### 1: Startup message migration (pre-init graceful degradation)
`logInfo("server.started", { port: 3000 })` becomes `log.info("server.started", { port: 3000 })`. If OTEL SDK has not yet initialized, the wrapper falls back to `console.log("[brain] server.started { port: 3000 }")`. After initialization, the same call emits a structured OTEL log record.

#### 2: Request-scoped log with automatic trace correlation
`logInfo("extraction.generate.completed", { durationMs: 2341, entityCount: 5 })` becomes `log.info("extraction.generate.completed", { durationMs: 2341, entityCount: 5 })`. Because this runs within an active extraction span, the emitted OTEL log record automatically includes the `trace_id` and `span_id` from the current context. In a trace backend, Marcus can see this log alongside its parent span.

#### 3: Error logging migration
`logError("observer.llm.error", error, { functionId: "verify" })` becomes `log.error("observer.llm.error", { error: error.message, functionId: "verify" })`. The OTEL log record has `severityText: "ERROR"` and carries the active `trace_id`/`span_id`. Span-level exception recording (`span.recordException(error)`) is used in addition for trace-aware error visibility.

#### 4: Debug-level logging
`logDebug("chat.tool.resolved", { toolName: "search_entities", resultCount: 12 })` becomes `log.debug("chat.tool.resolved", { toolName: "search_entities", resultCount: 12 })`. The OTEL log record has `severityText: "DEBUG"`. Debug logs can be filtered at the exporter/collector level without code changes.

### UAT Scenarios (BDD)

#### Scenario: Startup messages appear without Pino
```
Given Pino has been removed from the project dependencies
When Marcus starts the Osabio server with bun run dev
Then startup messages (port, database connection, migration status) appear in the console
And no Pino-formatted JSON lines appear in the output
```

#### Scenario: No remaining Pino imports
```
Given Marcus has completed the Pino removal
When he searches the codebase for pino imports
Then zero files import from "pino" or reference the Pino logger instance
And the pino package is not listed in package.json dependencies
```

#### Scenario: Request events captured as OTEL log records with trace correlation
```
Given the extraction pipeline processes a message from workspace "ws-marcus-dev"
And the extraction runs within an active OTEL span
When log.info("extraction.generate.completed", { entityCount: 5 }) is called
Then an OTEL log record is emitted with body "extraction.generate.completed"
And the log record includes attribute entityCount: 5
And the log record includes trace_id matching the active trace
And the log record includes span_id matching the extraction span
```

#### Scenario: Log severity levels map correctly
```
Given the OTEL LoggerProvider is active
When log.debug(), log.info(), log.warn(), and log.error() are called
Then OTEL log records are emitted with severityText "DEBUG", "INFO", "WARN", and "ERROR" respectively
And severityNumber maps to the OTEL severity number specification
```

#### Scenario: Logs exported via same OTEL pipeline as traces and metrics
```
Given Marcus has set OTEL_EXPORTER_OTLP_ENDPOINT to "http://collector:4318"
When application logs are emitted during request processing
Then log records are exported to the OTLP endpoint alongside traces and metrics
And no logs appear in the console
```

#### Scenario: Startup logs work before OTEL SDK initialization
```
Given the OTEL SDK has not yet initialized (early in server bootstrap)
When log.info("config.loaded", { port: 3000 }) is called
Then the message appears in the console via fallback
And the server does not crash due to uninitialized LoggerProvider
And after OTEL initializes, subsequent log calls emit OTEL log records
```

### Acceptance Criteria
- [ ] `pino` removed from `package.json` dependencies
- [ ] Zero files import from "pino" or reference Pino logger
- [ ] `logInfo`, `logWarn`, `logError`, `logDebug` Pino-based functions removed from `observability.ts`
- [ ] `app/src/server/logging.ts` removed (Pino configuration)
- [ ] Thin OTEL logger wrapper created (e.g. `app/src/server/telemetry/logger.ts`) providing `log.info()`/`log.warn()`/`log.error()`/`log.debug()`
- [ ] All former `logInfo`/`logWarn`/`logError`/`logDebug` call sites migrated to OTEL logger wrapper
- [ ] Log records emitted within a traced context include `trace_id` and `span_id`
- [ ] Log severity levels correctly map: debug/info/warn/error
- [ ] Logs export via console in dev and OTLP when endpoint is configured
- [ ] Startup messages emitted before OTEL initialization fall back to console without crashing

### Technical Notes
- Migration is mechanical: each `logInfo(event, data)` becomes `log.info(event, data)` using the OTEL wrapper
- The wrapper uses `@opentelemetry/api-logs`: `logs.getLogger('osabio-server').emit({ body, severityText, attributes })`
- Logs within an active span automatically inherit trace context -- no manual `trace_id` injection needed
- The wrapper should check if LoggerProvider is initialized; if not, fall back to `console` methods
- `elapsedMs()` utility may be retained if useful outside span contexts
- `userFacingError()` in observability.ts is unrelated to logging -- keep it
- Some call sites may also add span events (`span.addEvent()`) in addition to OTEL logs where trace-level detail is valuable

### Dependencies
- US-OT01 (OTEL SDK Bootstrap) -- must have TracerProvider before migrating log calls to spans

---

## US-OT03: AI SDK Telemetry on All LLM Calls

### Problem
Marcus has 19+ LLM call sites across extraction, chat, observer, PM agent, behavior scorer, onboarding, intent authorization, and analytics. When an LLM call produces wrong results, he has no visibility into model ID, token usage, latency, or function context without adding temporary logging and redeploying. He also cannot attribute token costs to specific functions.

### Who
- Developer/Operator | Debugging LLM behavior and managing costs | Needs per-call visibility without code changes

### Solution
Enable `experimental_telemetry` on every `generateObject`, `streamText`, and `ToolLoopAgent` call with a consistent `functionId` from the defined taxonomy and contextual metadata (workspaceId, messageId where available).

### Jobs Served
- Job 1 (Debug LLM Calls) -- primary
- Job 4 (Cost Visibility) -- primary

### Domain Examples
#### 1: Extraction call with telemetry
The extraction pipeline's `generateObject()` call in `app/src/server/extraction/` gets `experimental_telemetry: { isEnabled: true, functionId: 'osabio.extraction.generate', metadata: { workspaceId: 'ws-marcus-dev', messageId: 'msg-a1b2c3' } }`. The resulting span shows model `anthropic/claude-3.5-haiku`, 1847 prompt tokens, 423 completion tokens, 2341ms duration.

#### 2: Chat agent streaming with telemetry
The `streamText()` call in `app/src/server/chat/handler.ts` gets `experimental_telemetry: { isEnabled: true, functionId: 'osabio.chat.stream', metadata: { workspaceId: 'ws-marcus-dev', conversationId: 'conv-x7y8z9' } }`. The span captures the full streaming duration, total tokens, and model ID.

#### 3: PM subagent with telemetry
The PM agent's `generateObject()` in `app/src/server/agents/pm/agent.ts` gets `functionId: 'osabio.pm.agent'`. When Marcus sees high token costs, he can filter spans by `osabio.pm.agent` to see exactly how many tokens the PM agent consumes per invocation.

### UAT Scenarios (BDD)

#### Scenario: Extraction span emits token usage
```
Given a user sends a message containing "We decided to use SurrealDB for the graph layer" to workspace "ws-marcus-dev"
When the extraction pipeline runs generateObject with experimental_telemetry enabled
Then a span is emitted with ai.telemetry.functionId "osabio.extraction.generate"
And the span includes ai.usage.promptTokens > 0
And the span includes ai.usage.completionTokens > 0
And the span includes ai.model.id matching the configured extraction model
```

#### Scenario: All LLM call sites have telemetry enabled
```
Given Marcus reviews all generateObject and streamText calls in the codebase
When he checks each call for experimental_telemetry configuration
Then every call includes isEnabled: true
And every call includes a functionId from the defined taxonomy
```

#### Scenario: Function ID enables cost attribution
```
Given the system has processed 100 chat messages in workspace "ws-marcus-dev"
When Marcus queries token usage spans grouped by ai.telemetry.functionId
Then he can see separate token totals for extraction.generate, chat.stream, pm.agent, and other functions
And the sum of per-function tokens matches the total token usage
```

#### Scenario: Telemetry metadata enables trace correlation
```
Given a chat message "msg-a1b2c3" triggers both extraction and chat agent LLM calls
When Marcus searches spans by metadata messageId "msg-a1b2c3"
Then he finds both the extraction span and the chat agent span
And both spans are linked to the same parent HTTP trace
```

#### Scenario: Telemetry coexists with AI SDK devtools middleware
```
Given the Osabio server uses @ai-sdk/devtools middleware on all model configurations
When experimental_telemetry is also enabled on a generateObject call
Then both devtools middleware and telemetry spans function without conflict
And the span data is complete (model, tokens, duration)
```

### Acceptance Criteria
- [ ] All `generateObject` calls (15 sites) include `experimental_telemetry` with `isEnabled: true` and valid `functionId`
- [ ] All `streamText` calls (2 sites) include `experimental_telemetry` with `isEnabled: true` and valid `functionId`
- [ ] `ToolLoopAgent` calls include telemetry configuration
- [ ] Function IDs follow the `brain.{domain}.{operation}` taxonomy
- [ ] Telemetry metadata includes `workspaceId` where available
- [ ] Telemetry does not conflict with `@ai-sdk/devtools` middleware

### Technical Notes
- Consider a factory function `createTelemetryConfig(functionId, metadata)` to reduce boilerplate
- `@ai-sdk/devtools` middleware wraps models in `dependencies.ts` -- telemetry is per-call, not per-model, so they should coexist
- Token metadata fields come from AI SDK spans automatically: `ai.usage.promptTokens`, `ai.usage.completionTokens`

### Dependencies
- US-OT01 (OTEL SDK Bootstrap) -- TracerProvider must be active for AI SDK to emit spans

---

## US-OT04: HTTP Request Tracing

### Problem
Marcus currently has `withRequestLogging()` which logs method, route, status, and duration as flat Pino events. When a request is slow, he sees the total duration but cannot see which internal operation (extraction? LLM call? DB query?) consumed the time. He must mentally correlate timestamps across separate log lines.

### Who
- Developer/Operator | Diagnosing slow or failed requests | Needs a connected trace showing the full request waterfall

### Solution
Replace `withRequestLogging()` with an OTEL-based request wrapper that creates a root span for each HTTP request. Internal operations (extraction, chat processing, tool calls) create child spans that automatically nest under the root. The result is a trace waterfall showing the complete request lifecycle.

### Jobs Served
- Job 2 (Request Tracing) -- primary
- Job 3 (Operational Monitoring) -- supports HTTP metrics

### Domain Examples
#### 1: Chat message request trace
Marcus sends a chat message. The root span `osabio.http.request POST /api/chat/messages` shows 8234ms total. Child spans show: `osabio.chat.ingress` (45ms), `osabio.chat.process` (8180ms) containing `osabio.extraction.pipeline` (2100ms) and `osabio.chat.agent` (5200ms). The chat agent span further contains `ai.streamText` (4100ms) and `osabio.chat.tool.invoke_pm_agent` (2800ms). Bottleneck: chat agent LLM call at 50% of total.

#### 2: Entity search request trace
Marcus searches for entities. Root span `osabio.http.request GET /api/entities/search` shows 120ms. Child span `brain.entity.fulltext-search` shows 85ms. No LLM calls involved. Fast path confirmed.

#### 3: Failed request trace
A chat message fails because SurrealDB is unreachable. Root span `osabio.http.request POST /api/chat/messages` shows status ERROR. Child span `osabio.chat.persist-message` has `span.recordException(ConnectionUnavailableError)`. Marcus sees exactly which operation failed without reading through log lines.

### UAT Scenarios (BDD)

#### Scenario: Root span created for every HTTP request
```
Given Marcus sends a POST request to /api/chat/messages in workspace "ws-marcus-dev"
When the request completes
Then a root span "osabio.http.request" exists with attributes method: "POST", route: "/api/chat/messages"
And the span duration reflects the total request processing time
And the span status reflects the HTTP response status
```

#### Scenario: Child spans nest under root span
```
Given Marcus sends a chat message that triggers extraction and chat agent processing
When the request completes
Then the extraction pipeline span is a child of the root HTTP span
And the chat agent span is a child of the root HTTP span
And the AI SDK LLM spans are children of their respective pipeline spans
```

#### Scenario: Request ID preserved as span attribute
```
Given Marcus sends a request that generates requestId "req-d4e5f6"
When the request trace is recorded
Then the root span includes attribute requestId: "req-d4e5f6"
And the requestId is available for backward-compatible log correlation
```

#### Scenario: Failed request records exception
```
Given the SurrealDB connection is unavailable
When Marcus sends a POST request to /api/chat/messages
Then the root span status is ERROR
And the span contains a recorded exception with the ConnectionUnavailableError details
And the span duration reflects the time until failure
```

### Acceptance Criteria
- [ ] Every HTTP route handler creates a root span with method, route, and status attributes
- [ ] Pipeline stages (extraction, chat processing, tool calls) create child spans
- [ ] AI SDK telemetry spans automatically nest under the active OTEL context
- [ ] `requestId` is carried as a span attribute on the root span
- [ ] Failed requests record exceptions on the span with ERROR status
- [ ] `withRequestLogging()` is removed (replaced by span-based tracing)

### Technical Notes
- Must propagate OTEL context through `AsyncLocalStorage` boundaries
- SSE streaming: root span may end when headers are sent; streaming content spans are separate
- `request-context.ts` coexistence -- do not remove `AsyncLocalStorage`, layer OTEL context alongside it
- Consider whether `elapsedMs()` is still needed or if span timing replaces it entirely

### Dependencies
- US-OT01 (OTEL SDK Bootstrap) -- TracerProvider must be active
- US-OT02 (Pino Removal) -- `withRequestLogging` is removed in this story

---

## US-OT05: Operational Metrics

### Problem
Marcus has no quantitative health metrics for the Osabio platform. He cannot answer "what is the p95 latency of chat responses?" or "how many extraction errors occurred this week?" without manually analyzing log files. There is no alerting -- degradation is discovered when users report issues.

### Who
- Developer/Operator | Monitoring production health | Needs continuous quantitative metrics with alerting capability

### Solution
Define OTEL metric instruments (histograms and counters) for LLM call duration, token usage, error counts, HTTP request duration, and request volume. Record metrics at instrumentation points. Export via console in dev and OTLP in prod.

### Jobs Served
- Job 3 (Operational Monitoring) -- primary
- Job 4 (Cost Visibility) -- supports token counters

### Domain Examples
#### 1: LLM latency histogram
After processing 500 chat messages, Marcus queries the `osabio.llm.duration` histogram filtered by `functionId=osabio.chat.stream`. He sees p50=3200ms, p95=5800ms, p99=8400ms. The p95 is above his 5000ms target -- he investigates prompt length.

#### 2: Token counter for cost projection
Marcus queries `osabio.llm.tokens.prompt` and `osabio.llm.tokens.completion` counters grouped by `functionId` over the past 7 days. Extraction consumed 1.2M prompt tokens and 340K completion tokens. Chat consumed 890K/520K. He calculates weekly cost at $14.95 and projects monthly at $64.

#### 3: HTTP error rate detection
The `osabio.http.requests` counter with `status_code=500` shows 15 errors in the past hour, up from a baseline of 0-2. The `osabio.http.duration` histogram for the affected route shows p50 jumped from 200ms to 8000ms. SurrealDB connection issue confirmed.

### UAT Scenarios (BDD)

#### Scenario: LLM duration histogram records call latency
```
Given the extraction pipeline processes a message with a generateObject call taking 2341ms
When the call completes
Then the osabio.llm.duration histogram records a value of 2341
And the recording includes attributes functionId: "osabio.extraction.generate" and model matching the configured extraction model
```

#### Scenario: Token counters increment on LLM call
```
Given a generateObject call uses 1847 prompt tokens and 423 completion tokens
When the call completes
Then osabio.llm.tokens.prompt counter increments by 1847 with functionId attribute
And osabio.llm.tokens.completion counter increments by 423 with functionId attribute
```

#### Scenario: HTTP request metrics recorded
```
Given Marcus sends a GET request to /api/entities/search that returns 200 in 120ms
When the request completes
Then osabio.http.requests counter increments by 1 with attributes method: "GET", route: "/api/entities/search", status_code: "200"
And osabio.http.duration histogram records 120 with the same attributes
```

#### Scenario: Error counter increments on LLM failure
```
Given a generateObject call to the observer verification fails with a model timeout
When the error is caught
Then osabio.llm.errors counter increments by 1
And the recording includes attributes functionId: "osabio.observer.verify" and error_type: "timeout"
```

#### Scenario: Metrics export via OTLP
```
Given Marcus has set OTEL_EXPORTER_OTLP_ENDPOINT to "http://collector:4318"
When metrics have been recorded over a 60-second interval
Then metric data is exported to the OTLP endpoint
And the export includes all defined metric instruments
```

### Acceptance Criteria
- [ ] `osabio.llm.duration` histogram records latency for every LLM call with functionId and model attributes
- [ ] `osabio.llm.tokens.prompt` and `osabio.llm.tokens.completion` counters record token usage per LLM call
- [ ] `osabio.llm.errors` counter records LLM failures with error_type attribute
- [ ] `osabio.http.duration` histogram records request latency with method, route, status_code
- [ ] `osabio.http.requests` counter records request volume with method, route, status_code
- [ ] `osabio.extraction.entities` counter records entity volume by type
- [ ] Metrics export to console in dev and OTLP when endpoint is configured

### Technical Notes
- Metric instruments should be created once at initialization, not per-request
- Token usage available from AI SDK telemetry span attributes -- may need integration hook to also record as metrics
- Consider OTEL SDK's `View` API for histogram bucket configuration
- Export interval configurable via `OTEL_METRIC_EXPORT_INTERVAL` (default 60s)

### Dependencies
- US-OT01 (OTEL SDK Bootstrap) -- MeterProvider must be active
- US-OT03 (AI SDK Telemetry) -- token usage comes from AI SDK spans
