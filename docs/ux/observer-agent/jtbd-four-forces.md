# Observer Agent — Four Forces Analysis

## Job 1: Reality Verification

| Force | Analysis |
|-------|----------|
| **Push** (current frustration) | Agents claim tasks are done but reality disagrees — tests fail, deploys break, APIs return errors. The human discovers this only when something downstream breaks, after context has moved on. The "Lying Agent" problem from the LinkedIn example: agents fabricate completion reports with no external grounding. |
| **Pull** (desired future) | Task completion is only trusted when an independent signal confirms it. The graph contains *verified* state, not *claimed* state. Humans stop being the verification layer. |
| **Anxiety** (adoption concerns) | Observer adds latency to the completion flow — tasks sit in `pending_verification` instead of immediately resolving. External API integrations (GitHub, CI) introduce new failure modes. False negatives could block legitimate completions. |
| **Habit** (current behavior) | Humans manually spot-check agent outputs. Trust is implicit — if an agent says "done", the graph reflects "done" immediately. No distinction between claimed and verified state. |

---

## Job 2: Cross-Agent Peer Review

| Force | Analysis |
|-------|----------|
| **Push** (current frustration) | Agents operate in silos — one agent's output is never challenged by another. Contradictions accumulate silently (e.g., architect decides tRPC but coder implements REST). The human is the only integration point, manually reconciling agent outputs across sessions. |
| **Pull** (desired future) | Any agent can write an observation about any other agent's work. The Observer acts as a dedicated reviewer, but the pattern is open to all agents. Contradictions surface structurally through `conflict` observations, not through human discovery. |
| **Anxiety** (adoption concerns) | Observation noise — too many low-value observations could drown out real signals. Agents reviewing each other could create circular disagreements. Defining "what warrants an observation" is subjective. |
| **Habit** (current behavior) | Observations exist but are only written reactively by chat/PM agents during conversations. No agent proactively scans for contradictions or verifies claims. The observation lifecycle (open/acknowledged/resolved) is human-driven, not event-driven. |
