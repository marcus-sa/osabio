# JTBD Job Stories: OpenTelemetry Observability Migration

## Job 1: Debug LLM Calls

### Job Story

**When** an extraction or chat response produces unexpected results (wrong entities, hallucinated relationships, missing fields),
**I want to** see the full LLM request/response including prompt content, model parameters, latency, and token usage,
**so I can** determine whether the root cause is a prompt issue, model regression, or malformed input data -- without adding ad-hoc logging and redeploying.

### Functional Job
Inspect the complete lifecycle of any LLM call: input prompt, model configuration, raw response, token counts, and timing -- after the fact, without code changes. Application logs emitted during the LLM call are automatically correlated via trace_id/span_id, providing narrative context alongside the structural span data.

### Emotional Job
Feel in control when diagnosing LLM misbehavior. Replace the anxiety of "something is wrong and I cannot see why" with confidence that the full picture is visible.

### Social Job
Be seen as someone who debugs LLM issues methodically with evidence, not by guessing and redeploying blindly.

### Outcome Statements
- Minimize the time it takes to identify the root cause of a wrong LLM response
- Minimize the likelihood of misattributing an LLM failure (prompt vs model vs data)
- Maximize the completeness of diagnostic information available without code changes

---

## Job 2: Request Tracing

### Job Story

**When** a user reports that a chat interaction was slow or returned an error,
**I want to** trace the full request lifecycle from HTTP ingress through chat agent orchestration, tool calls, LLM invocations, and database queries,
**so I can** pinpoint exactly where time was spent or where the failure occurred -- without correlating timestamps across separate log files.

### Functional Job
Follow a single user request through every system boundary (HTTP handler, extraction pipeline, chat agent, PM subagent, tool execution, SurrealDB queries) with timing and status at each hop.

### Emotional Job
Feel confident that slow or broken requests can be diagnosed quickly. Replace the dread of "I have to grep through logs and mentally reconstruct the sequence" with a clear, connected trace.

### Social Job
Demonstrate to the team that production issues are diagnosable in minutes, not hours -- building trust in the system's operational maturity.

### Outcome Statements
- Minimize the time it takes to pinpoint the slowest operation in a request chain
- Minimize the number of tools/files needed to reconstruct a request's lifecycle
- Maximize the likelihood of identifying the root cause on the first investigation attempt

---

## Job 3: Operational Monitoring

### Job Story

**When** the Brain system is running in production serving real users,
**I want to** see dashboards with LLM latency distributions, token cost trends, error rates by endpoint, and throughput over time,
**so I can** detect degradation before users notice and make capacity decisions based on data rather than guesswork.

### Functional Job
Collect and expose quantitative metrics: LLM call latency (p50/p95/p99), token usage per model, HTTP error rates, request throughput, and extraction pipeline duration -- continuously, with minimal performance overhead.

### Emotional Job
Feel assured that the system is healthy without having to actively check. Replace the background worry of "is it working?" with the calm of instrumented visibility.

### Social Job
Present production health data to stakeholders with concrete numbers, demonstrating operational rigor and justifying infrastructure investments.

### Outcome Statements
- Minimize the time between a performance degradation starting and being detected
- Minimize the likelihood of a user-visible outage that could have been predicted
- Maximize the accuracy of cost projections for LLM usage

---

## Job 4: Cost Visibility

### Job Story

**When** I am evaluating whether to switch models, optimize prompts, or adjust extraction thresholds,
**I want to** see token usage breakdowns by function (extraction vs chat agent vs observer vs PM agent vs behavior scorer),
**so I can** identify which functions consume the most tokens and make informed decisions about where optimization effort will have the highest ROI.

### Functional Job
Attribute token consumption (prompt tokens, completion tokens) to specific application functions and models, aggregated over configurable time windows.

### Emotional Job
Feel empowered to make cost decisions with real data. Replace the uncertainty of "I think extraction is expensive but I am not sure" with precise per-function cost breakdowns.

### Social Job
Justify model and prompt optimization decisions to the team with concrete usage data, not intuition.

### Outcome Statements
- Minimize the time it takes to identify the highest-cost LLM function
- Minimize the likelihood of optimizing a function that is not actually the cost bottleneck
- Maximize the precision of per-function token cost attribution

---

## Job 5: Log-Trace Correlation

### Job Story

**When** I am investigating a specific request failure or unexpected behavior and I have a trace showing the span waterfall,
**I want to** see the application logs emitted during that trace automatically correlated by trace_id and span_id,
**so I can** read the narrative of what the code was doing (log messages) alongside the structural view of how long each operation took (spans) -- without manually correlating timestamps or request IDs across separate log files.

### Functional Job
View application logs (info, warn, error, debug) filtered by a specific trace ID, with each log record linked to the span that was active when it was emitted. Logs and traces flow through the same OTEL pipeline and can be queried together in a single backend.

### Emotional Job
Feel that debugging is seamless -- traces show the structure, logs tell the story. Replace the frustration of "I can see the span failed but I do not know what the code was doing at that point" with complete narrative visibility.

### Social Job
Demonstrate operational maturity where observability is unified, not fragmented across separate logging and tracing systems that require manual correlation.

### Outcome Statements
- Minimize the time it takes to find the relevant log entries for a specific traced request
- Minimize the number of tools needed to view both traces and logs for an incident
- Maximize the confidence that all log output from a request is captured and correlated with its trace
