# Shared Artifacts Registry: Observer LLM Reasoning

## Artifact Definitions

| Artifact | Type | Source | Consumers | Lifecycle |
|----------|------|--------|-----------|-----------|
| `${entity_record}` | DB record | observer-route (DB lookup) | verification-pipeline, llm-reasoning | Per-event |
| `${related_decisions}` | Decision[] | verification-pipeline (graph query) | llm-reasoning | Per-event |
| `${constraints}` | Constraint[] | verification-pipeline (graph query) | llm-reasoning | Per-event |
| `${external_signals}` | Signal[] | external-signals (GitHub API) | verification-pipeline, llm-reasoning | Per-event, may be empty |
| `${deterministic_verdict}` | Verdict | verification-pipeline | llm-reasoning (context), observation (fallback) | Per-event |
| `${llm_verdict}` | StructuredVerdict | llm-reasoning | observation creation | Per-event, nullable on LLM failure |
| `${anomalies}` | Anomaly[] | graph-scan (deterministic queries) | llm-synthesis | Per-scan |
| `${patterns}` | Pattern[] | llm-synthesis | observation creation | Per-scan, may be empty |
| `${observation_id}` | RecordId | DB create | feed, chat context, agent prompts | Persistent |

## Structured Output Schemas

### LLM Verification Verdict

```typescript
type LlmVerdict = {
  verdict: "match" | "mismatch" | "inconclusive";
  confidence: number;        // 0.0 - 1.0
  reasoning: string;         // Natural language explanation (J4)
  evidence_refs: string[];   // Entity IDs referenced in reasoning
  contradiction?: {
    claim: string;           // What the entity claims
    reality: string;         // What the evidence shows
  };
};
```

### LLM Synthesis Pattern

```typescript
type SynthesisPattern = {
  pattern_name: "bottleneck_decision" | "cascade_block" | "priority_drift" | "stale_cluster" | "contradiction_cluster";
  description: string;         // Natural language synthesis
  contributing_entities: string[]; // Entity IDs (minimum 2)
  severity: "warning" | "conflict";
  suggested_action: string;    // Recommended resolution
};
```

## Data Flow Diagram

```
EVENT (state transition)
  |
  v
observer-route
  |-- validate table + UUID
  |-- load ${entity_record}
  |
  v
verification-pipeline
  |-- load ${related_decisions}, ${constraints}
  |-- gather ${external_signals}
  |-- compute ${deterministic_verdict}
  |
  |-- [if deterministic high-confidence match] --> skip LLM
  |
  v
llm-reasoning
  |-- input: entity + decisions + constraints + signals + deterministic verdict
  |-- output: ${llm_verdict} (structured)
  |-- [on failure] --> use ${deterministic_verdict}
  |
  v
create observation
  |-- verdict text from ${llm_verdict}.reasoning OR deterministic template
  |-- severity from verdict
  |-- link via observes edge
  |
  v
${observation_id} --> feed / chat / agent context


SCAN (manual or scheduled)
  |
  v
graph-scan (deterministic)
  |-- contradictions, stale blockers, drift
  |-- output: ${anomalies}
  |
  |-- [if empty] --> return, skip LLM
  |
  v
llm-synthesis
  |-- input: ${anomalies} + workspace context
  |-- output: ${patterns} (min 2 signals each)
  |-- [on failure] --> return ${anomalies} without synthesis
  |
  v
create synthesis observations
  |-- one per pattern
  |-- link to all contributing entities
  |-- dedup against existing open patterns
```
