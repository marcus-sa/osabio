# Four Forces Analysis: OpenTelemetry Observability Migration

## Job 1: Debug LLM Calls

### Demand-Generating
- **Push**: When an extraction produces wrong entities or a chat response hallucinates, Marcus has no way to see what prompt was sent, what the model returned, or how long it took. He must add temporary `logInfo()` calls, redeploy, reproduce the issue, then remove the logging. This takes 30-60 minutes per investigation and pollutes the commit history.
- **Pull**: With OTEL + AI SDK telemetry enabled, every `generateObject()` and `streamText()` call automatically emits spans with `ai.model.id`, `ai.usage.promptTokens`, `ai.usage.completionTokens`, latency, and function ID. Diagnosis becomes: open trace viewer, find the span, read the data. No code changes, no redeployment.

### Demand-Reducing
- **Anxiety**: Will enabling telemetry on all 19+ LLM call sites add meaningful latency? Will prompt/response content in spans leak sensitive user data into telemetry backends? Will the volume of span data overwhelm storage?
- **Habit**: Current workflow of adding `logInfo("extraction.generate.completed", { durationMs, entityCount })` is familiar and sufficient for aggregate monitoring. Pino's structured JSON is greppable with `jq`. Developers know how to read log files.

### Assessment
- Switch likelihood: **High** -- the push is strong because LLM debugging is currently painful and time-consuming
- Key blocker: Anxiety about sensitive data in spans (prompt content)
- Key enabler: AI SDK's `experimental_telemetry` does the heavy lifting -- minimal code changes needed
- Design implication: Must provide clear guidance on what data is captured in spans vs what is redacted. Telemetry metadata should include `functionId` for filtering without exposing raw prompts by default.

---

## Job 2: Request Tracing

### Demand-Generating
- **Push**: A user reports "chat was slow." Marcus opens the Pino logs, finds the request by searching for the endpoint, sees it took 8 seconds total, but has no breakdown. The chat handler called the extraction pipeline, the chat agent, which called the PM subagent, which made 3 tool calls including 2 LLM calls and a SurrealDB query. All logged as flat, unconnected events. Reconstructing the call tree requires mental correlation by timestamp. This regularly takes 20+ minutes.
- **Pull**: OTEL distributed tracing connects all operations in a single trace with parent-child span relationships. Open the trace, see the waterfall: HTTP handler (8s) > extraction (2s) > chat agent (5s) > PM subagent (3s) > generateObject (2.1s) + search_entities (0.8s). Bottleneck identified in seconds.

### Demand-Reducing
- **Anxiety**: Will instrumenting every layer (HTTP, extraction, chat, tools, DB) require massive code changes? Will `AsyncLocalStorage` context propagation conflict with the existing `requestContext`? Will trace context break across the `streamText` SSE boundary?
- **Habit**: `withRequestLogging()` already logs method, route, status, and duration for every HTTP request. `elapsedMs()` provides timing for individual operations. These are "good enough" for most issues.

### Assessment
- Switch likelihood: **High** -- the push is very strong because multi-layer debugging is the most time-consuming operational task
- Key blocker: Anxiety about integration complexity with existing `AsyncLocalStorage` request context
- Key enabler: OTEL SDK's automatic context propagation and the AI SDK's built-in span emission
- Design implication: Must integrate with (not fight) the existing `requestContext` pattern. Consider wrapping `withRequestLogging` to create root HTTP spans that child spans automatically attach to.

---

## Job 3: Operational Monitoring

### Demand-Generating
- **Push**: The system has no metrics. Marcus cannot answer "what is the p95 latency of chat responses?" or "how many extraction calls failed this week?" without writing ad-hoc queries against log files. There is no alerting -- degradation is discovered when users complain.
- **Pull**: OTEL metrics (counters, histograms) exported via OTLP to any compatible backend (Grafana, Datadog, Honeycomb). Dashboards show LLM latency distributions, error rates, throughput. Alerts fire when p95 latency exceeds thresholds.

### Demand-Reducing
- **Anxiety**: Setting up a metrics pipeline (collector, storage, dashboards) is a separate infrastructure project. Will the OTEL SDK add memory overhead or GC pressure in the Bun runtime? Is OTEL mature enough on Bun (not Node)?
- **Habit**: "Tail the logs" works for a single-developer project. Pino's structured output is parseable. The system is early-stage -- formal monitoring feels premature.

### Assessment
- Switch likelihood: **Medium-High** -- push grows as user count grows; currently manageable but will not scale
- Key blocker: Anxiety about Bun runtime compatibility and infrastructure setup burden
- Key enabler: Console exporter in dev means zero infrastructure needed to start. OTLP exporter for prod is additive.
- Design implication: Must work with zero infrastructure in dev (console exporter). Prod setup is a deployment concern, not a code concern. Standard OTEL env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`) keep configuration out of application code.

---

## Job 4: Cost Visibility

### Demand-Generating
- **Push**: The system uses 7 model configurations across extraction, chat, PM agent, observer, analytics, behavior scorer, and embeddings. Marcus has no visibility into which functions consume the most tokens. When the OpenRouter bill increases, he cannot attribute the cost increase to a specific function or model change.
- **Pull**: AI SDK telemetry emits `ai.usage.promptTokens` and `ai.usage.completionTokens` on every span, tagged with `ai.telemetry.functionId`. Aggregate by function to see: extraction uses 60% of tokens, observer uses 25%, chat uses 15%. Optimization effort goes where the money is.

### Demand-Reducing
- **Anxiety**: Will per-function attribution be accurate when functions call each other (chat agent invokes PM subagent which calls generateObject)? Will the overhead of collecting token metrics affect the actual token usage?
- **Habit**: Marcus currently estimates costs by looking at the OpenRouter dashboard, which shows per-model usage but not per-function. "Good enough" for rough budgeting.

### Assessment
- Switch likelihood: **High** -- cost visibility is a direct business concern that grows with usage
- Key blocker: Anxiety about attribution accuracy in nested agent calls
- Key enabler: AI SDK's `functionId` metadata on telemetry spans provides the attribution key out of the box
- Design implication: Must define a clear `functionId` taxonomy (e.g., `osabio.extraction.generate`, `osabio.chat.agent`, `osabio.pm.agent`, `osabio.observer.verify`) that maps to business-meaningful cost categories. Nested calls should attribute tokens to the innermost function, not the parent.
