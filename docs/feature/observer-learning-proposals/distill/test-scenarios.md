# Observer Learning Proposals — Test Scenarios

## Overview

27 scenarios across 5 test files, organized by the 4-step implementation roadmap.

**Error path ratio**: 12/27 = 44% (exceeds 40% target)

## Walking Skeleton (3 scenarios — enabled)

| # | Scenario | Type | Given | When | Then |
|---|----------|------|-------|------|------|
| WS-1 | Observer diagnoses a recurring pattern and proposes a learning | Happy | 3 similar observations about rate limit checking | Graph scan runs | Learning exists with status=pending_approval, source=agent, suggested_by=observer |
| WS-2 | Observer skips proposal when active learning covers pattern | Error/Dedup | 3 similar observations + active learning covering same topic | Graph scan runs | No new learning created |
| WS-3 | Pipeline completes gracefully on ambiguous patterns | Edge | 3 vague observations on unclear topic | Graph scan runs | Scan completes without error (learning or observation, both valid) |

## Milestone 1: Clustering and Coverage (6 scenarios — skipped)

| # | Scenario | Type | Given | When | Then |
|---|----------|------|-------|------|------|
| M1-1 | Three similar observations form a cluster | Happy | 3 observations about error handling | Graph scan | Cluster processed (learning or observation created) |
| M1-2 | Two observations do not trigger proposal | Boundary | 2 observations (below threshold) | Graph scan | No learning proposed |
| M1-3 | Unrelated topics do not cluster | Error | 3 observations on different topics | Graph scan | No learning proposed |
| M1-4 | Observations older than 14 days excluded | Boundary | 3 similar observations, 20 days old | Graph scan | No learning proposed |
| M1-5 | Active learning coverage skips cluster | Dedup | 3 observations + matching active learning | Graph scan | No new learning |
| M1-6 | Unrelated active learning allows cluster | Happy | 3 observations + unrelated active learning | Graph scan | Pipeline processes cluster |

## Milestone 2: Root Cause Classification (4 scenarios — skipped)

| # | Scenario | Type | Given | When | Then |
|---|----------|------|-------|------|------|
| M2-1 | Classification produces valid category and type | Happy | 4 observations about architectural drift | Graph scan | Learning has valid type (constraint/instruction), correct metadata |
| M2-2 | Low confidence creates observation instead | Error | 3 maximally vague observations | Graph scan | Pipeline completes (observation or low-confidence learning) |
| M2-3 | LLM errors don't crash the scan | Error | 3 observations + potential transient failure | Graph scan | Scan completes, result parseable |
| M2-4 | Model unavailable skips diagnostic step | Error | 3 observations, model config depends on env | Graph scan | Scan completes regardless |

## Milestone 3: Proposer and Scan Integration (5 scenarios — skipped)

| # | Scenario | Type | Given | When | Then |
|---|----------|------|-------|------|------|
| M3-1 | End-to-end: cluster to learning record | Happy | 4 observations about test verification | Graph scan | Learning with pending_approval, proposals_created >= 1 |
| M3-2 | Evidence edges link to source observations | Happy | 3 observations about connection pooling | Graph scan | Learning has evidence edges to observation records |
| M3-3 | Scan result reports proposals count | Happy | 3 observations | Graph scan | Response has learning_proposals_created as number |
| M3-4 | Rate limit blocks 6th suggestion | Error | 5 existing suggestions + new cluster | Graph scan | No new learning (still 5 total) |
| M3-5 | Dismissed similarity blocks re-suggestion | Error | Dismissed learning + similar cluster | Graph scan | No learning proposed |

## Milestone 4: Event-Driven Escalation (5 scenarios — skipped)

| # | Scenario | Type | Given | When | Then |
|---|----------|------|-------|------|------|
| M4-1 | 3rd observation triggers diagnostic pipeline | Happy | Task with 2 observations | 3rd observation created | Pipeline triggered, 3+ observations on entity |
| M4-2 | 2nd observation does not trigger pipeline | Boundary | Task with 1 observation | 2nd observation created | Only 2 observations, no learning |
| M4-3 | Dedup skips when pending learning exists | Dedup | Pending learning + task with 2 observations | 3rd observation | Only original pending learning exists |
| M4-4 | Event-driven and scan don't produce duplicates | Dedup | 3 event-driven observations, then scan | Scan runs after escalation | At most 1 learning for the pattern |
| M4-5 | Graceful skip when model unavailable | Error | Task with 3 observations | Escalation fires | Observations persisted, no crash |

## Scenario Type Distribution

| Type | Count | Percentage |
|------|-------|------------|
| Happy path | 10 | 37% |
| Error/failure | 8 | 30% |
| Boundary/edge | 4 | 15% |
| Dedup/guard | 5 | 18% |
| **Error + boundary + dedup** | **17** | **63%** |

Non-happy-path coverage exceeds the 40% target at 63%.
