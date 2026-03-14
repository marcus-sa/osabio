# JTBD Job Stories: Objective & Behavior Nodes

## Job 1: Strategic Alignment Governance

### Job Statement
"Help me ensure every agent action serves a business objective so autonomous work stays strategically aligned."

### Job Story

**When** I have multiple autonomous agents executing tasks across projects,
**I want to** verify that every agent intent traces to an active business objective,
**so I can** prevent organizational waste and ensure agent work delivers measurable business value.

### Functional Job
Validate that agent intents map to active objectives before authorizing execution. Surface unaligned work for review.

### Emotional Job
Feel confident that autonomous agents are working toward the right goals, not just completing tasks. Eliminate the anxiety of "what are my agents actually doing and why?"

### Social Job
Demonstrate to stakeholders and investors that the organization's AI workforce operates with strategic discipline -- every dollar of compute serves a purpose.

### Forces Analysis
- **Push**: Agents currently execute intents without strategic context. Marcus cannot tell whether agent work serves Q2 revenue targets or is organizational noise. Recent incident: coding agent spent 4 hours refactoring a module with no active project objective.
- **Pull**: Every intent automatically traced to an objective. Authorizer Agent flags "Organizational Waste" before compute is spent. Dashboard shows strategic alignment score in real time.
- **Anxiety**: What if legitimate exploratory work gets blocked because it doesn't map to a formal objective? Will the overhead of maintaining objectives slow down the team?
- **Habit**: Currently trusting agents to do the right thing based on context in the knowledge graph. No formal objective tracking -- just projects, tasks, and decisions.

### Assessment
- Switch likelihood: HIGH
- Key blocker: Anxiety about blocking legitimate exploratory/spike work
- Key enabler: Push from wasted agent compute on unaligned work
- Design implication: Must support "exploratory" objective type that permits loosely-aligned work; flagging should be advisory before becoming mandatory

---

## Job 2: Behavioral Quality Governance

### Job Statement
"Help me track and enforce quality standards on how agents work, not just what they produce."

### Job Story

**When** I notice that agent output quality varies (some agents skip tests, others ignore security practices),
**I want to** track behavioral metrics like TDD adherence, security-first practices, and code quality patterns,
**so I can** enforce minimum quality standards through policy and catch craftsmanship degradation before it causes production incidents.

### Functional Job
Collect behavioral telemetry from agent sessions (test coverage patterns, security scan compliance, review cycle time), compute behavior scores, and enforce policy thresholds.

### Emotional Job
Feel in control of agent quality, not just agent output. Move from "hoping agents do good work" to "knowing they maintain standards."

### Social Job
Be recognized as a leader who governs AI quality with the rigor of an F1 team -- telemetry-driven, not gut-driven.

