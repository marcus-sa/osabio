# Acceptance Criteria (Gherkin): OpenTelemetry Observability Migration

## Feature: OTEL SDK Bootstrap

```gherkin
Feature: OpenTelemetry SDK initialization and exporter configuration
  As a developer/operator of the Brain platform
  I need the OTEL SDK to initialize at startup with appropriate exporters
  So that all downstream instrumentation has a functioning telemetry pipeline

  Background:
    Given the Brain server application is configured to start

  Scenario: Console exporter active by default in development
    Given no OTEL environment variables are set
    When the Brain server starts and processes a request to POST /api/chat/messages
    Then span data appears in the terminal console output
    And the span includes resource attribute service.name "brain"
    And the span includes the HTTP method and route

  Scenario: OTLP exporter active when endpoint is configured
    Given OTEL_EXPORTER_OTLP_ENDPOINT is set to "http://collector:4318"
    And OTEL_SERVICE_NAME is set to "brain-prod"
    When the Brain server starts
    Then the TracerProvider uses OTLPTraceExporter targeting "http://collector:4318"
    And the MeterProvider uses OTLPMetricExporter targeting "http://collector:4318"
    And the LoggerProvider uses OTLPLogExporter targeting "http://collector:4318"
    And no span or log data appears in the console

  Scenario: Graceful degradation when OTEL SDK fails to initialize
    Given the Bun runtime has an incompatibility with the OTEL async hooks API
    When the Brain server starts
    Then the server starts successfully and accepts HTTP requests
    And a warning "OTEL SDK failed to initialize, telemetry disabled" appears in console
    And all tracer.startSpan calls return no-op spans
    And all meter.createHistogram calls return no-op instruments
    And all logger.emit calls are silently discarded

  Scenario: All three providers initialize (Tracer, Meter, Logger)
    Given default server configuration
    When the Brain server starts
    Then TracerProvider is active and can create spans
    And MeterProvider is active and can create metric instruments
    And LoggerProvider is active and can emit log records
    And all three providers use the same service.name resource attribute

  Scenario: OTEL initialization completes before route handlers register
    Given the server startup sequence
    When the application bootstrap runs
    Then the OTEL SDK initialization completes before Bun.serve() is called
    And the first HTTP request processed has an active TracerProvider
```

## Feature: Pino Removal and OTEL Logs Migration

```gherkin
Feature: Remove Pino structured logging and replace with OTEL Logs API
  As a developer maintaining the Brain codebase
  I need Pino removed and all logging migrated to the OTEL Logs API
  So that the codebase has a single telemetry system with trace-correlated logs

  Scenario: Pino dependency removed from project
    Given the migration is complete
    When the project dependencies are inspected
    Then "pino" does not appear in package.json dependencies or devDependencies
    And no source file contains an import from "pino"
    And no source file references the Pino logger instance

  Scenario: Startup messages visible without Pino
    Given Pino has been removed
    When Marcus starts the Brain server with "bun run dev"
    Then the server port number appears in console output
    And the database connection status appears in console output
    And migration status appears in console output
    And no output uses Pino's JSON format

  Scenario: logInfo, logWarn, logError, logDebug Pino wrappers removed
    Given the migration is complete
    When the codebase is searched for logInfo, logWarn, logError, or logDebug function definitions
    Then zero Pino-based definitions are found
    And all former call sites have been migrated to the OTEL logger wrapper

  Scenario: Request-scoped events migrated to OTEL log records
    Given the extraction pipeline processes a message in workspace "ws-marcus-dev"
    And the extraction takes 2341ms and produces 5 entities
    When log.info("extraction.generate.completed", { entityCount: 5 }) is called
    Then an OTEL log record is emitted with body "extraction.generate.completed"
    And the log record includes attribute entityCount: 5
    And no Pino logInfo call is made for this event

  Scenario: Error events migrated to OTEL error logs
    Given the observer verification LLM call fails with a timeout error
    When the error is caught
    Then log.error() emits an OTEL log record with severityText "ERROR"
    And the observer span records the exception with the timeout error details
    And the span status is set to ERROR
    And no Pino logError call is made for this event

  Scenario: Log output includes trace_id and span_id within traced context
    Given the OTEL SDK is initialized with TracerProvider and LoggerProvider active
    And an HTTP request to POST /api/chat/messages creates a root span
    When log.info("chat.processing.started", { conversationId: "conv-x7y8z9" }) is called within the request handler
    Then the emitted OTEL log record includes trace_id matching the root span's trace
    And the log record includes span_id matching the active span
    And the trace_id and span_id are visible in the exported log output

  Scenario: Log severity levels map correctly to OTEL severity
    Given the OTEL LoggerProvider is active
    When log.debug("debug message") is called
    Then the log record has severityText "DEBUG" and severityNumber 5
    When log.info("info message") is called
    Then the log record has severityText "INFO" and severityNumber 9
    When log.warn("warn message") is called
    Then the log record has severityText "WARN" and severityNumber 13
    When log.error("error message") is called
    Then the log record has severityText "ERROR" and severityNumber 17

  Scenario: Logs exported via same OTEL exporter pipeline as traces
    Given Marcus has set OTEL_EXPORTER_OTLP_ENDPOINT to "http://collector:4318"
    When application logs are emitted during request processing
    Then log records are exported to the OTLP endpoint via OTLPLogExporter
    And no log output appears in the console
    When no OTEL_EXPORTER_OTLP_ENDPOINT is set
    Then log records appear in the console via ConsoleLogRecordExporter

  Scenario: Startup logs work before OTEL SDK is fully initialized
    Given the server bootstrap sequence has not yet called OTEL SDK init
    When log.info("config.loaded", { port: 3000, db: "surreal" }) is called during early config
    Then the message appears in console output via graceful fallback
    And no error or crash occurs due to uninitialized LoggerProvider
    And after OTEL SDK initializes, subsequent log.info() calls emit OTEL log records

  Scenario: Logs without active span omit trace context gracefully
    Given the OTEL LoggerProvider is active
    And no span is currently active (e.g. a background timer callback)
    When log.info("scheduler.tick", { cycle: 42 }) is called
    Then an OTEL log record is emitted with body "scheduler.tick"
    And the log record does not include trace_id or span_id
    And no error occurs
```

