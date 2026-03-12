# Journey: Semantic Verification (J1 + J4)

Maps the event-triggered LLM reasoning path from state transition to actionable observation.

## Actors

- **SurrealDB EVENT** — triggers on state transition
- **Observer Route** — receives webhook, dispatches to pipeline
- **Verification Pipeline** — gathers signals, runs deterministic checks
- **LLM Reasoning** — evaluates semantic contradiction with graph context
- **Graph** — stores observation + observes edge
- **User** — reads observation in feed/chat

## Journey Map

```
Step 1          Step 2              Step 3              Step 4                Step 5              Step 6
STATE           DISPATCH            GATHER              REASON                VERDICT             SURFACE
TRANSITION      ─────────►          SIGNALS             ─────────►            ─────────►          ─────────►
                                    ─────────►

Entity state    Observer route      Pipeline loads       LLM receives:         Pipeline creates    Observation
changes         receives POST,      entity + linked      - entity state        observation with    appears in
(e.g. task      validates table     decisions,           - related decisions   LLM verdict text,   feed, chat
completed)      + UUID, looks up    constraints,         - constraints         severity, type,     context, and
                entity from DB      commits, external    - external signals    confidence score,   agent prompts
                                    signals (GitHub)     - deterministic       evidence refs
                                                         check result
                                                         Produces structured
                                                         verdict + reasoning

Emotion:        Emotion:            Emotion:             Emotion:              Emotion:            Emotion:
(system)        (system)            (system)             (system)              Relief —            Confidence —
                                                                               contradiction       "the system
                                                                               caught early        caught this"
```

## Decision Points

| Step | Decision | Owner |
|------|----------|-------|
| 3 | If deterministic check returns `match` with high confidence, skip LLM call (cost optimization) | Pipeline |
| 4 | If LLM confidence below threshold, downgrade to `inconclusive` rather than `mismatch` | Pipeline |
| 4 | If LLM detects no contradiction, still record `match` observation with richer text (J4 benefit) | Pipeline |

## Error Paths

| Step | Failure | Handling |
|------|---------|----------|
| 3 | External signals unavailable (GitHub down) | Proceed with graph-only context. LLM reasons on available evidence. |
| 4 | LLM call fails (timeout, rate limit) | Fall back to deterministic verdict (current behavior). Log error observation. |
| 4 | LLM hallucinates entity references | Structured output schema enforces valid entity IDs. Post-validation strips invalid refs. |

## Shared Artifacts

| Artifact | Produced At | Consumed At |
|----------|-------------|-------------|
| `${entity}` | Step 2 (DB lookup) | Steps 3, 4 |
| `${related_decisions}` | Step 3 (graph query) | Step 4 |
| `${external_signals}` | Step 3 (GitHub API) | Step 4 |
| `${deterministic_verdict}` | Step 3 (pipeline) | Step 4 (LLM context) |
| `${llm_verdict}` | Step 4 (LLM output) | Steps 5, 6 |
| `${observation_id}` | Step 5 (DB create) | Step 6 (feed/chat) |
