# Four Forces Analysis: Objective & Behavior Nodes

## Forces Analysis: Strategic Alignment (Objective Nodes)

### Demand-Generating
- **Push**: Agents execute intents with no strategic traceability. Marcus's coding agent spent 4 hours refactoring a utility module while the Q2 launch feature was understaffed. The Observer Agent flagged it as an anomaly 2 days later -- after the compute was spent. Monthly AI bill shows $2,400 in agent compute with no way to answer "how much served our revenue target?"
- **Pull**: Every intent carries a `supports` edge to an active objective. The Authorizer Agent evaluates strategic alignment before minting tokens. The governance feed shows "Intent blocked: no active objective for 'refactor logging subsystem'" in real time. Objective progress dashboard shows 78% of Q2 compute aligned to revenue objectives.

### Demand-Reducing
- **Anxiety**: "What if we block a critical hotfix because nobody tagged an objective?" Legitimate spike/exploratory work might get caught in the gate. Maintaining objectives adds overhead -- who creates them? Who retires stale ones? What if the objective taxonomy becomes bureaucratic?
- **Habit**: Current workflow trusts agents to stay on-task via project context and learning nodes. No formal objective hierarchy. Engineers are accustomed to agents "just working" without strategic scaffolding.

### Assessment
- Switch likelihood: HIGH
- Key blocker: Anxiety about blocking legitimate work and objective maintenance overhead
- Key enabler: Push from untracked agent compute waste ($2,400/month with no alignment visibility)
- Design implication: Objectives must support an "exploratory" type with relaxed alignment requirements. Initial rollout should flag (observation with severity=warning) rather than block (deny intent). Objective lifecycle needs clear ownership (human creates/retires, agents cannot create objectives autonomously).

---

## Forces Analysis: Behavioral Quality Governance (Behavior Nodes)

### Demand-Generating
- **Push**: Coding agent "Coder-Alpha" shipped a payment-adjacent module with 0% test coverage last Tuesday. Agent "Coder-Beta" ignored a CVE advisory that was in its context window. Both caught by manual review 3 days later. The Observer Agent lacks vocabulary to express "process quality" -- it can flag contradictions but not craftsmanship degradation.
- **Pull**: Real-time behavior scores: Coder-Alpha's `TDD_Adherence` at 0.42, Coder-Beta's `Security_First` at 0.65. Policy node rule: "If `Security_First` < 0.8 for any agent, revoke `production_deploy` scope and create Learning node." Observer Agent extended to consume behavior records as input signals, detect `behavioral_drift` patterns, and propose targeted learnings via the existing learning pipeline (`POST /api/workspaces/:workspaceId/learnings`, three-layer collision detection, JIT prompt injection with 500-token budget). Feed card: "Coder-Alpha's TDD adherence dropped 30% this week -- 3 PRs with no test files."

