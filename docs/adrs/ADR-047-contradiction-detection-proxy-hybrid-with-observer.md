# ADR-047: Per-Trace Contradiction + Missing Decision Detection via Observer Extension with Proxy Trace Creation

## Status
Proposed

## Context
Agent actions can contradict confirmed decisions in the knowledge graph (e.g., implementing REST when a decision mandates tRPC). Agents also make decisions (architectural choices, technology selections, approach rejections) that never get recorded in the knowledge graph, creating context drift. Both issues are visible in individual LLM responses -- neither requires session context for detection.

Detection must balance speed (catching issues before they compound across multiple tool calls) against depth (reducing false positives through multi-evidence reasoning).

The existing Observer agent performs periodic graph scans and event-driven entity analysis with LLM-based reasoning. The proxy sees every LLM response in real-time but must not add latency to the agent's workflow.

**Current Observer capabilities (what exists today)**: The Observer handles `task`, `intent`, `git_commit`, `decision`, and `observation` entities. It detects orphaned decisions (confirmed, no implementation, >14 days), task-contradicts-decision (LLM verification on task entity events), and stale objectives (active, no intents, >14 days). It does **NOT** currently analyze trace content, extract decision signals from LLM responses, or run on trace entities at all.

## Decision
The proxy creates `llm_call` traces containing response content. A SurrealDB EVENT on the `trace` table triggers the Observer's **new per-trace analysis pipeline**. The Observer performs all detection and analysis -- the proxy has NO analysis logic.

**The "proxy hybrid" means**: proxy creates traces (data capture) -> SurrealDB EVENT fires -> Observer analyzes traces (detection). The proxy's role ends at trace creation.

**New Observer capability: Trace Response Analyzer** (must be built):

**Contradiction Detection**:
- **Tier 1** (every qualifying trace, zero LLM cost): Embed response text from trace `output`, KNN search against confirmed decisions in the workspace, filter by similarity threshold (default 0.75).
- **Tier 2** (selective, Haiku-class model): For each flagged candidate from Tier 1, call a verification prompt. Discard results below confidence threshold (default 0.6). Create a `conflict` severity observation for confirmed contradictions.

**Missing Decision Detection** (same pipeline, different check):
- **Tier 1** (every qualifying trace, zero LLM cost): Extract decision signals from trace response text (architectural statements, approach selections, technology choices). Embed each signal, KNN against existing decisions. No match above threshold = unrecorded decision candidate.
- **Tier 2** (selective, Haiku-class model): For each unmatched candidate, call a verification prompt: "Is this a genuine decision that should be recorded?" Discard low-confidence results. Create an `info` severity observation for confirmed missing decisions.

**New Observer capability: Reverse Coherence Scan** (must be built):
- A new phase in the existing `runCoherenceScans()` batch scan
- Finds completed tasks and git commits with no linked decision records
- Creates `info` severity observations -- deterministic, no LLM needed
- The reverse of the existing orphaned decision check

The entire pipeline is async and decoupled from the proxy via SurrealDB EVENTs. It never blocks SSE delivery or request forwarding. Both detection types share trace content extraction, stop_reason filtering, and the Tier 1/Tier 2 architecture.

## Alternatives Considered

### Alternative 1: Observer-only detection (periodic scan, no EVENT trigger)
- **What**: The Observer scans traces on its periodic schedule, comparing agent outputs against decisions.
- **Expected impact**: Deep, multi-evidence analysis with low false positive rate.
- **Why rejected**: Detection latency of minutes to hours. An agent could implement a contradicting change across dozens of tool calls before the next Observer scan. By then, the contradiction is embedded in code and harder to remediate. EVENT-driven analysis triggers within seconds of trace creation.

### Alternative 2: Proxy-owned detection (analysis logic in the proxy)
- **What**: The proxy performs contradiction detection and missing decision detection inline in a "Response Analyzer" module, creating observations directly.
- **Expected impact**: Single component owns both trace creation and analysis.
- **Why rejected**: Violates the architectural boundary where ALL detection and analysis is the Observer's responsibility. Duplicates embedding, KNN, LLM verification, and observation creation logic that already exists in the Observer system. The proxy's job is transparent passthrough with context enrichment -- not graph analysis. Keeping detection in the Observer means new detection capabilities are Observer modules, not proxy changes. The Observer already has the verification pipeline, peer review gating, and LLM reasoning infrastructure.

### Alternative 3: Proxy inline detection (blocking)
- **What**: The proxy performs deep contradiction analysis inline before returning the response, including multi-evidence reasoning.
- **Expected impact**: Agents see contradiction warnings before acting on them.
- **Why rejected**: Would add 1-5 seconds to every response. Destroys streaming UX. Detection is better handled as async observations that surface in the feed/dashboard.

## Consequences
- **Positive**: Near-real-time detection -- SurrealDB EVENT fires within seconds of trace creation, Observer analysis follows immediately
- **Positive**: Low false positive rate (Tier 2 acts as precision gate with confidence threshold for both detection types, plus existing Observer peer review pipeline)
- **Positive**: Zero latency impact on agent (entire pipeline is async, decoupled via EVENT)
- **Positive**: Works for all clients including unknown/unintegrated -- no session lifecycle required (proxy creates traces for all requests)
- **Positive**: Clean ownership boundary -- proxy owns data capture, Observer owns analysis. New detection capabilities are Observer modules, not proxy changes.
- **Positive**: Reuses existing Observer infrastructure (verification pipeline, peer review, observation creation, LLM reasoning)
- **Positive**: Both detection types share the same pipeline infrastructure (embedding, KNN, Tier 2 model), minimizing implementation and maintenance cost
- **Positive**: Reverse coherence scan adds batch detection for implementations without decisions (deterministic, zero LLM cost)
- **Negative**: Tier 2 incurs Haiku-class LLM cost per flagged candidate (~$0.001 per check, for both contradiction and missing decision checks)
- **Negative**: EVENT-based trigger adds slight latency vs inline analysis (seconds vs sub-second) -- acceptable tradeoff for clean architecture
- **Negative**: Per-trace detection cannot catch nuanced contradictions requiring multi-document reasoning or cross-trace patterns (Observer session-end analysis handles these as an enhancement via ADR-048)
- **Negative**: Requires embedding computation for every qualifying trace (mitigated by async execution and existing pipeline reuse)
- **Negative**: Requires building NEW Observer capabilities -- the Observer does not handle trace entities today. This is new development, not just "delegation to existing Observer."
