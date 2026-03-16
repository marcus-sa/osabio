# US-04: Observer Reasoning Queries for Drift Detection

## Problem
The Observer agent currently detects behavioral drift through output patterns only -- observation severity distribution, confidence histograms, false positive rates. It cannot audit the QUALITY of its own reasoning because reasoning is not persisted. If the LLM starts producing shorter, less evidence-grounded verdicts, this degradation is invisible until false positives pile up and a human notices.

## Who
- Observer agent | Self-calibrating reasoning quality during graph scans | Needs to query recent reasoning programmatically
- Behavior scorer | Evaluating Observer agent quality | Needs reasoning content as input to scoring functions

## Solution
Provide query functions that load observation reasoning for programmatic analysis. The Observer can use these during self-calibration, and the behavior scorer can use them during evaluation cycles.

## Job Traces
- J2: Drift Detection (primary)

## Domain Examples

### 1: Observer Loads Recent Reasoning for Self-Calibration -- Elena's workspace

The Observer agent runs a scheduled scan on workspace "TechCorp Platform" managed by Elena Rodriguez. Before processing new entities, the Observer loads the last 50 observations with reasoning to calibrate its baseline:

Query returns 47 observations with reasoning (3 were deterministic fallback). The Observer computes:
- Average reasoning length: 312 characters (down from 428 last month)
- Average evidence references in reasoning: 1.8 (down from 2.4)
- Confidence distribution: 72% clustered between 0.70-0.75 (was evenly distributed 0.65-0.90)

The Observer creates an observation: "Verification reasoning quality showing signs of degradation: reasoning length down 27%, evidence density down 25%, confidence clustering near threshold."

### 2: Behavior Scorer Evaluates Observer -- Monthly scoring cycle

The behavior scorer runs the "Observer Verification Quality" behavior definition for workspace "Acme Product." It loads 30 recent observations with reasoning and evaluates:
- Specificity: 80% of reasoning texts reference specific entity IDs (passing threshold: 70%)
- Evidence grounding: 65% cite 2+ evidence refs (below threshold: 75%) -- score: 0.72
- Trend: down from 0.81 last period

The scorer records the trend and the behavior definition's remediation guidance triggers: "Consider reviewing Observer system prompt for evidence grounding emphasis."

### 3: No Reasoning Available -- New workspace with few observations

Workspace "StartupMVP" has only 5 observations, all from deterministic fallback (no LLM verification was triggered). The reasoning query returns 0 results. The Observer skips self-calibration and the behavior scorer records "insufficient data" for this period.

## UAT Scenarios (BDD)

### Scenario: Observer queries observations with reasoning for drift analysis
Given workspace "TechCorp Platform" has 50 observations created in the last 30 days
And 47 have reasoning populated (source: "llm" or "peer_review")
And 3 have no reasoning (source: "deterministic_fallback")
When the Observer queries observations with reasoning for self-calibration
Then the query returns 47 observations with reasoning, confidence, source, and created_at
And observations without reasoning are excluded from the result set
And results are ordered by created_at descending

### Scenario: Behavior scorer loads reasoning for quality evaluation
Given behavior definition "Observer Verification Quality" targets the Observer agent
And workspace "Acme Product" has 30 recent observations with reasoning
When the behavior scorer requests reasoning for evaluation
Then the scorer receives reasoning text and evidence_refs for each observation
And the scorer can compute specificity and evidence grounding metrics

### Scenario: Empty result when no LLM-backed observations exist
Given workspace "StartupMVP" has 5 observations all with source "deterministic_fallback"
When the Observer queries observations with reasoning
Then the query returns an empty result set
And the Observer skips self-calibration gracefully

### Scenario: Reasoning query respects workspace scope
Given observations with reasoning exist in both "TechCorp Platform" and "Acme Product"
When the Observer queries reasoning for workspace "TechCorp Platform"
Then only observations from "TechCorp Platform" are returned
And no cross-workspace reasoning leakage occurs

## Acceptance Criteria
- [ ] Query function returns observations with reasoning, confidence, source, evidence_refs, and created_at
- [ ] Query filters out observations where reasoning is NONE
- [ ] Query respects workspace scope
- [ ] Query supports configurable limit and time range
- [ ] Observer can consume query results for self-calibration metrics
- [ ] Behavior scorer can consume query results for scoring input

## Technical Notes
- New query function in `observation/queries.ts`: `listObservationsWithReasoning(input: { surreal, workspaceRecord, limit, sinceDate? })`
- SurrealQL: `SELECT id, reasoning, confidence, source, evidence_refs, created_at FROM observation WHERE workspace = $workspace AND reasoning != NONE ORDER BY created_at DESC LIMIT $limit`
- Per SurrealDB conventions: use bound parameters, RecordId for workspace
- This function is used by Observer agent context building (agents/observer/) and behavior scorer (behavior/)
- No new API endpoint needed -- this is internal server-side query only

## Dependencies
- US-01 (reasoning field must exist on observations for the query to return data)