### Forces Analysis
- **Push**: A coding agent recently shipped code with zero test coverage for a payment-adjacent module. Another agent ignored a security advisory in its context. Both were discovered manually, days later.
- **Pull**: Real-time behavior scores per agent identity. Policy rules that automatically revoke production deployment scopes when Security_First drops below 0.8. Observer Agent extended to consume behavior telemetry, detect behavioral_drift patterns, and propose targeted learnings via the existing learning pipeline (three-layer collision detection, JIT prompt injection, dual-gate safety).
- **Anxiety**: Will behavior tracking create false positives? What if a legitimate trade-off (speed over tests for a hotfix) gets penalized? How do we calibrate thresholds?
- **Habit**: Currently relying on post-hoc code review and manual observation to catch quality issues. No systematic behavioral tracking. The Observer Agent already proposes learnings from observation clusters (PR #145), but lacks behavior telemetry as an input signal -- it only sees graph-level contradictions, not craftsmanship degradation.

### Assessment
- Switch likelihood: HIGH
- Key blocker: Anxiety about false positives and threshold calibration
- Key enabler: Push from real quality incidents discovered too late
- Design implication: Behavior scores must support contextual exceptions (hotfix mode); thresholds should be tunable per policy; initial rollout should be observational (warn) before enforcement (revoke)

---

## Job 3: Organizational Coherence Auditing

### Job Statement
"Help me detect disconnected work -- decisions without tasks, tasks without outcomes, objectives without progress -- before they become organizational debt."

### Job Story

**When** the knowledge graph grows with hundreds of nodes across multiple projects,
**I want to** automatically detect "organizational dissonance" -- nodes that should be connected but aren't,
**so I can** maintain graph coherence and ensure nothing falls through the cracks as the organization scales.

### Functional Job
Scan the graph periodically for disconnected patterns: objectives with no supporting intents, decisions with no implementing tasks, tasks with no outcome observations, behavior scores trending down without corrective learning nodes.

### Emotional Job
Feel that the knowledge graph is a living, coherent system -- not a graveyard of disconnected artifacts. Trust that important things won't silently rot.

### Social Job
Demonstrate organizational discipline -- every decision leads to action, every action leads to outcome, every objective has measurable progress.

### Forces Analysis
- **Push**: Graph already has nodes that were created months ago with no follow-up. Decisions made in conversations that never became tasks. Tasks completed with no recorded outcome. Growing unease that the graph is accumulating noise.
- **Pull**: Passive Auditor (X-Ray) agent that surfaces disconnected nodes automatically. Feed cards showing "3 decisions from last week have no implementing tasks." Objective progress tracking that shows stalled initiatives.
- **Anxiety**: Will the auditor generate too many false alerts? Some disconnected nodes are intentionally standalone (observations, questions). How to distinguish signal from noise?
- **Habit**: Currently doing ad-hoc graph exploration to find issues. No systematic coherence checking.

### Assessment
- Switch likelihood: MEDIUM-HIGH
- Key blocker: Anxiety about alert fatigue from false positives
- Key enabler: Push from growing graph incoherence
- Design implication: Auditor must understand which disconnections are expected vs anomalous; severity levels (info/warning/conflict) already exist in observation system; start with high-confidence patterns only

---

## Job 4: Objective-Driven Cost Governance

### Job Statement
"Help me link agent spend to strategic objectives so I can identify and eliminate compute waste."

### Job Story

**When** I am reviewing agent activity and compute costs across the organization,
**I want to** see a clear mapping between every authorized intent and the strategic objective it serves,
**so I can** identify spending categories without active objectives, optimize resource allocation, and justify AI investment to stakeholders.

### Functional Job
Map intents (with their compute/API costs) to objectives. Aggregate cost-to-value metrics per objective. Flag spending in categories with no active objective.

### Emotional Job
Feel financially responsible and strategically disciplined. Move from "AI costs are a black box" to "every dollar of agent compute traces to a business goal."

### Social Job
Present a credible, data-backed story to investors and board members about ROI of autonomous agent operations.

### Forces Analysis
- **Push**: Monthly AI compute bill growing with no visibility into which objectives the spend serves. Cannot answer "what percentage of agent work this month served our Q2 revenue target?"
- **Pull**: Cost-to-value dashboard per objective. Auto-veto for intents in spending categories with no active objective. Monthly strategic alignment report showing compute allocation across objectives.
- **Anxiety**: Will cost tracking add latency to intent authorization? Will it block time-sensitive agent actions?
- **Habit**: Currently tracking costs at the infrastructure level (API keys, model usage) not at the strategic level (which objective did this serve).

### Assessment
- Switch likelihood: MEDIUM
- Key blocker: Anxiety about adding latency to the authorization pipeline
- Key enabler: Push from growing, opaque AI costs
- Design implication: Cost mapping should be metadata on the supports edge, not a blocking step; aggregation is async/batch, not real-time gate

---

## Job-to-Journey Mapping

| Job | Primary Journey | Secondary Journey |
|-----|----------------|-------------------|
| J1: Strategic Alignment | Strategic Alignment | Organizational Coherence |
| J2: Behavioral Quality | Behavioral Governance | Strategic Alignment |
| J3: Coherence Auditing | Organizational Coherence | Behavioral Governance |
| J4: Cost Governance | Strategic Alignment | -- |
