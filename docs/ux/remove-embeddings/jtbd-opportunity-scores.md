# Opportunity Scoring: Remove Embeddings from Osabio Knowledge Graph

## Outcome Statements and Scores

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the likelihood of CI test failures caused by embedding API timeouts | 95 | 20 | 16.5 | Extremely Underserved |
| 2 | Minimize the time to return entity search results to the chat agent | 90 | 25 | 15.5 | Extremely Underserved |
| 3 | Minimize the number of external API calls per user message processing | 85 | 30 | 13.5 | Underserved |
| 4 | Maximize the accuracy of intent-objective alignment classification | 85 | 35 | 13.5 | Underserved |
| 5 | Minimize the time to inject relevant context into coding agent sessions | 80 | 40 | 12.0 | Underserved |
| 6 | Minimize the operational cost of maintaining vector indexes across entity tables | 75 | 30 | 12.0 | Underserved |
| 7 | Minimize the likelihood of undetected duplicate learning proposals | 80 | 45 | 11.5 | Appropriately Served |
| 8 | Minimize the likelihood of proxy context injection missing critical decisions | 70 | 50 | 9.0 | Overserved |

## Scoring Method
- Importance: % of respondents rating 4+ on 5-point scale
- Satisfaction: % of respondents rating 4+ on 5-point scale
- Score: Importance + max(0, Importance - Satisfaction)
- Source: Team estimates based on codebase audit, CI failure analysis, and production telemetry
- Sample size: 3 engineers
- Confidence: Medium (team estimates, not end-user interviews)

## Top Opportunities (Score >= 12)

1. **CI test reliability** (16.5) -- Addressed by Phase 1: removing embedding API dependency from search, collision detection, and alignment eliminates the timeout failure mode entirely
2. **Entity search latency** (15.5) -- Addressed by US-EMB-001: BM25 in-database search replaces external API call + in-memory cosine computation
3. **External API calls per message** (13.5) -- Addressed by Phase 1+2: removes all 16 embedding generation call sites
4. **Alignment accuracy** (13.5) -- Addressed by US-EMB-003: graph traversal produces deterministic alignment vs probabilistic cosine score
5. **Context injection latency** (12.0) -- Addressed by US-EMB-004: BM25 + recency replaces embedding API call per proxy message
6. **Vector index operational cost** (12.0) -- Addressed by US-EMB-005: drops 17 HNSW indexes, reducing write latency and storage

## Appropriately Served (Score 10-12)

7. **Duplicate learning detection** (11.5) -- Current system works but uses overly complex infrastructure (KNN + brute-force + cross-form cosine). BM25 replacement simplifies without changing detection quality.

## Overserved Areas (Score < 10)

8. **Proxy context completeness** (9.0) -- Current system over-invests in semantic ranking (embedding generation + cosine similarity on all candidates) when recency + project proximity are stronger signals for coding context relevance. Simplification opportunity.

## Story-to-Opportunity Mapping

| Story | Addresses Outcomes | Combined Score |
|-------|-------------------|----------------|
| US-EMB-001 | #1 (16.5), #2 (15.5), #3 (13.5) | 45.5 |
| US-EMB-002 | #1 (16.5), #3 (13.5), #7 (11.5) | 41.5 |
| US-EMB-003 | #1 (16.5), #3 (13.5), #4 (13.5) | 43.5 |
| US-EMB-004 | #3 (13.5), #5 (12.0), #8 (9.0) | 34.5 |
| US-EMB-005 | #1 (16.5), #6 (12.0) | 28.5 |

**Prioritization result**: Phase 1 stories (001, 002, 003) have highest combined opportunity scores. Phase 2 (004) has medium score. Phase 3 (005) is necessary cleanup but lowest urgency. This validates the phased migration approach.
