# Journey: OpenTelemetry Observability Migration -- Visual Map

## Persona

**Marcus** -- Solo developer/operator of the Brain knowledge graph platform. Runs the system locally in development and deploys to production. Needs to debug LLM calls, trace requests, monitor health, and understand costs. Uses terminal, browser-based trace viewers, and dashboards.

## Emotional Arc

```
Confidence
    ^
    |                                                          **** CONFIDENT
    |                                                     ****
    |                                                ****
    |                                        ** CAPABLE **
    |                                   ****
    |                              ****
    |                    **** ORIENTED ****
    |               ****
    |          ****
    |  ** UNCERTAIN **
    +-----------------------------------------------------------> Journey Steps
       [1.Setup]  [2.Instrument]  [3.Trace]  [4.Debug]  [5.Monitor]
```

Start: Uncertain -- "Will this work with Bun? How much code changes?"
Middle: Oriented -- "I see spans flowing. The AI SDK telemetry just works."
End: Confident -- "I can diagnose any issue in minutes. I know exactly where costs go."

---

## Step 1: OTEL SDK Setup & Configuration

**Action**: Install OTEL packages, configure providers, set up exporters

```
+-- Step 1: SDK Setup ------------------------------------------------+
|                                                                      |
|  $ bun add @opentelemetry/sdk-node \                                 |
|            @opentelemetry/api \                                       |
|            @opentelemetry/sdk-trace-node \                            |
|            @opentelemetry/sdk-metrics \                               |
|            @opentelemetry/exporter-trace-otlp-http \                  |
|            @opentelemetry/exporter-metrics-otlp-http                  |
|                                                                      |
|  # Dev: console exporter (zero infrastructure)                       |
|  # Prod: OTLP exporter via standard env vars                         |
|                                                                      |
|  Environment:                                                        |
|    OTEL_SERVICE_NAME=brain                                           |
|    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  (prod only)    |
|    OTEL_LOG_LEVEL=info                                               |
|                                                                      |
+----------------------------------------------------------------------+
```

**Emotional state**: Uncertain -> Oriented
"Packages installed, exporter configured. Console output shows spans. It works on Bun."

**Shared artifacts**:
- `TracerProvider` -- single instance, initialized at startup
- `MeterProvider` -- single instance, initialized at startup
- Service name `brain` -- used across all spans and metrics

**Error paths**:
- OTEL SDK fails to initialize on Bun -> graceful degradation, console fallback
- OTLP endpoint unreachable in prod -> SDK buffers and retries per OTEL spec

---

## Step 2: Instrument LLM Calls (AI SDK Telemetry)

**Action**: Enable `experimental_telemetry` on all `generateText`/`generateObject`/`streamText` calls

```
+-- Step 2: AI SDK Telemetry -----------------------------------------+
|                                                                      |
|  Before (no visibility):                                             |
|    const result = await generateObject({                             |
|      model, prompt, schema                                           |
|    });                                                               |
|                                                                      |
|  After (full telemetry):                                             |
|    const result = await generateObject({                             |
|      model, prompt, schema,                                          |
|      experimental_telemetry: {                                       |
|        isEnabled: true,                                              |
|        functionId: 'brain.extraction.generate',                      |
|        metadata: { workspaceId, messageId },                         |
|      },                                                              |
|    });                                                               |
|                                                                      |
|  Spans emitted automatically:                                        |
|    ai.generateObject  [brain.extraction.generate]                    |
|    +-- ai.model.id: "anthropic/claude-3.5-haiku"                     |
|    +-- ai.usage.promptTokens: 1847                                   |
|    +-- ai.usage.completionTokens: 423                                |
|    +-- ai.telemetry.functionId: "brain.extraction.generate"          |
|    +-- duration: 2341ms                                              |
|                                                                      |
+----------------------------------------------------------------------+
```

**Function ID taxonomy**:
```
brain.extraction.generate       -- entity extraction from messages
brain.extraction.dedupe         -- deduplication scoring
brain.chat.agent                -- chat agent responses
brain.chat.stream               -- streaming chat responses
brain.pm.agent                  -- PM subagent work planning
brain.observer.verify           -- observation verification
brain.observer.peer-review      -- peer review cross-validation
brain.behavior.score            -- behavior scoring
brain.onboarding.generate       -- onboarding responses
brain.intent.authorize          -- intent authorization
brain.analytics.agent           -- analytics agent queries
```

**Emotional state**: Oriented -> Capable
"Every LLM call now emits structured telemetry. I can see token counts and latency without adding any logging."

**Shared artifacts**:
- `functionId` taxonomy -- consistent naming across all call sites
- Telemetry metadata pattern -- `{ workspaceId, messageId }` for correlation

---

## Step 3: Instrument Request Lifecycle (Distributed Tracing)

**Action**: Create root spans for HTTP requests, child spans for pipeline stages

