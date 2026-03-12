# Journey: Pattern Synthesis (J3)

Maps the graph-scan LLM reasoning path from workspace scan to synthesized pattern observation.

## Actors

- **Trigger** — scheduled or manual `POST /api/observe/scan/:workspaceId`
- **Graph Scan** — queries workspace for anomalies
- **LLM Synthesis** — correlates anomalies into named patterns
- **Graph** — stores synthesis observation + observes edges to all contributing entities
- **User** — reads synthesis in feed, acts on root cause

## Journey Map

```
Step 1          Step 2              Step 3              Step 4                Step 5
TRIGGER         COLLECT             SYNTHESIZE          CREATE                SURFACE
SCAN            ANOMALIES           PATTERNS            OBSERVATIONS          ─────────►
                ─────────►          ─────────►          ─────────►

Scan triggered  Graph scan runs     LLM receives:       For each pattern:     Synthesis
(manual or      deterministic       - all anomalies     create observation    observations
scheduled)      queries:            - entity context     with type             appear in feed
                - contradictions    - workspace stats    "pattern",            grouped by
                - stale blockers    Identifies named     link to all           pattern name
                - status drift      patterns:            contributing
                - open obs cluster  - bottleneck         entities via
                                    - cascade risk       observes edges
                                    - priority drift
                                    - resource clash

Emotion:        Emotion:            Emotion:             Emotion:              Emotion:
Proactive —     (system)            (system)             (system)              Insight —
"let me check                                                                  "now I see the
the health"                                                                    bigger picture"
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Minimum 2 contributing anomalies per pattern | Prevents speculative single-signal synthesis |
| Dedup against existing open synthesis observations | Prevents repeated "decision X is a bottleneck" on every scan |
| Deterministic scan runs first, LLM synthesizes results | LLM never queries the graph directly — grounded on concrete anomalies |
| Pattern names are from a controlled vocabulary | Enables filtering/grouping in feed UI. Extensible enum, not free text. |

## Pattern Vocabulary (Initial)

| Pattern | Description | Minimum Signals |
|---------|-------------|:---------------:|
| `bottleneck_decision` | Multiple tasks/features blocked on a single unresolved decision | 2 blocked entities |
| `cascade_block` | Chain of blocked tasks where unblocking one would unblock downstream | 2 linked blocked tasks |
| `priority_drift` | High-priority items stale while low-priority items progressing | 2 mismatched items |
| `stale_cluster` | Group of related entities all stale beyond threshold | 3 stale entities |
| `contradiction_cluster` | Multiple contradictions pointing to same root decision | 2 contradictions |

## Error Paths

| Step | Failure | Handling |
|------|---------|----------|
| 2 | No anomalies found | Skip LLM call. Return empty scan result. |
| 3 | LLM call fails | Return deterministic anomalies without synthesis (current behavior). |
| 3 | LLM proposes pattern with <2 signals | Discard pattern. Log as debug. |

## Shared Artifacts

| Artifact | Produced At | Consumed At |
|----------|-------------|-------------|
| `${workspace_id}` | Step 1 (request) | Steps 2, 4 |
| `${anomalies[]}` | Step 2 (graph queries) | Step 3 |
| `${patterns[]}` | Step 3 (LLM output) | Step 4 |
| `${synthesis_observation_ids[]}` | Step 4 (DB creates) | Step 5 |
