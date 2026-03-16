# Observer

Autonomous graph scanner — detects contradictions, verifies claims, analyzes traces, and synthesizes patterns into actionable suggestions and learnings.

## The Problem

The knowledge graph grows continuously as agents work. Decisions get made, tasks get marked complete, observations accumulate. But who checks that the graph is internally consistent? Who verifies that "task complete" actually means the work was done? Who notices that the same type of observation keeps appearing? The Observer is the always-on verification layer that catches drift before it compounds.

## What It Does

- **Graph scanning**: Scans for contradictions between decisions, stale tasks, status drift, and cross-project conflicts
- **LLM verification**: Verifies claims against evidence through reasoning pipelines with confidence scoring
- **Peer review**: Cross-validates findings to prevent false positives — a second LLM pass checks the Observer's own conclusions
- **Trace analysis**: Examines agent execution traces to identify session-level issues and response quality
- **Pattern synthesis**: Aggregates recurring observations into suggestions and proposes learnings for systemic fixes
- **SurrealDB event triggers**: Non-transient errors return 200 to prevent SurrealDB from retrying failed webhooks

## Key Concepts

| Term | Definition |
|------|------------|
| **Graph Scan** | Systematic traversal of the graph to find inconsistencies, staleness, and contradictions |
| **Verification Pipeline** | LLM evaluates a claim against evidence → produces confidence score + reasoning |
| **Peer Review** | Second LLM pass validates Observer's findings — reduces false positive rate |
| **Trace Analysis** | Examines agent session traces for tool call patterns, error rates, and response quality |
| **Pattern Synthesis** | Aggregates recurring observations → suggests learnings to prevent recurrence |
| **Confidence Score** | 0-1 rating of how certain the Observer is about a finding |

## How It Works

**Example — detecting decision contradiction:**

1. `POST /api/workspaces/:id/observer/scan` triggers graph scan
2. Scanner finds: Decision A says "Use PostgreSQL" (confirmed), Decision B says "Use MongoDB" (proposed) — both in same project
3. Verification pipeline: LLM analyzes both decisions with project context
4. Confidence: 0.91 — "These are contradictory database technology choices for the same data model"
5. Peer review: Second LLM confirms finding, adjusts to 0.89
6. Observation created: severity `conflict`, category `contradiction`, linked to both decisions
7. Pattern synthesis: This is the 3rd database technology contradiction → suggests learning: "Database technology decisions require explicit scope (which data models they cover)"

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Low confidence (<0.5)** | Finding discarded — insufficient evidence |
| **Peer review disagrees** | Confidence reduced; finding downgraded from conflict to warning |
| **Non-transient error** | Returns 200 to SurrealDB to prevent EVENT retry loops |
| **Rate limiting** | Scans throttled per workspace to prevent resource exhaustion |
| **Empty graph** | Scan completes with no findings — no false positives |

## Where It Fits

```text
Trigger: POST /observer/scan  OR  SurrealDB EVENT
  |
  v
Graph Scanner
  +---> Decision contradictions
  +---> Stale tasks (no updates for 7+ days)
  +---> Status drift (marked done but dependencies open)
  +---> Cross-project conflicts
  |
  v
Verification Pipeline (LLM)
  +---> Claim + evidence -> confidence score
  |
  v
Peer Review (LLM)
  +---> Cross-validate finding
  |
  v
Observation Created (if confidence >= threshold)
  |
  v
Pattern Synthesis
  +---> Recurring patterns -> suggest learnings
  +---> Isolated findings -> stay as observations
```

**Consumes**: Graph state, agent traces, observation history
**Produces**: Verified observations, pattern-based suggestions, proposed learnings

## File Structure

```text
observer/
  observer-route.ts              # HTTP endpoints: trigger scan, list findings
  graph-scan.ts                  # Graph traversal for contradiction/staleness detection
  verification-pipeline.ts       # LLM-based claim verification with confidence scoring
  session-trace-analyzer.ts      # Analyze agent session traces for quality issues
  trace-response-analyzer.ts     # Evaluate individual trace responses
```

## Related

- `agents/observer/` — The Observer Agent (LLM-based verification tool loop)
- `observation/` — Observation CRUD and persistence
- `learning/` — Learning suggestion from pattern synthesis
