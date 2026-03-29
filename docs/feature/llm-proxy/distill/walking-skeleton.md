# LLM Proxy Walking Skeletons

## Skeleton Selection Rationale

Three walking skeletons prove the thinnest vertical slices delivering observable user value:

### Skeleton 1: Non-Streaming Passthrough (US-LP-001)

**User goal**: "I use Claude Code through Osabio's proxy and it works identically."

**Why this is the first skeleton**: This is the most fundamental capability. If the proxy cannot transparently forward a request and return the response, nothing else matters. The walking skeleton already exists in `anthropic-proxy-route.ts` -- this test validates it.

**Observable outcome**: Developer receives the model's response indistinguishable from calling Anthropic directly.

**Litmus test**:
- Title describes user goal: YES ("Developer makes an LLM call through the proxy and it works identically")
- Then describes user observation: YES (receives response with original content)
- Non-technical stakeholder confirms: YES ("Yes, the developer can use their tool normally")

### Skeleton 2: Trace Capture (US-LP-001 + US-LP-002 + US-LP-003)

**User goal**: "My LLM call is recorded as a trace in the knowledge graph so my admin has visibility."

**Why**: This proves the core value proposition of the proxy -- observability. A request flows through the proxy, is forwarded to Anthropic, and the usage data is captured as a queryable graph entity.

**Observable outcome**: A trace node appears in the graph with model, tokens, cost, and workspace link.

**Litmus test**:
- Title describes user goal: YES ("Developer's LLM call is recorded as a trace")
- Then describes user observation: YES (trace appears with token counts and cost)
- Non-technical stakeholder confirms: YES ("Yes, we can see what the agent did")

### Skeleton 3: Cost Attribution (US-LP-001 + US-LP-002 + US-LP-003 + US-LP-004)

**User goal**: "I can see exactly how much each project costs in LLM usage."

**Why**: This is the first skeleton that delivers business value to the workspace admin. It proves the full chain: request -> forward -> trace -> cost computation -> project attribution.

**Observable outcome**: Admin queries spend breakdown and sees cost attributed to the correct project and task.

**Litmus test**:
- Title describes user goal: YES ("Admin sees cost attributed to correct project")
- Then describes user observation: YES (cost appears under the right project)
- Non-technical stakeholder confirms: YES ("Yes, I can see where my money is going")

## Skeleton Dependency Chain

```
Skeleton 1 (Passthrough)
    |
    v
Skeleton 2 (Trace Capture) -- requires passthrough working
    |
    v
Skeleton 3 (Cost Attribution) -- requires trace data to attribute
```

Each skeleton builds on the previous one. Implement in order.
