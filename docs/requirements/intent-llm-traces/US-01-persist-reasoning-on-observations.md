# US-01: Persist LLM Reasoning on Observations

## Problem
Carla Navarro is a workspace admin who investigates Observer findings daily across 3 active projects. When the Observer creates a conflict observation (e.g., "Task contradicts confirmed decision"), she finds it impossible to determine WHY the Observer reached that conclusion without grepping server logs for `observer.llm.call` entries. This wastes 30-60 minutes per investigation and requires terminal access that not all admins have.

## Who
- Workspace admin | Reviewing Observer findings in governance feed | Needs to diagnose whether agent reasoning was sound without leaving the UI
- Observer agent | Self-calibrating reasoning quality | Needs to query own historical reasoning programmatically
- Behavior scorer | Evaluating Observer behavioral quality | Needs reasoning content as scoring input

## Solution
Store the LLM chain-of-thought reasoning string on the observation record when the Observer creates observations from LLM-backed verification. The reasoning captures HOW the agent reached its conclusion, distinct from the observation text which captures WHAT was concluded.

## Job Traces
- J1: Forensic Debugging (primary)
- J2: Drift Detection (secondary -- enables programmatic reasoning queries)

## Domain Examples

### 1: Verification Verdict Reasoning -- Carla investigates billing-tRPC contradiction

Carla Navarro sees a conflict observation in the Acme Product workspace feed: "Task 'Migrate billing to tRPC' contradicts confirmed decision 'Standardize on REST for public APIs'." She opens the observation detail and clicks "View Logic." The reasoning panel shows:

> The task "Migrate billing to tRPC" (task:i9j0k1l2) explicitly targets the billing API for migration from REST to tRPC. However, decision "Standardize on REST for public APIs" (decision:e5f6g7h8, status: confirmed) requires all public-facing APIs to use REST. The billing API is public-facing (it serves external payment provider webhooks). Therefore, migrating it to tRPC would violate the confirmed decision.

Carla confirms the reasoning is sound -- the billing API IS public-facing. She acknowledges the observation.

### 2: Peer Review Reasoning -- Observer validates a warning observation

The Observer peer-reviews an observation from the PM agent: "Redis caching task blocked for 14 days." The peer review LLM generates reasoning:

> The PM agent's observation cites task:redis001 (status: blocked, created 14 days ago). The linked entity confirms the blocked status and the duration claim. However, the task description mentions "waiting for infrastructure team approval" which is an expected external dependency, not a process failure. Verdict: questionable. Confidence: 0.55.

This reasoning is stored on the peer review observation. When Carla reviews it later, she sees the reasoning and agrees -- the block is expected, not alarming.

### 3: Anomaly Evaluation Reasoning -- Observer filters false positive

During a graph scan, the Observer evaluates a stale task candidate: task "Update GDPR compliance docs" has been in_progress for 21 days. The anomaly evaluation LLM generates reasoning:

> Task "Update GDPR compliance docs" (task:gdpr001) has been in_progress for 21 days. However, the task description states "Annual review -- scheduled for Q1 completion." Given the current date is mid-March and Q1 ends March 31, this timeline is expected. Verdict: not relevant.

The reasoning is logged (currently at `observer.scan.llm_filtered`) but NOT stored on an observation because the anomaly was filtered out. Only observations that ARE created get reasoning persisted.

## UAT Scenarios (BDD)

### Scenario: Verification verdict reasoning stored on observation
Given the Observer runs a graph scan on workspace "Acme Product"
And generateVerificationVerdict returns a verdict with reasoning for task "Migrate billing to tRPC"
When the Observer creates a conflict observation from the LLM verification result
Then the observation record has a "reasoning" field containing the LLM chain-of-thought
And the observation "text" field contains the conclusion text (not the reasoning)
And the observation "source" field is "llm"

### Scenario: Peer review reasoning stored on observation
Given the Observer peer-reviews an existing warning observation from the PM agent
And generatePeerReviewVerdict returns a verdict with reasoning
When the Observer creates a peer review observation
Then the observation record has a "reasoning" field with the peer review chain-of-thought
And the observation "source" field is "peer_review"

### Scenario: Deterministic fallback observation has no LLM reasoning
Given the Observer runs verification on task "Fix login bug"
And the deterministic check returns "match" with verified=true
And shouldSkipLlm returns true (deterministic match, no LLM needed)
When the Observer creates an observation from the deterministic result
Then the observation has source "deterministic_fallback"
And the observation has no "reasoning" field (or reasoning is NONE)

### Scenario: LLM call failure falls back without reasoning
Given the Observer runs verification on task "Deploy auth service"
And generateVerificationVerdict returns undefined (timeout after 30s)
When the Observer creates an observation using the deterministic fallback
Then the observation has source "deterministic_fallback"
And the observation has no "reasoning" field
And the observation text comes from the deterministic verdict

### Scenario: Contradiction detection reasoning stored on observation
Given the Observer graph scan detects contradictions via detectContradictions LLM call
And the LLM returns a contradiction with reasoning "Task implements REST override while decision requires GraphQL"
When the Observer creates a contradiction observation
Then the observation "reasoning" field contains the contradiction detection reasoning
And the observation "evidence_refs" includes both the decision and task references

## Acceptance Criteria
- [ ] New `reasoning` field (TYPE `option<string>`) added to `observation` table schema
- [ ] `createObservation()` in `observation/queries.ts` accepts optional `reasoning` parameter
- [ ] Observer graph scan passes LLM reasoning to `createObservation()` for all LLM-backed paths (verification, peer review, contradiction, anomaly)
- [ ] Observations with `source = "deterministic_fallback"` do not have reasoning populated
- [ ] Observation text (conclusion) and reasoning (chain-of-thought) are semantically distinct values

## Technical Notes
- Schema migration: Add `DEFINE FIELD reasoning ON observation TYPE option<string>;` -- no existing data migration needed (new field, legacy observations will have NONE)
- `createObservation()` input type in `observation/queries.ts` needs `reasoning?: string` parameter
- Four LLM reasoning paths in Observer that must pipe reasoning to `createObservation()`:
  1. `applyLlmVerdict()` result -> graph-scan observation creation
  2. `generatePeerReviewVerdict()` result -> peer review observation creation
  3. `detectContradictions()` result -> contradiction observation creation
  4. `evaluateAnomalies()` result -> anomaly observation creation (only for created observations, not filtered ones)
- Per project convention: `option<string>` for the field since legacy observations will not have it. No null, no default empty string.

## Dependencies
- None blocking. Schema migration is self-contained. Observer pipeline changes are within existing files.
