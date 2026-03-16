# Journey: Investigating a Failed Agent Action

## Emotional Arc Pattern: Problem Relief
Start: Frustrated/Confused | Middle: Focused/Hopeful | End: Relieved/Confident

## Actors

1. **Carla Navarro** -- workspace admin at a 12-person product team using Brain. She manages 3 projects and reviews Observer findings daily in the feed.
2. **Observer Agent** -- autonomous agent that scans the graph for contradictions, staleness, and drift. Consumes reasoning programmatically for self-calibration.
3. **Behavior Scorer** -- evaluates agent behavioral quality over time using scoring functions and trend analysis.

---

## Journey Flow (Happy Path)

```
  [TRIGGER]                [LOCATE]               [EXAMINE]
  Carla sees a         She opens the          She toggles
  conflict observation  observation detail      "View Logic"
  in the feed           to understand scope
       |                     |                      |
       v                     v                      v
  +----------+         +-----------+          +------------+
  | Feed Card|  --->   | Obs Detail|  --->    | LLM        |
  | severity:|         | text,     |          | Reasoning  |
  | conflict |         | evidence, |          | Panel      |
  |          |         | linked    |          |            |
  +----------+         | entities  |          +------------+
                       +-----------+                |
                                                    v
                                              [DIAGNOSE]
                                           She reads the
                                           chain-of-thought
                                           and checks evidence
                                                    |
                                                    v
                                              +------------+
                                              | Decision:  |
                                              | Valid find |
                                              | or false   |
                                              | positive?  |
                                              +-----+------+
                                                    |
                                        +-----------+-----------+
                                        |                       |
                                        v                       v
                                  [RESOLVE]               [CORRECT]
                              Acknowledge the          Resolve as false
                              valid finding            positive, note for
                              and create task          drift tracking
                                        |                       |
                                        v                       v
                                  +-----------+          +-----------+
                                  | Task      |          | Resolved  |
                                  | Created   |          | + Pattern |
                                  |           |          | Noted     |
                                  +-----------+          +-----------+
```

---

## Step-by-Step with Emotional Annotations

### Step 1: Trigger -- Conflict Observation Surfaces in Feed

**Actor**: Carla Navarro
**Action**: Reviews governance feed, sees a conflict-severity observation

```
+-- Feed -------------------------------------------------------+
|                                                                |
|  [!] CONFLICT  3 min ago                                       |
|  Task "Migrate billing to tRPC" contradicts confirmed          |
|  decision "Standardize on REST for public APIs"                |
|  Observer  |  confidence: 0.82  |  2 evidence refs             |
|                                                                |
|  [!] WARNING  18 min ago                                       |
|  Task "Add Redis caching" blocked for 14 days...               |
|                                                                |
+----------------------------------------------------------------+
```

**Emotional state**: Frustrated/Concerned -- "The Observer flagged something. Is this real or a false positive? I have no idea WHY it thinks there's a contradiction."
**Exit emotion**: Curious -- "Let me look deeper."

**Shared artifacts produced**: `${observation_id}`, `${observation_text}`, `${severity}`, `${confidence}`

---

### Step 2: Locate -- Open Observation Detail

**Actor**: Carla Navarro
**Action**: Clicks into observation detail view

```
+-- Observation Detail ------------------------------------------+
|                                                                |
|  CONFLICT  observation:a1b2c3d4                                |
|  Created: 2026-03-16 09:12 UTC  |  Observer  |  conf: 0.82    |
|                                                                |
|  Task "Migrate billing to tRPC" contradicts confirmed          |
|  decision "Standardize on REST for public APIs"                |
|                                                                |
|  Evidence:                                                     |
|    - decision:e5f6g7h8 "Standardize on REST..." (confirmed)    |
|    - task:i9j0k1l2 "Migrate billing to tRPC" (in_progress)    |
|                                                                |
|  Linked Entities: 2  |  Verified: No  |  Type: contradiction   |
|                                                                |
|  [ View Logic ]  [ Acknowledge ]  [ Resolve ]                  |
|                                                                |
+----------------------------------------------------------------+
```

**Emotional state**: Focused -- "I can see WHAT was flagged and the evidence refs. But I still do not know the reasoning."
**Exit emotion**: Anticipating -- "The 'View Logic' button is right there."

**Shared artifacts consumed**: `${observation_id}`, `${observation_text}`, `${evidence_refs}`
**Shared artifacts produced**: `${linked_decision_id}`, `${linked_task_id}`

---

### Step 3: Examine -- Toggle "View Logic" to See LLM Reasoning

**Actor**: Carla Navarro
**Action**: Clicks "View Logic" toggle