```
+-- Step 3: Request Tracing ------------------------------------------+
|                                                                      |
|  Trace waterfall for POST /api/chat/messages:                        |
|                                                                      |
|  brain.http.request POST /api/chat/messages         [8234ms]         |
|  +-- brain.chat.ingress                             [ 45ms]          |
|  |   +-- brain.chat.persist-message                 [ 12ms]          |
|  +-- brain.chat.process                             [8180ms]         |
|      +-- brain.extraction.pipeline                  [2100ms]         |
|      |   +-- ai.generateObject [extraction.generate] [1890ms]        |
|      |   +-- brain.extraction.persist               [ 180ms]         |
|      +-- brain.chat.agent                           [5200ms]         |
|          +-- brain.chat.build-context               [ 320ms]         |
|          +-- ai.streamText [chat.agent]              [4100ms]        |
|          +-- brain.chat.tool.search_entities        [ 450ms]         |
|          +-- brain.chat.tool.invoke_pm_agent        [2800ms]         |
|              +-- ai.generateObject [pm.agent]        [2400ms]        |
|                                                                      |
|  Bottleneck: chat agent LLM call (4100ms = 50% of total)            |
|                                                                      |
+----------------------------------------------------------------------+
```

**Emotional state**: Capable -> Capable (deepening)
"I can see exactly where time goes. The chat agent LLM call dominates. PM subagent adds 2.8s. Now I know where to optimize."

**Shared artifacts**:
- Root span `brain.http.request` -- created by request handler wrapper
- Span context -- propagated via OTEL context API (replaces manual requestId correlation)
- `requestId` -- carried as span attribute for backward compatibility

**Integration checkpoint**:
- AI SDK spans automatically nest under the active OTEL context
- Existing `requestContext` (AsyncLocalStorage) must coexist with OTEL context

---

## Step 4: Debug a Wrong LLM Response

**Action**: Use trace data to diagnose an extraction that produced wrong entities

```
+-- Step 4: Debug LLM Issue ------------------------------------------+
|                                                                      |
|  Scenario: Extraction created a "task" entity from a message         |
|  that was actually discussing an existing decision.                   |
|                                                                      |
|  1. Find the trace by messageId:                                     |
|     Search: ai.telemetry.metadata.messageId = "msg-a1b2c3"          |
|                                                                      |
|  2. Open the extraction span:                                        |
|     ai.generateObject [brain.extraction.generate]                    |
|     +-- ai.model.id: "anthropic/claude-3.5-haiku"                    |
|     +-- ai.usage.promptTokens: 2847                                  |
|     +-- ai.usage.completionTokens: 523                               |
|     +-- ai.telemetry.functionId: "brain.extraction.generate"         |
|     +-- duration: 2341ms                                             |
|     +-- status: OK                                                   |
|                                                                      |
|  3. Diagnosis: model returned confidence 0.62 (below display         |
|     threshold 0.85 but above store threshold 0.6). Entity was        |
|     stored but should not have been classified as "task".             |
|     Root cause: prompt, not model. Adjust extraction prompt.         |
|                                                                      |
+----------------------------------------------------------------------+
```

**Emotional state**: Capable -> Confident
"I found the issue in 2 minutes. Prompt problem, not model problem. I have the evidence."

---

## Step 5: Operational Metrics & Cost Monitoring

**Action**: Review metrics dashboards for health and cost attribution

```
+-- Step 5: Metrics & Cost -------------------------------------------+
|                                                                      |
|  Metrics exported (OTEL histograms and counters):                    |
|                                                                      |
|  brain.llm.duration        histogram  by functionId, model           |
|  brain.llm.tokens.prompt   counter    by functionId, model           |
|  brain.llm.tokens.completion counter  by functionId, model           |
|  brain.llm.errors          counter    by functionId, model, error    |
|  brain.http.duration       histogram  by method, route, status       |
|  brain.http.requests       counter    by method, route, status       |
|  brain.extraction.entities counter    by entity_type                 |
|                                                                      |
|  Cost breakdown (example week):                                      |
|  +---------------------------+--------+--------+-------+             |
|  | Function                  | Prompt | Compl. | Cost  |             |
|  +---------------------------+--------+--------+-------+             |
|  | extraction.generate       | 1.2M   | 340K   | $4.20 |             |
|  | chat.agent (stream)       | 890K   | 520K   | $6.80 |             |
|  | pm.agent                  | 420K   | 180K   | $1.90 |             |
|  | observer.verify           | 310K   | 95K    | $1.10 |             |
|  | behavior.score            | 180K   | 45K    | $0.55 |             |
|  | extraction.dedupe         | 150K   | 30K    | $0.40 |             |
|  +---------------------------+--------+--------+-------+             |
|  | TOTAL                     | 3.15M  | 1.21M  | $14.95|             |
|  +---------------------------+--------+--------+-------+             |
|                                                                      |
|  Insight: Chat agent is the top cost center (45%), not extraction.   |
|  Optimization priority: chat agent prompt length reduction.           |
|                                                                      |
+----------------------------------------------------------------------+
```

**Emotional state**: Confident -> Confident (sustained)
"I know exactly what the system costs. I can justify every optimization decision with data."

---

## Integration Checkpoints

| Checkpoint | Validation |
|-----------|------------|
| OTEL SDK initializes before server starts | Startup log confirms TracerProvider and MeterProvider active |
| AI SDK spans nest under HTTP root spans | Trace waterfall shows parent-child relationship |
| Console exporter works with zero config | `bun run dev` shows spans in terminal |
| OTLP exporter activates only when endpoint configured | No errors when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset |
| Existing requestId available as span attribute | Backward-compatible log correlation |
| AsyncLocalStorage context coexists with OTEL context | No context loss across async boundaries |
| Pino removal does not break startup logging | Thin console logger handles startup messages |
| Graph traces (SurrealDB) remain independent | Application audit trail unaffected by OTEL migration |