## Feature: AI SDK Telemetry on All LLM Calls

```gherkin
Feature: Enable experimental_telemetry on every AI SDK call
  As an operator debugging LLM behavior and tracking costs
  I need every LLM call to emit structured telemetry spans
  So that I can inspect any call's model, tokens, latency, and function context

  Background:
    Given the OTEL SDK is initialized with TracerProvider active

  Scenario: Extraction generateObject emits telemetry span
    Given a user sends message "We need to migrate the billing API to tRPC" to workspace "ws-marcus-dev"
    When the extraction pipeline calls generateObject with experimental_telemetry enabled
    Then a span is emitted with attribute ai.telemetry.functionId "brain.extraction.generate"
    And the span includes ai.model.id matching the configured EXTRACTION_MODEL
    And the span includes ai.usage.promptTokens as a positive integer
    And the span includes ai.usage.completionTokens as a positive integer
    And the span includes telemetry metadata workspaceId "ws-marcus-dev"

  Scenario: Chat agent streamText emits telemetry span
    Given Marcus has an active conversation in workspace "ws-marcus-dev"
    When the chat agent calls streamText with experimental_telemetry enabled
    Then a span is emitted with attribute ai.telemetry.functionId "brain.chat.stream"
    And the span duration covers the full streaming time
    And the span includes total token usage after streaming completes

  Scenario: PM subagent generateObject emits telemetry span
    Given the chat agent invokes the PM subagent with intent "plan_work"
    When the PM agent calls generateObject with experimental_telemetry enabled
    Then a span is emitted with attribute ai.telemetry.functionId "brain.pm.agent"
    And the span is a child of the chat agent's tool invocation span

  Scenario: Observer verification emits telemetry span
    Given the observer scans the graph and finds a potential contradiction
    When it calls generateObject to verify the observation
    Then a span is emitted with attribute ai.telemetry.functionId "brain.observer.verify"
    And the span includes the model ID and token counts

  Scenario: Behavior scorer emits telemetry span
    Given a behavior scoring request is made for workspace "ws-marcus-dev"
    When the scorer calls generateObject with experimental_telemetry enabled
    Then a span is emitted with attribute ai.telemetry.functionId "brain.behavior.score"

  Scenario: All call sites verified for telemetry coverage
    Given a developer audits all generateObject and streamText calls in the codebase
    When each call is inspected
    Then every call includes experimental_telemetry with isEnabled: true
    And every call has a functionId from the approved taxonomy starting with "brain."
    And no call uses a functionId outside the defined taxonomy

  Scenario: Telemetry coexists with AI SDK devtools middleware
    Given the extraction model is wrapped with @ai-sdk/devtools middleware
    And experimental_telemetry is enabled on the generateObject call
    When the call executes
    Then both devtools tracing and OTEL telemetry spans are emitted
    And the OTEL span includes complete token usage and model information

  Scenario: Telemetry metadata enables cross-call correlation
    Given message "msg-r8s9t0" triggers both extraction and chat agent LLM calls
    When both calls complete
    Then both spans include telemetry metadata messageId "msg-r8s9t0"
    And a trace query filtering by messageId returns both spans
```

## Feature: HTTP Request Distributed Tracing

