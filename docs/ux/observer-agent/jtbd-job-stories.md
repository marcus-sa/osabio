# Observer Agent — Jobs-to-be-Done: Job Stories

## Job 1: Reality Verification

> **When** an agent marks a task as completed, **I want** independent verification that the claimed outcome matches reality, **so I can** trust the graph state without manually spot-checking every claim.

### Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Compare agent claims (task status, intent outcomes) against external signals (CI status, test results, API responses, deploy health) |
| **Emotional** | Confidence that "done" means done — elimination of the nagging doubt that agents fabricate or hallucinate completion |
| **Social** | Team and stakeholders can trust the graph as ground truth without requiring human verification loops |

---

## Job 2: Cross-Agent Peer Review

> **When** any agent produces output that affects shared state, **I want** a separate agent to independently assess that output, **so I can** detect contradictions, quality gaps, and drift before they compound.

### Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Create verified observations with source attribution when an agent's output diverges from expectations, constraints, or prior decisions |
| **Emotional** | Relief from being the sole integration layer between agents — the system self-polices |
| **Social** | Agents are perceived as accountable; the organization can delegate more autonomy because verification is structural, not trust-based |

---

## Deferred

- **Job 3: Evidence-to-Learning Pipeline** — deferred until the Learning Agent is implemented.
