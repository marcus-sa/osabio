# ADR-046: Context Injection Approach -- Append-Only System Block

## Status
Proposed

## Context
The LLM proxy needs to inject Osabio knowledge graph context (decisions, learnings, observations) into LLM requests so that coding agents benefit from organizational knowledge without requiring MCP integration or client-side setup.

The primary constraint is prompt cache compatibility. Claude Code uses `cache_control: { type: "ephemeral" }` on its system blocks. Modifying those blocks invalidates the cache, increasing cost and latency. At ~$3.75/MTok for cache creation vs ~$0.30/MTok for cache reads, cache invalidation could increase per-session system prompt cost by 10-12x.

The system field in the Anthropic Messages API accepts either a string or an array of content blocks.

## Decision
Append a new system content block AFTER all existing blocks. Normalize the `system` field to array form if it arrives as a string. Mark the appended block with `cache_control: { type: "ephemeral" }`. Wrap content in a `<osabio-context>` XML tag with workspace/session metadata attributes.

## Alternatives Considered

### Alternative 1: Modify existing system blocks (inline injection)
- **What**: Insert Osabio context into the middle or beginning of the existing system prompt.
- **Expected impact**: Context would be positioned prominently in the system prompt.
- **Why rejected**: Invalidates Claude Code's prompt cache on every request. The cache key includes full system content -- any mutation forces a cache miss. Additionally, finding a reliable injection point inside an opaque agent prompt is fragile and version-dependent.

### Alternative 2: HTTP header injection (X-Osabio-Context)
- **What**: Pass context via custom HTTP headers, rely on the provider to include them.
- **Expected impact**: Zero body mutation, zero cache impact.
- **Why rejected**: Anthropic's Messages API does not surface custom headers to the model. The model only sees `system`, `messages`, and `tools` fields. Headers are invisible to the model. Would require provider-side integration.

### Alternative 3: Prepend a synthetic user message
- **What**: Insert a synthetic `user` message at the beginning of the conversation containing Osabio context.
- **Expected impact**: Model would see context as part of the conversation.
- **Why rejected**: Mutates the `messages` array, potentially confusing agents that track message indices. A system-level context appearing as a "user" message could cause the model to treat it as a user instruction rather than background context, altering behavior.

## Consequences
- **Positive**: Zero impact on prompt cache -- existing blocks untouched, new block appended at end
- **Positive**: Clear separation -- `<osabio-context>` XML wrapper makes the injected block identifiable and parseable
- **Positive**: Compatible with both string and array `system` field formats
- **Positive**: The appended block itself benefits from ephemeral caching on subsequent turns (context is stable per session)
- **Negative**: Increases total system prompt size by ~750-1000 tokens per request
- **Negative**: Last-position block may receive slightly less model attention than earlier blocks -- mitigated by distinctive XML wrapper tag
