# Graph-Reactive Agent Coordination -- Requirements Index

## Feature Overview

Replace Osabio's poll-based reactivity with a reactive layer powered by SurrealDB LIVE SELECT, enabling real-time governance feed updates, automatic agent context injection, and immediate conflict detection.

## Phasing

| Phase | Scope | Stories |
|-------|-------|---------|
| **Phase 3: Foundation** | LIVE SELECT → SSE bridge for UI feed reactivity | US-GRC-01 |
| **Phase 4: Coordinator** | Always-on service: observation → vector search against agent description embeddings → invoke matched agents | US-GRC-03 |
| **Phase 5: Delivery** | LLM proxy vector searches for relevant recent graph changes → injects as context XML | US-GRC-04 |

## Dependency Graph

```
US-GRC-01 (Live Feed SSE Bridge)
    |
    v
US-GRC-03 (Agent Coordinator + Loop Dampening)
    |
    v
US-GRC-04 (Proxy Context Enrichment)
```

## Stories

| ID | Title | Type | Phase | Est. Days | Scenarios | Status |
|----|-------|------|-------|-----------|-----------|--------|
| US-GRC-01 | Live Governance Feed via SSE | Story | 3 | 3 | 6 | Draft |
| US-GRC-03 | Agent Coordinator with Vector Search Routing | Story | 4 | 3 | 7 | Draft |
| US-GRC-04 | Proxy Context Enrichment via Vector Search | Story | 5 | 1 | 5 | Draft |

## JTBD Traceability

| Job Story | Stories |
|-----------|---------|
| JS-GRC-01: Real-Time Governance Awareness | US-GRC-01 |
| JS-GRC-02: Reactive Agent Wake-Up | US-GRC-03, US-GRC-04 |
| JS-GRC-03: Real-Time Conflict Detection | US-GRC-03, US-GRC-04 |
| JS-GRC-04: MCP Context Freshness | US-GRC-04 (vector search context endpoint) |

## Opportunity Score Alignment

| Outcome (Score) | Primary Story |
|-----------------|---------------|
| Agent stale-context prevention (17.4) | US-GRC-04 |
| Feed real-time updates (16.5) | US-GRC-01 |
| Manual refresh elimination (16.0) | US-GRC-01 |
| Semantic agent routing (14.9) | US-GRC-03 |
| Conflict notification latency (14.8) | US-GRC-04 |

## Personas

| Persona | Primary Stories |
|---------|----------------|
| Marcus Oliveira (Workspace Admin) | US-GRC-01, US-GRC-03 |
| Chat Agent (Orchestrator) | US-GRC-03, US-GRC-04 |
| Observer Agent | US-GRC-03 (creates observations that coordinator routes) |
| Tomas Chen (MCP/CLI user) | US-GRC-04 (context freshness) |

## Key Risks

| Risk | Severity | Mitigation | Story |
|------|----------|------------|-------|
| SSE events + GET feed items schema mismatch | HIGH | Share GovernanceFeedItem type | US-GRC-01 |
| Agent coordination loops from cascading events | HIGH | Loop dampening with meta-observation | US-GRC-03 |
| High-volume tables (trace) flood LIVE SELECT | HIGH | Exclude from LIVE SELECT; use DEFINE EVENT | US-GRC-01 |
| Context injection confuses agent mid-task | MEDIUM | Clear framing, never cancel current generation | US-GRC-04 |
| False-positive agent routing | MEDIUM | Similarity threshold filters low-relevance matches | US-GRC-03 |

## UX Artifacts

All in `docs/ux/graph-reactive-coordination/`:
- `jtbd-analysis.md` -- 4 job stories, forces analysis, opportunity scores, personas
- `journey-reactive-feed-visual.md` -- feed journey with ASCII mockups
- `journey-reactive-feed.yaml` -- structured feed journey schema
- `journey-reactive-feed.feature` -- feed journey Gherkin (17 scenarios)
- `journey-agent-coordination-visual.md` -- coordination journey with flow diagrams
- `journey-agent-coordination.yaml` -- structured coordination journey schema
- `journey-agent-coordination.feature` -- coordination journey Gherkin (17 scenarios)
- `shared-artifacts-registry.md` -- 10 tracked artifacts with sources and consumers
