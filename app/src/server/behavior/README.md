# Behavior

Measurable behavioral expectations attached to objectives, with LLM-based scoring, definition matching, and trend analysis for drift detection.

## The Problem

You set an objective: "All API endpoints must have error handling." How do you know if your agents are actually following it? You need measurable behavioral expectations that can be scored over time, with trend analysis that catches drift before it becomes a pattern. Manual code review doesn't scale when you have multiple autonomous agents making hundreds of changes per day.

## What It Does

- **Behavior definitions**: Workspace admins create configurable scoring criteria with thresholds and remediation guidance
- **LLM-based scoring**: Evaluates agent outputs against behavior definitions using an LLM scorer
- **Definition matching**: Matches behaviors to relevant definitions based on configurable rules
- **Trend analysis**: Detects drift, improvement, flat-line, and stable patterns over scoring history
- **Policy enforcement**: Behavior scores feed into the Authorizer — declining scores can restrict agent authority

## Key Concepts

| Term | Definition |
|------|------------|
| **Behavior** | A measurable expectation attached to an objective (e.g. "code changes include tests") |
| **Behavior Definition** | Admin-configured scoring criteria with threshold, enforcement mode, and remediation guidance |
| **Enforcement Mode** | `warn_only` (log observation) or `automatic` (block agent actions when score drops below threshold) |
| **Trend** | Computed pattern over recent scores: `drift` (declining), `improving`, `flat_line` (stagnant), `stable` |
| **Scorer Dispatcher** | Routes scoring requests to the appropriate scorer (LLM-based or definition-matched) |

## How It Works

**Example — detecting code quality drift:**

1. Admin creates behavior definition: "All PRs must include test coverage" with threshold 0.7 and enforcement `automatic`
2. Observer triggers behavior scoring after a coding session completes
3. Scorer dispatcher routes to LLM scorer with the behavior definition and session evidence
4. LLM evaluates: "3 of 5 files changed have no test coverage" → score 0.4
5. Trend analysis detects `drift` pattern (scores: 0.8 → 0.6 → 0.4)
6. Score below threshold + `automatic` enforcement → Authorizer restricts the agent's next session
7. Observation created: "Code quality behavior score declining — remediation needed"

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **No scoring history** | Returns `stable` trend — insufficient data for pattern detection |
| **All scores identical** | Returns `flat_line` — may indicate scoring is not discriminating |
| **Score oscillation** | Averages over window — short-term noise filtered out |
| **Missing definition** | Falls back to LLM-only scoring without threshold enforcement |

## Where It Fits

```text
Objectives
  |
  +---> Behaviors (measurable expectations)
          |
          +---> Behavior Definitions (admin-configured criteria)
          |
          +---> Scoring Pipeline
          |       |
          |       +---> Definition Matcher (rule-based)
          |       +---> LLM Scorer (evidence evaluation)
          |       +---> Score stored in graph
          |
          +---> Trend Analysis
          |       |
          |       +---> drift / improving / flat_line / stable
          |
          +---> Policy Enforcement
                  |
                  +---> Authorizer checks scores before granting intents
```

**Consumes**: Behavior definitions, agent session evidence, scoring history
**Produces**: Behavior scores, trend classifications, enforcement signals

## File Structure

```text
behavior/
  behavior-route.ts      # HTTP endpoints for behavior CRUD, scoring, and definitions
  definition-matcher.ts  # Matches behaviors to relevant definitions by configurable rules
  definition-types.ts    # Type definitions for behavior definitions and scoring criteria
  llm-scorer.ts          # LLM-based behavior scoring with evidence evaluation
  queries.ts             # SurrealDB CRUD for behaviors, definitions, and scores
  scorer-dispatcher.ts   # Routes scoring requests to appropriate scorer implementation
  trends.ts              # Pure trend analysis functions (drift, improving, flat-line, stable)
```