### Demand-Reducing
- **Anxiety**: "What if the behavior score penalizes a legitimate hotfix where speed trumps TDD?" False positives erode trust in the system. Calibrating thresholds is hard -- what's the right TDD_Adherence score for a documentation agent vs a backend agent? Source telemetry (GitHub, Slack) requires integration work.
- **Habit**: Manual code review catches most quality issues eventually. Engineers mentally track which agents are "good" vs "sloppy." No formal behavioral data -- gut feel only. The Observer Agent already proposes learnings from observation clusters (PR #145) with dual-gate safety (rate limit + dismissed similarity check), but it operates on graph-level contradictions only -- it cannot detect craftsmanship degradation because behavior telemetry does not yet exist as an input signal.

### Assessment
- Switch likelihood: HIGH
- Key blocker: Anxiety about false positives and threshold calibration per agent role
- Key enabler: Push from real quality incidents (0% test coverage on payment module) discovered too late
- Design implication: Behavior scores must be contextual (metric_type + agent_role = different threshold). Support "exception mode" in policy rules (hotfix context relaxes TDD threshold). Initial rollout: observe-only mode (behavior nodes written, no policy enforcement) for 2 weeks to calibrate thresholds.

---

## Forces Analysis: Organizational Coherence (X-Ray Auditor)

### Demand-Generating
- **Push**: Brain graph has 847 nodes. Marcus noticed 12 decisions from January conversations that never became tasks. 3 features marked "in_progress" have no task children. 5 tasks marked "done" have no outcome observation. This was discovered by accident during a graph visualization session -- no systematic detection.
- **Pull**: Passive Auditor runs hourly graph queries detecting disconnected patterns. Feed cards: "Decision 'Use tRPC for all new APIs' (Jan 15) has no implementing task after 45 days." Objective progress view shows "Q2 Launch: 3 of 7 key results have no supporting intents this month." Coherence score per project: "Project Alpha: 0.92 coherence, Project Beta: 0.61 coherence."

### Demand-Reducing
- **Anxiety**: "Will the auditor spam my feed with false alerts?" Some disconnections are expected -- a question node doesn't always need a follow-up task. An observation might be informational with no action needed. Alert fatigue would make the feed unusable.
- **Habit**: Currently browsing the graph view manually when curious. Ad-hoc SurrealQL queries to check specific patterns. No systematic coherence tracking.

### Assessment
- Switch likelihood: MEDIUM-HIGH
- Key blocker: Anxiety about alert fatigue from false positives
- Key enabler: Push from growing graph with undiscovered disconnections (12 orphaned decisions found by accident)
- Design implication: Auditor needs a "expected disconnection" allowlist (e.g., observations with severity=info are not expected to produce tasks). Confidence scoring on alerts. Start with only high-confidence patterns: decisions without tasks after 14 days, objectives with zero supporting intents after 7 days.

---

## Forces Analysis: Cost-to-Value Governance

### Demand-Generating
- **Push**: Monthly agent compute is $2,400 and growing. Board asks "what's the ROI on your AI agents?" Marcus can answer by model (Sonnet: $1,200, Haiku: $800, embeddings: $400) but not by objective ("Revenue features: $X, Infrastructure: $Y, Unaligned: $Z"). No way to identify "organizational waste" in financial terms.
- **Pull**: Every authorized intent carries cost metadata. `supports` edge aggregates to objective-level spend. Monthly report: "Q2 Revenue: $1,400 (58%), Infrastructure Reliability: $600 (25%), Unaligned: $400 (17%)." Auto-veto for intents in spending categories with no active objective above $50 threshold.

### Demand-Reducing
- **Anxiety**: "Will cost tracking add latency to the hot path?" Intent authorization is already multi-step (RAR + DPoP + policy evaluation). Adding cost lookup could slow agent responsiveness. "Will agents start gaming the system by tagging cheap objectives?"
- **Habit**: Cost tracking at infrastructure level (OpenRouter dashboard, API key usage). Financial governance is a human activity done monthly in spreadsheets, not a graph-native real-time capability.

### Assessment
- Switch likelihood: MEDIUM
- Key blocker: Anxiety about authorization latency and cost tracking accuracy
- Key enabler: Push from board-level ROI questions that cannot be answered with current data
- Design implication: Cost metadata on `supports` edge is write-time only (no read-time gate). Aggregation is async batch job, not real-time. Start with intent-count-per-objective (free, no integration needed) before adding dollar-amount tracking (requires OpenRouter billing API integration).

---

## Cross-Force Summary

| Force | J1: Strategic | J2: Behavioral | J3: Coherence | J4: Cost |
|-------|--------------|----------------|---------------|----------|
| Push strength | HIGH | HIGH | MEDIUM-HIGH | MEDIUM |
| Pull strength | HIGH | HIGH | HIGH | MEDIUM |
| Anxiety strength | MEDIUM | HIGH | MEDIUM | MEDIUM |
| Habit strength | LOW | MEDIUM | LOW | MEDIUM |
| **Net assessment** | **Strong switch** | **Strong switch** | **Moderate switch** | **Moderate switch** |

### Priority Order (by net switching force)
1. **J1: Strategic Alignment** -- strongest push (waste), manageable anxiety (exploratory mode)
2. **J2: Behavioral Quality** -- strong push (incidents), high anxiety mitigated by observe-first rollout
3. **J3: Coherence Auditing** -- moderate push, builds on J1+J2 infrastructure
4. **J4: Cost Governance** -- moderate push, depends on J1 (objectives) being in place
