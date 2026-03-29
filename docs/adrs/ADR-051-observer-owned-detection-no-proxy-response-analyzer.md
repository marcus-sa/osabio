# ADR-051: Observer-Owned Detection -- No Proxy Response Analyzer

## Status

Proposed

## Context

The initial LLM proxy intelligence design included a "Response Analyzer" module in the proxy that would run contradiction detection and missing decision detection per-request, inline with the proxy's request/response flow.

During design review, this was identified as an architectural boundary violation. The Observer agent already handles all detection and analysis in the system: contradiction detection (task vs confirmed decisions), coherence scans (orphaned decisions, stale objectives), and peer review of findings. Detection logic belongs in the Observer, not the proxy.

However, the Observer does NOT currently analyze trace content. It handles `task`, `intent`, `git_commit`, `decision`, and `observation` entities -- but has no trace analysis capability. Observer-owned detection means building NEW capabilities in the Observer, not delegating to existing ones.

## Decision

The proxy performs NO analysis of LLM responses. Its role ends at trace creation. The trace captures the **complete response content opaquely** -- all content blocks (text, tool_use, etc.) are stored as-is in the `output` FLEXIBLE field without selective extraction or restructuring. The Observer is responsible for parsing and classifying content types during analysis.

The detection pipeline is:

1. Proxy forwards LLM request, streams response to client
2. Proxy creates `trace` record with complete opaque response content (async, post-response, via inflight tracker)
3. SurrealDB EVENT `trace_llm_call_created` fires on trace creation
4. Observer receives webhook at `POST /api/observe/trace/:id`, dispatches to Trace Response Analyzer
5. Observer parses trace content, runs per-trace analysis (contradiction + missing decision detection)
6. Observer creates observations for confirmed findings

The proxy has zero detection logic, zero embedding computation, zero LLM calls for analysis, and zero content classification logic. All of that lives in the Observer.

### New Observer capabilities required

These do not exist today and must be built:

1. **Per-trace response analysis**: Triggered by `trace_llm_call_created` EVENT. Runs Tier 1 (embedding + KNN against confirmed decisions) and Tier 2 (Haiku-class LLM verification) for both contradiction and missing decision detection. Uses existing Observer infrastructure: confidence scoring, peer review, observation creation.

2. **Reverse coherence scan**: New batch phase in `runCoherenceScans()`. Queries completed tasks and git commits with no linked decision records. Deterministic graph query -- no LLM needed. The reverse of the existing orphaned decision check.

3. **Cross-trace pattern synthesis**: Session-end EVENT analysis (ADR-048). Loads all traces for an ended session, synthesizes patterns invisible to per-trace detection (approach drift, accumulated contradictions).

## Alternatives Considered

### Alternative 1: Proxy-Owned Response Analyzer

The proxy runs contradiction detection and missing decision detection inline in a "Response Analyzer" module, creating observations directly from the proxy process.

**Rejected because**: Duplicates Observer infrastructure. The Observer already has embedding pipelines, KNN search, LLM verification with confidence scoring, peer review gating, and observation creation. Building a parallel detection system in the proxy means two codepaths for the same analysis, two places to tune thresholds, and split authority over what constitutes a contradiction. When detection logic needs updating, it must be changed in two places. The proxy's responsibility is transparent passthrough with context enrichment -- not graph analysis.

### Alternative 2: Shared Detection Library (Proxy + Observer)

Extract detection logic into a shared library. Both the proxy (for real-time per-request analysis) and the Observer (for batch session analysis) import the same detection functions.

**Rejected because**: Over-engineering for a single consumer. The Observer is the only component that should run detection. A shared library suggests two consumers are legitimate -- they are not. The proxy should not run detection at all. The abstraction adds maintenance cost (shared interface contracts, versioning) for no architectural benefit. If the Observer needs the logic, the logic lives in the Observer.

## Consequences

### Positive

- Clean separation: proxy = passthrough + trace creation, Observer = all detection and analysis
- Single detection authority -- no split osabio between proxy and Observer
- Observer enhanced independently of proxy (new detection types are Observer modules, not proxy changes)
- Proxy stays simple: forward request, create trace, done
- Reuses existing Observer infrastructure: verification pipeline, peer review, observation creation, LLM reasoning
- Consistent with system architecture: Observer is the detection agent across all entity types

### Negative

- Observer needs three new capabilities built (per-trace analysis, reverse coherence scan, cross-trace synthesis) -- this is new development, not just "delegation to existing Observer"
- Detection latency is seconds (EVENT trigger + Observer analysis) rather than sub-second (inline) -- acceptable because findings surface as observations in the feed, not as blocking warnings
- Per-trace EVENT triggers add load to the Observer (one webhook per LLM call) -- mitigated by stop_reason filtering (only analyze completed responses) and Tier 1 gating (cheap embedding check before expensive LLM verification)

## References

- ADR-047: Per-Trace Contradiction + Missing Decision Detection via Observer Extension
- ADR-048: Observer Session-End Trace Analysis
- ADR-040: LLM Proxy In-Process Module
- Architecture design: `docs/feature/llm-proxy/design/architecture-design.md`
