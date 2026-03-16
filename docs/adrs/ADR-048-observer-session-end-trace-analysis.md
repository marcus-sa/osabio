# ADR-048: Observer Session-End Cross-Trace Pattern Synthesis via SurrealDB EVENT

## Status

Proposed

## Context

When a coding agent session ends, the full trace history enables detection of patterns invisible to per-request analysis. Per-request response analysis (ADR-047) handles both contradiction detection and missing decision detection for individual LLM responses. However, it cannot detect:

- **Cross-trace patterns**: A contradiction may only become visible when multiple traces are analyzed together (e.g., trace #3 selects approach A, trace #47 implements approach B). Per-request detection sees each response in isolation.
- **Approach drift**: An agent gradually shifts from one approach to another across many traces, where no single response contradicts a decision but the accumulated effect does.
- **Decision evolution**: Patterns that only emerge when reviewing the full session narrative.

These are edge cases -- LLMs don't gradually drift across requests in most scenarios. This capability is an **enhancement** for integrated clients (those with session lifecycle support), not a core detection mechanism. All core capabilities (context injection, contradiction detection, missing decision detection) operate per-request and work for all clients.

Session-end is the natural trigger: the full trace history is available, and analysis cost is amortized over one invocation per session rather than per-request.

### Constraints

- Single-developer team -- must reuse existing Observer infrastructure (pipeline, confidence scoring, peer review, observation creation)
- Session end must never be blocked by analysis
- Must use `OBSERVER_MODEL` (not Haiku-class) because cross-trace pattern synthesis requires deeper reasoning than simple per-response checks
- Must follow the same EVENT-driven pattern as existing Observer triggers (task_completed, intent_completed, etc.)

## Decision

Trigger Observer cross-trace pattern synthesis via a SurrealDB `DEFINE EVENT session_ended ON agent_session ASYNC` that fires when `ended_at` transitions from NONE to a value. The EVENT posts to the existing Observer route handler (`POST /api/observe/agent_session/:id`), which dispatches to a new Session Trace Analyzer module within the Observer.

The analyzer:
- Loads ALL traces for the session (all types: tool_call, message, subagent_spawn, intent_submission, bridge_exchange, llm_call)
- Runs **cross-trace pattern synthesis** through `OBSERVER_MODEL`:
  - Analyzes the full session trace history for approach drift, accumulated contradictions, and decision evolution patterns
  - Embeds pattern candidates, KNN against confirmed workspace decisions
  - Creates `conflict` observations for verified cross-trace patterns
- Applies the same confidence-gating and peer review pipeline as all other Observer verification
- Creates observations via existing `createObservation()` with standard `observes` edges

**Note**: This ADR does NOT cover per-request contradiction or missing decision detection -- those are handled by ADR-047's per-request pipeline and work for all clients without session lifecycle support.

## Alternatives Considered

### Alternative 1: Inline analysis in `endAgentSession()`

Call the trace analysis directly inside `endAgentSession()` in `mcp-queries.ts`.

- **What**: After setting `ended_at`, synchronously or async-tracked call to the analyzer
- **Why rejected**: Couples session lifecycle code (`mcp-queries.ts`) to Observer intelligence (`observer/`). Violates the established pattern where Observer is triggered via EVENTs, not inline calls. Makes `endAgentSession()` harder to test -- every test that ends a session would need Observer mocks. The EVENT pattern keeps the boundary clean: session lifecycle writes the record, Observer reacts independently.

### Alternative 2: Real-time per-trace analysis

Analyze each trace as it is written, rather than waiting for session end.

- **What**: A SurrealDB EVENT on the `trace` table fires on each CREATE, triggering immediate analysis
- **Why rejected**: Individual traces lack session context -- a decision signal in trace #3 only makes sense when you can see that no subsequent trace recorded it as a formal decision. Per-trace analysis would produce many false positives for "missing decisions" that are actually recorded later in the session. Session-end provides the complete picture. Additionally, the trace EVENT would fire hundreds of times per session (one per tool call), multiplying LLM cost by 100x+ compared to a single session-end analysis.

### Alternative 3: Haiku-class model for trace analysis

Use a cheaper model (like per-request contradiction Tier 2) instead of `OBSERVER_MODEL`.

- **What**: Use `CONTRADICTION_MODEL` (Haiku-class) for both decision signal extraction and contradiction verification
- **Why rejected**: Decision detection requires understanding whether a statement represents a genuine architectural/technology decision versus casual reasoning or exploration. Haiku-class models lack the nuance to distinguish "let's try using Redis" (exploration) from "we're standardizing on Redis for all caching" (decision). The existing `OBSERVER_MODEL` is already configured and budgeted for this kind of reasoning across all other Observer verification pipelines. Consistency in model choice also simplifies configuration.

## Consequences

### Positive

- **Cross-trace visibility**: Catches patterns invisible to per-request detection (approach drift, accumulated contradictions, decision evolution)
- **Zero impact on session lifecycle**: ASYNC EVENT means `endAgentSession()` latency is unchanged
- **Full pipeline reuse**: Confidence scoring, peer review, observation creation, deduplication -- all existing
- **Consistent Observer pattern**: Same EVENT -> webhook -> agent -> observation flow as all other Observer triggers
- **Amortized cost**: One OBSERVER_MODEL invocation per session rather than per-trace or per-request
- **Complementary**: Enhances per-request detection (ADR-047) without replacing it -- all core detection works for all clients

### Negative

- **Enhancement only**: Only available for integrated clients with session lifecycle support (CLI/orchestrator). Unknown/unintegrated clients still benefit from per-request detection (ADR-047) but miss cross-trace patterns.
- **Analysis latency**: Results appear minutes after session end, not in real-time (acceptable -- these are retrospective findings)
- **OBSERVER_MODEL cost**: One additional OBSERVER_MODEL call per session end (mitigated by running only when session has traces)
- **Trace volume**: Sessions with hundreds of traces may produce large payloads for LLM analysis (mitigated by extracting and summarizing trace content before LLM invocation)
- **Migration required**: New SurrealDB EVENT definition requires a schema migration (`0040_session_ended_event.surql`)
- **Edge case coverage**: LLMs rarely drift across requests, so this capability catches a narrow but potentially impactful class of issues
