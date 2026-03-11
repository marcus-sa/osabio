# Journey: Reality Verification

## Actor
Observer Agent (autonomous, event-triggered)

## Trigger
SurrealDB EVENT fires when `task.status` transitions to `completed` or `done`, or when `intent.status` transitions to `completed`.

---

```
[Task/Intent status change]
         │
         ▼
┌─────────────────────┐
│  1. EVENT fires      │  SurrealDB ASYNC webhook
│     POST /observe    │  payload: full record + $before/$after
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  2. Gather signals   │  Query external sources based on entity type:
│                      │  - task → GitHub CI status, test results
│                      │  - intent → action_spec outcome verification
│                      │  - commit → build status, lint results
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  3. Compare claim    │  Does the external signal match the
│     vs reality       │  claimed state transition?
└────────┬────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────────┐
│ MATCH  │ │  MISMATCH    │
└───┬────┘ └──────┬───────┘
    │              │
    ▼              ▼
┌────────────┐ ┌──────────────────────┐
│ 4a. Create │ │ 4b. Create           │
│ observation│ │ observation          │
│ verified:  │ │ severity: conflict   │
│ true       │ │ verified: false      │
│ type:      │ │ type: validation     │
│ validation │ │                      │
└────────────┘ │ 4c. Hold task in     │
               │ pending_verification │
               └──────────────────────┘
```

## Emotional Arc

| Step | Confidence | Note |
|------|-----------|------|
| 1. Event fires | Neutral | Automated, no human involved |
| 2. Signal gathering | Building | System is actively checking — something is watching |
| 3. Comparison | Tension | The moment of truth |
| 4a. Match | Relief/Trust | "The system confirmed it" |
| 4b. Mismatch | Alert/Action | "The system caught a lie before I did" — this is the *value moment* |

## Error Paths

| Error | Handling |
|-------|---------|
| External API unreachable | Create observation with `severity: warning`, `type: error`, note the source is unavailable. Do NOT block the task — absence of signal is not a negative signal. Retry via EVENT RETRY 3. |
| No external signal configured for entity type | Skip verification, create `info` observation noting no verification source is configured. Task proceeds normally. |
| Observer agent LLM call fails | Log error, create `warning` observation. Task proceeds — Observer failures must never block work. |
| EVENT webhook delivery fails | SurrealDB RETRY 3 handles transient failures. After 3 failures, the observation is simply not created — fail open, not closed. |
