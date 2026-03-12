# JTBD Job Stories: Observer LLM Reasoning

## Job Stories

### J1 — Semantic Contradiction Detection (Priority 1)

**When** the observer detects a state transition (task completed, decision confirmed, commit created),
**I want** it to understand the semantic meaning behind decisions and compare against implementation reality,
**so I can** catch contradictions that string matching would miss — like "minimize dependencies" vs a task adding 5 new packages.

**Dimensions:**
- **Functional:** Detect semantic contradictions between decisions/constraints and implementation evidence
- **Emotional:** Confidence that nothing slips through the cracks
- **Social:** Team perceives the system as genuinely intelligent, not just a linter

---

### J2 — Reasoning-Quality Peer Review (Priority 3)

**When** another agent creates an observation,
**I want** the observer to evaluate whether the observation's reasoning is sound given the graph evidence,
**so I can** trust that surfaced signals are legitimate rather than noise from a confused agent.

**Dimensions:**
- **Functional:** Validate observation claims against graph state and linked evidence
- **Emotional:** Trust in the signal-to-noise ratio of the feed
- **Social:** Other agents' work is held accountable by a reasoning-capable reviewer

---

### J3 — Cross-Signal Pattern Synthesis (Priority 2)

**When** multiple anomalies accumulate across a workspace,
**I want** the observer to synthesize them into higher-order patterns (bottlenecks, cascading risks, systemic themes),
**so I can** act on root causes instead of chasing individual symptoms.

**Dimensions:**
- **Functional:** Correlate multiple signals into named patterns with evidence
- **Emotional:** Relief from cognitive overload of tracking many threads
- **Social:** Organization sees systemic issues surfaced before they escalate

---

### J4 — Contextual Natural Language Verdicts (Priority 4)

**When** the observer creates an observation,
**I want** it to produce a contextual, actionable explanation specific to the situation,
**so I can** understand the "so what" without digging into raw graph data.

**Dimensions:**
- **Functional:** Generate human-readable verdicts with specific context and recommended actions
- **Emotional:** Clarity — no mental translation from template-speak to meaning
- **Social:** Observations useful to non-technical stakeholders without interpretation
