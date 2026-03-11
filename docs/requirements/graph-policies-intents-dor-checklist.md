# Definition of Ready: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11

---

## US-GPI-1: Policy Nodes in Graph View

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Rena Okafor finds it time-consuming to verify policy coverage because policies are invisible in the graph view" -- uses domain terms (policy, governance topology, identity coverage) |
| User/persona with specific characteristics | PASS | Rena Okafor, workspace admin, manages agent governance policies, needs visual coverage verification |
| 3+ domain examples with real data | PASS | (1) Active policy with governed identities, (2) superseded policy chain, (3) deprecated/draft exclusion -- all with specific names and statuses |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: active policy node, protects edge, deprecated exclusion, entity detail metadata |
| AC derived from UAT | PASS | 8 acceptance criteria derived from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~2 days effort: EntityKind change + GraphEntityTable + graph queries + theme + labels. 4 scenarios. |
| Technical notes: constraints/dependencies | PASS | Lists required changes to contracts.ts, queries.ts, graph-theme.ts. Notes schema dependency (already present). |
| Dependencies resolved or tracked | PASS | Policy table, governing/protects relations exist in schema. No blocking dependencies. |

**DoR Status**: PASSED

---

## US-GPI-2: Intent Nodes in Graph View

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Carlos Medina finds it difficult to monitor the intent authorization pipeline because only pending_veto intents appear in the feed" -- uses domain terms (intent, authorization pipeline, triggered_by, gates) |
| User/persona with specific characteristics | PASS | Carlos Medina, team lead, oversees agent operations, needs intent lifecycle visibility |
| 3+ domain examples with real data | PASS | (1) Executing intent with full flow, (2) pending veto with risk, (3) terminal state exclusion -- all with specific intent names and statuses |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: active intent node, gates edge, completed exclusion, entity detail metadata |
| AC derived from UAT | PASS | 8 acceptance criteria derived from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~1.5 days effort: GraphEntityTable + graph queries + entityTables allowlist. 4 scenarios. Intent already in EntityKind. |
| Technical notes: constraints/dependencies | PASS | Notes intent already in EntityKind. Lists GraphEntityTable, graph-route.ts changes. Schema dependency present. |
| Dependencies resolved or tracked | PASS | Intent table, triggered_by/gates relations exist in schema. US-GPI-1 provides EntityKind pattern (parallel work possible). |

**DoR Status**: PASSED

---

## US-GPI-3: Vetoed Intents in Feed Awareness Tier

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Amara Diallo finds it impossible to discover vetoed intents without querying the database" -- uses domain terms (vetoed intent, governance feed, awareness tier) |
| User/persona with specific characteristics | PASS | Amara Diallo, compliance reviewer, audits agent governance, needs passive veto notification |
| 3+ domain examples with real data | PASS | (1) Recently vetoed intent with reason, (2) multiple vetoed sorted by recency, (3) 24h cutoff boundary, (4) dedup with blocking tier |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: recent vetoed, 24h cutoff, recency ordering, blocking tier dedup |
| AC derived from UAT | PASS | 8 acceptance criteria derived from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~1 day effort: new query function + mapping function + feed-route integration. 4 scenarios. Follows existing feed pattern exactly. |
| Technical notes: constraints/dependencies | PASS | Lists new query, mapping function, Promise.all integration, dedup approach. Notes evaluation field dependency. |
| Dependencies resolved or tracked | PASS | Intent evaluation field with reason exists in schema. listPendingVetoIntents provides pattern. No blocking dependencies. |

**DoR Status**: PASSED

---

## US-GPI-4: Governance Edge Styles

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Governance edges look identical to structural edges, making it harder to distinguish governance from project hierarchy" |
| User/persona with specific characteristics | PASS | Rena Okafor (admin) and Carlos Medina (team lead), both viewing graph with mixed entity types |
| 3+ domain examples with real data | PASS | (1) Governance edges distinct from structural, (2) authorization flow edges distinct, (3) unknown edge fallback |
| UAT scenarios in Given/When/Then (3-7) | PASS | 3 scenarios: governance style, authorization style, unknown fallback |
| AC derived from UAT | PASS | 5 acceptance criteria derived from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~0.5 day effort: 4 new cases in edgeStyle() switch. 3 scenarios. Existing test file to extend. |
| Technical notes: constraints/dependencies | PASS | Changes to graph-theme.ts only. Existing test coverage noted. |
| Dependencies resolved or tracked | PASS | No dependencies. Pure UI theme change. |

**DoR Status**: PASSED

---

## US-GPI-5: Entity Name Resolution for Intent and Policy

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "readEntityNameByTable does not handle intent or policy, causing entities to be silently dropped from feed results" |
| User/persona with specific characteristics | PASS | Any user viewing feed items involving intent/policy entities |
| 3+ domain examples with real data | PASS | (1) Intent name from goal field, (2) policy name from title field, (3) missing record returns undefined |
| UAT scenarios in Given/When/Then (3-7) | PASS | 3 scenarios: intent resolution, policy resolution, missing record |
| AC derived from UAT | PASS | 3 acceptance criteria derived from scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~0.5 day effort: 2 new switch cases. 3 scenarios. Minimal change. |
| Technical notes: constraints/dependencies | PASS | Two new cases following existing pattern. No new dependencies. |
| Dependencies resolved or tracked | PASS | Intent goal field and policy title field exist in schema. |

**DoR Status**: PASSED

---

## Summary

| Story | DoR Status | Estimated Effort | Scenarios |
|-------|-----------|-----------------|-----------|
| US-GPI-1: Policy Nodes in Graph | PASSED | 2 days | 4 |
| US-GPI-2: Intent Nodes in Graph | PASSED | 1.5 days | 4 |
| US-GPI-3: Vetoed Intents in Feed | PASSED | 1 day | 4 |
| US-GPI-4: Governance Edge Styles | PASSED | 0.5 day | 3 |
| US-GPI-5: Entity Name Resolution | PASSED | 0.5 day | 3 |

**Total estimated effort**: ~5.5 days
**All stories pass DoR**: Ready for DESIGN wave handoff

### Recommended Implementation Order

1. **US-GPI-5** (name resolution) -- prerequisite for correct display everywhere, minimal risk
2. **US-GPI-4** (edge styles) -- pure UI, no data changes, quick win
3. **US-GPI-1** (policy nodes) -- requires EntityKind contract change, unlocks J1
4. **US-GPI-2** (intent nodes) -- leverages pattern from US-GPI-1, unlocks J2
5. **US-GPI-3** (vetoed feed items) -- independent of graph work, can parallel with US-GPI-1/2

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| EntityKind change breaks exhaustive switches in untested code | Low | Medium | TypeScript compiler catches most; run full test suite |
| Graph clutter from too many policy/intent nodes | Medium | Low | Status filters already specified; can add UI toggle later |
| Intent volume floods graph in active workspaces | Low | Medium | Non-terminal filter already specified; completed/vetoed excluded |
| 24h window for vetoed intents misses compliance needs | Low | Low | Window is configurable constant; can extend later |