```
+-- Observation Detail ------------------------------------------+
|                                                                |
|  CONFLICT  observation:a1b2c3d4                                |
|  ...                                                           |
|                                                                |
|  +-- LLM Reasoning (internal telemetry) --------------------+  |
|  |                                                          |  |
|  |  The task "Migrate billing to tRPC" (task:i9j0k1l2)     |  |
|  |  explicitly targets the billing API for migration from   |  |
|  |  REST to tRPC. However, decision "Standardize on REST    |  |
|  |  for public APIs" (decision:e5f6g7h8, status: confirmed) |  |
|  |  requires all public-facing APIs to use REST.            |  |
|  |                                                          |  |
|  |  The billing API is public-facing (it serves external    |  |
|  |  payment provider webhooks). Therefore, migrating it     |  |
|  |  to tRPC would violate the confirmed decision.           |  |
|  |                                                          |  |
|  |  Claim: billing API should use tRPC                      |  |
|  |  Reality: confirmed decision requires REST for public    |  |
|  |  APIs                                                    |  |
|  |                                                          |  |
|  |  Confidence: 0.82                                        |  |
|  |  Model: anthropic/claude-sonnet  |  Trace: trace:x1y2z3  |  |
|  +----------------------------------------------------------+  |
|                                                                |
|  [ Hide Logic ]  [ Acknowledge ]  [ Resolve ]                  |
|                                                                |
+----------------------------------------------------------------+
```

**Emotional state**: Relieved/Illuminated -- "Now I can see EXACTLY why the Observer reached this conclusion. The reasoning is specific -- it identified the billing API as public-facing and connected that to the REST decision."
**Exit emotion**: Confident -- "This is a valid finding. The reasoning checks out."

**Shared artifacts consumed**: `${observation_id}`, `${reasoning}`, `${trace_id}`
**New data shown**: `${llm_reasoning_text}`, `${model_identifier}`, `${trace_link}`

---

### Step 4: Diagnose -- Evaluate Reasoning Validity

**Actor**: Carla Navarro
**Action**: Reads reasoning, cross-references with linked decision and task

**Decision tree**:
- If reasoning is sound and evidence supports the claim: proceed to Step 5a (Acknowledge)
- If reasoning has a flaw (e.g., billing API is actually internal-only): proceed to Step 5b (Resolve as false positive)

**Emotional state**: Analytical -- applying judgment to the LLM's reasoning.
**Exit emotion**: Decided -- "I know what to do."

---

### Step 5a: Resolve (Valid Finding) -- Acknowledge and Act

**Actor**: Carla Navarro
**Action**: Clicks "Acknowledge", then creates a task to address the contradiction

**Emotional state**: Productive -- "The system caught a real issue. I can act on it."
**Exit emotion**: Satisfied -- "The autonomous system works. It caught something humans missed."

---

### Step 5b: Correct (False Positive) -- Resolve and Note Pattern

**Actor**: Carla Navarro
**Action**: Clicks "Resolve" with resolution note

**Emotional state**: Mildly frustrated -- "False positive, but at least I could diagnose it in 2 minutes instead of 30."
**Exit emotion**: Constructive -- "This false positive pattern should be tracked for drift detection."

---

## Parallel Journey: Observer Self-Calibration (Programmatic)

```
  [LOAD]                    [COMPARE]                [SIGNAL]
  Observer loads             Compares reasoning       Creates observation
  recent observation         quality across time      about own drift
  reasoning in context       window
       |                         |                        |
       v                         v                        v
  query observation       pattern detection:        observation:
  WHERE workspace=$ws     - reasoning length         "Verification
  AND reasoning != NONE   - evidence density          reasoning quality
  ORDER BY created_at     - confidence clustering     declining: avg
  LIMIT 50                                            confidence 0.72
                                                      vs 0.85 last
                                                      month"
```

**Actor**: Observer Agent (programmatic)
**Shared artifacts consumed**: `${reasoning}` field on observation records
**Output**: New observation flagging reasoning quality drift, or behavior score input

---

## Error Paths

### E1: Reasoning Field Is Empty (Legacy Observation)

Observations created before this feature have no `reasoning` field. The "View Logic" toggle should handle this gracefully.

```
+-- LLM Reasoning (internal telemetry) -----------------------+
|                                                              |
|  No reasoning recorded for this observation.                 |
|  Observations created before [date] do not include           |
|  LLM chain-of-thought.                                      |
|                                                              |
|  Trace data may still be available: trace:x1y2z3             |
|                                                              |
+--------------------------------------------------------------+
```

### E2: LLM Call Failed During Verification

When `generateVerificationVerdict()` returns `undefined`, the observation is created with `source: "deterministic_fallback"` and no LLM reasoning. The UI should indicate the reasoning source.

```
+-- LLM Reasoning (internal telemetry) -----------------------+
|                                                              |
|  Reasoning unavailable: verification used deterministic      |
|  fallback (LLM call failed or timed out).                    |
|                                                              |
|  Deterministic verdict: mismatch                             |
|  Source: CI status check                                     |
|                                                              |
+--------------------------------------------------------------+
```

### E3: Reasoning Exists But Trace Is Missing

The trace link on the reasoning panel may point to a trace that was pruned or failed to persist.

```
  Trace: trace:x1y2z3 (not found)
```

---

## Integration Points

| From Step | To Step | Data Passed | Validation |
|-----------|---------|-------------|------------|
| Observer verification pipeline | Observation creation | `reasoning` string from `LlmVerdict.reasoning` | Must not be empty string when LLM was called successfully |
| Observation record | UI "View Logic" panel | `reasoning` field from observation table | Handle missing field for legacy observations |
| Observation record | Observer self-calibration | `reasoning` field via query | Query must filter `reasoning != NONE` for analysis |
| Intent authorization | Intent record | `llm_reasoning` from evaluation pipeline | Distinct from existing `reasoning` (human rationale) |
| Observation `trace_id` | Trace detail | Model stats link | Optional -- observation may not have direct trace_id |
