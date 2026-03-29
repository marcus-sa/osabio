## Observability: Wide Events over Scattered Logs

Reference: https://loggingsucks.com

This codebase uses OpenTelemetry for observability. The instrumentation follows the **wide event** pattern — one comprehensive span per request enriched with all business context, instead of scattered `log.info("started")`/`log.info("completed")` pairs.

### How to instrument new routes and handlers

- `withTracing()` in `http/instrumentation.ts` creates a root `osabio.http.request` span per request. It auto-seeds `http.method`, `http.route`, `http.target`, `request.id`, `workspace.id`, `conversation.id`, `duration_ms`, and `http.status_code`.
- Inside any handler, call `trace.getActiveSpan()?.setAttribute(key, value)` to enrich the span with business context. OTel propagates the active span via `AsyncLocalStorageContextManager` — no need to pass context objects through function signatures.
- For background work outside the HTTP span (e.g. `processChatMessage` via `inflight.track()`), create a dedicated span with `tracer.startActiveSpan("brain.<domain>.<operation>", async (span) => { ... })`.

### What to put on spans (wide event attributes)

- **Always**: `workspace.id`, `duration_ms`, any entity IDs involved (conversation, message, task, etc.)
- **Request-specific business context**: `chat.text_length`, `chat.has_attachment`, `chat.user_id`, `chat.message_count`, `search.query_length`, `search.result_count`
- **Outcome metrics**: `chat.entity_count`, `chat.relationship_count`, `chat.assistant_text_length`, `chat.subagent_trace_count`, `chat.onboarding_state`
- **Error context**: `error` (boolean), exception recorded via `span.recordException()`

### What NOT to do

- Do NOT emit separate `log.info` calls for request start and completion — the span already captures timing. Use `log.info`/`log.error` only for events that happen outside a span (startup, shutdown) or for errors that need separate log records (e.g. background job failures).
- Do NOT create custom context propagation wrappers — use `trace.getActiveSpan()` directly, which OTel already supports out of the box.
- Do NOT log bare HTTP attributes (method, status, duration) via `log.info` — these are always on the span.
- Do NOT use `log.debug` for request validation — put validation outcomes as span attributes instead.

### Attribute naming conventions

- Use dot-separated namespaces: `chat.entity_count`, `search.result_count`, `workspace.id`
- Use snake_case within segments: `chat.text_length` not `chat.textLength`
- Prefix domain-specific attributes: `chat.*`, `search.*`, `mcp.*`, `extraction.*`, `observer.*`

### Streaming responses and span lifetime

- `withTracing()` defers `span.end()` only for SSE responses (`content-type: text/event-stream`). Non-streaming responses (JSON, etc.) finalize the span immediately when `handler()` returns.
- The stream wrapper uses `ReadableStream` (not `TransformStream`) because Bun does not propagate `cancel()` through `TransformStream` transformer callbacks.
- Three termination paths are handled: clean close (`pull` sees `done`), client disconnect (`cancel` callback), and upstream error (`pull` catch block). All three call `finalizeSpan()` with a guard flag to prevent double-finalization.
- This means `onFinish` callbacks (e.g. Vercel AI SDK `toUIMessageStreamResponse({ onFinish })`) can safely call `trace.getActiveSpan()?.setAttribute()` — the span is still open.
- Do NOT manually end the span in streaming handlers. `withTracing()` handles it.
- `duration_ms` on streaming spans measures the full stream lifetime, not just Response construction time.
- Do NOT wrap non-SSE response bodies in `ReadableStream` — it inflates `duration_ms` with HTTP transmission time and risks span leaks if the body is never consumed.

### HttpError propagation

- `withTracing()` catches `HttpError` and maps it to the correct `http.status_code` on the span. Handlers should `throw error` (re-throw) for `HttpError` instead of manually returning `jsonError()` — this ensures the span records the error status.