```gherkin
Feature: Distributed tracing for HTTP request lifecycle
  As an operator diagnosing slow or failed requests
  I need a connected trace showing the full request waterfall
  So that I can pinpoint where time is spent without correlating log timestamps

  Background:
    Given the OTEL SDK is initialized with TracerProvider active

  Scenario: Root span created for chat message request
    Given Marcus sends a POST request to /api/chat/messages in workspace "ws-marcus-dev"
    When the request completes with status 200
    Then a root span "brain.http.request" exists
    And the span has attribute http.method: "POST"
    And the span has attribute http.route: "/api/chat/messages"
    And the span has attribute http.status_code: 200
    And the span duration reflects the total request time

  Scenario: Pipeline child spans nest under root
    Given Marcus sends a chat message that triggers extraction and chat agent
    When the request completes
    Then span "brain.extraction.pipeline" is a child of the root HTTP span
    And span "brain.chat.agent" is a child of the root HTTP span
    And the AI SDK span for extraction is a child of "brain.extraction.pipeline"
    And all child span start/end times fall within the root span duration

  Scenario: Trace waterfall reveals bottleneck
    Given Marcus sends a chat message where the chat agent LLM call takes 4100ms
    And the total request takes 8234ms
    When Marcus views the trace waterfall
    Then the chat agent LLM span shows 4100ms (approximately 50% of total)
    And Marcus can identify the LLM call as the bottleneck without timestamp correlation

  Scenario: Request ID preserved for backward compatibility
    Given the request context assigns requestId "req-u1v2w3"
    When the root HTTP span is created
    Then the span includes attribute requestId: "req-u1v2w3"

  Scenario: Failed request traced with exception
    Given the SurrealDB connection is unavailable
    When Marcus sends a POST request to /api/chat/messages
    Then the root span status is ERROR
    And the failing child span records a ConnectionUnavailableError exception
    And the trace shows exactly which operation failed and its parent chain

  Scenario: Entity search request traced
    Given Marcus sends a GET request to /api/entities/search?q=authentication
    When the request completes with status 200 in 120ms
    Then a root span "brain.http.request" exists with method GET and route "/api/entities/search"
    And the span duration is approximately 120ms

  Scenario: Context propagation across async boundaries
    Given a chat message handler spawns async work tracked via inflight tracker
    When the async extraction pipeline runs in a different async context
    Then the extraction span still correctly parents under the root HTTP span
    And the OTEL context propagates through AsyncLocalStorage boundaries
```

## Feature: Operational Metrics

```gherkin
Feature: OTEL metrics for health monitoring and cost attribution
  As an operator monitoring production health
  I need quantitative metrics on LLM calls, HTTP requests, and entity extraction
  So that I can detect degradation and attribute costs to specific functions

  Background:
    Given the OTEL SDK is initialized with MeterProvider active

  Scenario: LLM call latency recorded as histogram
    Given the extraction pipeline calls generateObject and the call takes 2341ms
    When the call completes successfully
    Then the brain.llm.duration histogram records value 2341
    And the recording has attribute functionId: "brain.extraction.generate"
    And the recording has attribute model matching the configured EXTRACTION_MODEL

  Scenario: Prompt tokens recorded as counter
    Given a generateObject call uses 1847 prompt tokens
    When the call completes
    Then brain.llm.tokens.prompt increments by 1847
    And the increment has attribute functionId matching the call's function ID

  Scenario: Completion tokens recorded as counter
    Given a generateObject call produces 423 completion tokens
    When the call completes
    Then brain.llm.tokens.completion increments by 423
    And the increment has attribute functionId matching the call's function ID

  Scenario: LLM error recorded as counter
    Given a generateObject call to brain.observer.verify fails with error type "timeout"
    When the error is caught
    Then brain.llm.errors increments by 1
    And the increment has attributes functionId: "brain.observer.verify" and error_type: "timeout"

  Scenario: HTTP request duration recorded as histogram
    Given a GET request to /api/entities/search completes in 120ms with status 200
    When the response is sent
    Then brain.http.duration histogram records value 120
    And the recording has attributes method: "GET", route: "/api/entities/search", status_code: "200"

  Scenario: HTTP request count recorded as counter
    Given 50 requests have been processed in the last minute
    When the metric export interval fires
    Then brain.http.requests counter reflects 50 total increments
    And each increment has method, route, and status_code attributes

  Scenario: Entity extraction count recorded
    Given the extraction pipeline produces 3 task entities and 2 decision entities
    When the entities are persisted
    Then brain.extraction.entities increments by 3 with attribute entity_type: "task"
    And brain.extraction.entities increments by 2 with attribute entity_type: "decision"

  Scenario: Token counters enable cost attribution by function
    Given the system has processed 100 messages over 7 days
    When Marcus queries brain.llm.tokens.prompt grouped by functionId
    Then he sees separate totals for each function (extraction.generate, chat.stream, pm.agent, etc.)
    And the per-function totals sum to the overall total

  @property
  Scenario: Metric recording does not block request processing
    Given the system is handling concurrent requests
    Then metric recording operations complete in under 1ms
    And no request is delayed by metric export operations
    And metric export runs asynchronously on a separate interval

  @property
  Scenario: Metrics survive OTLP endpoint outage
    Given the OTLP endpoint becomes unreachable
    Then the server continues processing requests without errors
    And metrics are buffered in memory
    And metric export resumes when the endpoint is reachable again
```
