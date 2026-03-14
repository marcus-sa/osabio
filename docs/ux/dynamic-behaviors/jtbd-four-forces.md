# Four Forces Analysis: Dynamic Behavior Definitions

## Job 1: Define Behavioral Standards

### Demand-Generating

- **Push**: The hardcoded `KNOWN_METRIC_TYPES` enum (`TDD_Adherence`, `Security_First`, `Conciseness`, `Review_Responsiveness`, `Documentation_Quality`) cannot capture team-specific values like honesty, thoroughness, or collaboration. Adding a new metric requires a code change, a new scorer function, a schema migration, and a deployment. Workspace admins have zero control over what gets measured.

- **Pull**: Plain-language behavior definitions that any workspace admin can create, edit, and activate without engineering involvement. A "Culture Builder" that lets you express "I want my agents to always cite evidence for their claims" and have it scored automatically within minutes.

### Demand-Reducing

- **Anxiety**: "What if the LLM Scorer Agent hallucinates scores? Deterministic ratio-based scoring (test_files / total_files) is at least predictable. An LLM scoring 'honesty' sounds subjective and unreliable." Also: "What if I write a bad definition and it unfairly punishes an agent?"

- **Habit**: The existing deterministic scorers (scoreTddAdherence, scoreSecurityFirst) work reliably today. Teams have built trust in ratio-based scores. The observer already proposes learnings from trends. "The current system is good enough for the metrics we track."

### Assessment
- Switch likelihood: **High** -- the push is strong because the enum is a hard ceiling on measurable behaviors
- Key blocker: Anxiety about LLM scoring reliability and subjectivity
- Key enabler: The promise of measuring soft skills (honesty, evidence-grounding) that are impossible to hardcode
- Design implication: The product MUST show scoring rationale alongside every score so admins can verify the Scorer Agent's reasoning. Deterministic scorers should remain available as a fallback/complement.

---

## Job 2: Real-time Behavioral Auditing

### Demand-Generating

- **Push**: Today, behavior scoring requires manual telemetry submission and only works for two metric types with ratio-based scorers. There is no automatic pipeline connecting agent actions to behavior scores. The admin discovers behavioral problems only through periodic graph scans by the Observer, which is rate-limited to 5 learning proposals per 7 days.

- **Pull**: Every agent action automatically scored against all relevant definitions. Scores appear in real-time in the feed. The admin sees a live behavioral dashboard showing which agents are aligned and which are drifting -- without running manual scans.

### Demand-Reducing

- **Anxiety**: "Scoring every action is expensive -- LLM calls per telemetry event could blow up API costs. What if the scoring pipeline becomes a bottleneck?" Also: "What if the Scorer Agent is slower than the action, creating a lag that makes 'real-time' a lie?"

- **Habit**: The current flow is: commit happens, telemetry is submitted via API, deterministic scorer runs, behavior record is created. It is pull-based and predictable. Moving to push-based automatic scoring is a paradigm shift.

### Assessment
- Switch likelihood: **High** -- manual scoring is clearly insufficient for continuous governance
- Key blocker: Cost and latency anxiety for LLM-based scoring at scale
- Key enabler: Automatic matching of telemetry to definitions eliminates the "forgot to score" gap
- Design implication: The product MUST support configurable scoring triggers (not every telemetry event needs LLM scoring). Batch scoring and priority queuing should be considered. Latency expectations must be set clearly in the UI.

---

## Job 3: Behavioral Boundary Enforcement

### Demand-Generating

- **Push**: Today, behavior_scores are available as dot-path predicates in policy RulePredicates, but there is no automatic enforcement loop. An admin must manually write policy rules that reference specific metric types. If an agent scores 0.0 on honesty, nothing happens automatically -- the admin would need to notice the score, write a policy rule, and apply it. The gap between detection and enforcement is entirely manual.

- **Pull**: Automatic circuit breaker: when an agent's behavior scores breach configurable thresholds, the Authorizer automatically restricts its scopes. The restriction appears in the admin feed with full provenance (which definition, which scores, which trend pattern). When scores recover, scopes are automatically restored. The "Reflex Circuit" closes the loop.

### Demand-Reducing

- **Anxiety**: "What if automatic restriction causes a production outage? If the coding agent is restricted mid-deployment because of a scoring anomaly, that could be worse than the behavior it was trying to prevent." Also: "Automatic scope restriction feels heavy-handed -- what if legitimate work patterns trigger false positives?"

- **Habit**: Today, humans control agent capabilities through explicit policy definitions. The authorizer evaluates intents against human-authored policies. "I trust my judgment more than an automated system to decide when an agent should be restricted."

### Assessment
- Switch likelihood: **Medium** -- high value but high anxiety
- Key blocker: Fear of false positive restrictions causing operational disruption
- Key enabler: The promise of automatic damage prevention ("circuit breaker") that works while the admin sleeps
- Design implication: The product MUST support a "warn-only" mode where threshold breaches create observations and feed items but do NOT automatically restrict scopes. Automatic restriction should be opt-in per definition. Every restriction must be reversible with one action.

---

## Cross-Job Force Summary

| Force | Job 1 (Define) | Job 2 (Audit) | Job 3 (Enforce) |
|-------|----------------|---------------|-----------------|
| Push strength | Very High (hard ceiling) | High (manual gap) | High (no auto-loop) |
| Pull strength | Very High (culture builder) | Very High (real-time scores) | High (circuit breaker) |
| Anxiety strength | Medium (LLM reliability) | Medium (cost/latency) | High (false positives) |
| Habit strength | Low (current enum is limiting) | Medium (pull-based works) | Medium (human control) |
| **Net force** | **Strong positive** | **Strong positive** | **Moderate positive** |

### Design Strategy to Tip Balance

1. **Reduce LLM anxiety**: Show scoring rationale with every score. Allow deterministic scorers alongside LLM-based ones. Provide a "dry run" mode for new definitions.
2. **Reduce cost anxiety**: Make scoring triggers configurable. Support batching. Show estimated cost per definition.
3. **Reduce enforcement anxiety**: Default to "warn-only" mode. Make auto-restriction opt-in. Provide instant manual override. Show clear provenance for every restriction.
