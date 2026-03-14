# Requirements: Objective & Behavior Nodes

## Business Context

The Brain platform currently governs **what** agents do (OAuth/RAR authorization, intent evaluation, policy enforcement). This feature adds governance for **why** agents work (Objectives) and **how well** they work (Behaviors), transforming Brain from a technical sandbox into a Strategic Operating System.

### Business Objectives
1. **Strategic Alignment**: Every agent intent traceable to a business objective, preventing organizational waste
2. **Quality Governance**: Behavioral metrics on agent craftsmanship with policy-driven enforcement
3. **Organizational Coherence**: Automatic detection of disconnected graph patterns (decisions without tasks, objectives without progress)
4. **Cost-to-Value Visibility**: Agent compute mapped to strategic objectives for ROI reporting

### Success Metrics
- 80%+ of authorized intents have a `supports` edge to an active objective within 30 days of rollout
- Behavior scores available for all active coding agents within 7 days of Observer Agent integration
- Coherence auditor detects 90%+ of orphaned decisions (decisions with no implementing task after 14 days)
- Monthly alignment report producible with zero manual data gathering

---

## Personas

### Elena Vasquez -- Engineering Lead
- **Context**: Manages 4 coding agents and 2 management agents at a 12-person AI-native startup
- **Motivation**: Needs strategic alignment visibility for board reporting; wants to prevent agent compute waste
- **Pain**: Cannot answer "what percentage of agent work serves our Q2 revenue target?" -- AI costs are a black box
- **Jobs**: J1 (Strategic Alignment), J4 (Cost Governance)

### Tomasz Kowalski -- Senior Platform Engineer
- **Context**: Responsible for agent quality and reliability; manages 6 coding agents with different specializations
- **Motivation**: Wants systematic quality governance instead of catching issues by accident in code review
- **Pain**: Coder-Alpha shipped 0% test coverage on a payment module; caught manually 3 days later
- **Jobs**: J2 (Behavioral Quality), J3 (Organizational Coherence)

---

## Feature Areas

### F1: Objective Node (Graph Layer)
New SCHEMAFULL table `objective` with fields: title, description, target_date, success_criteria, priority, status, workspace, embedding. Supports CRUD via chat extraction and direct creation. Lifecycle: active -> expired | completed | archived.

### F2: Supports Relation (Graph Layer)
New TYPE RELATION table `supports` (IN intent OUT objective). Created automatically by Authorizer during intent evaluation when semantic similarity exceeds threshold. Manual linking via feed card actions.

### F3: Behavior Node (Graph Layer)
New SCHEMAFULL table `behavior` with fields: metric_type, score, source_telemetry, workspace, created_at. Written by Observer Agent after each agent session. Linked to identity via `exhibits` relation edge.

### F4: Exhibits Relation (Graph Layer)
New TYPE RELATION table `exhibits` (IN identity OUT behavior). Created by Observer Agent when writing behavior records. One identity exhibits many behaviors over time.

### F5: Authorizer-Objective Integration (Agent Layer)
Authorizer Agent extended to evaluate intent-objective alignment during authorization. Semantic similarity between intent.goal embedding and active objective embeddings. Warning mode (observation) when no match; blocking mode (deny) as optional policy.

### F6: Policy-Behavior Integration (Policy Layer)
Policy rules extended to reference behavior metrics. Policy condition type: behavior metric threshold (e.g., "Security_First < 0.8 -> deny production_deploy"). Authorizer queries latest behavior scores during policy evaluation.

### F7: Behavior Dashboard (UI Layer)
Web UI showing per-agent behavior scores, trends (UP/DOWN/FLAT), threshold violations. Detail view with score history, source telemetry, sparkline charts. Accessible from workspace navigation.

### F8: Objective Progress View (UI Layer)
Web UI showing objective title, target date, progress bar, key results, supporting intents count, unaligned intents count. Accessible from workspace navigation and governance feed.

### F9: Strategic Alignment Report (UI Layer)
Monthly report view showing per-objective compute allocation percentages, unaligned intent categories, recommendations. Exportable for board presentations.

### F10: Coherence Auditor (Agent Layer)
Extension of Observer Agent (or dedicated X-Ray Agent) to run periodic graph queries detecting disconnected patterns: objectives with no supporting intents (14-day threshold), decisions with no implementing tasks, tasks with no outcome observations. Creates observations with appropriate severity.

### F11: Observer Behavior Extension + Learning Integration (Agent Layer)
Observer Agent extended to consume behavior records as input signals for its existing learning proposal pipeline (PR #145). When the Observer detects `behavioral_drift` patterns from behavior telemetry, it proposes targeted learnings for the underperforming agent via the existing learning API (`POST /api/workspaces/:workspaceId/learnings`). Learnings are proposed with status `pending_approval`, pass three-layer collision detection and dual-gate safety, and are injected into agent system prompts via JIT prompt injection after human approval.

---

## Non-Functional Requirements

### Performance
- Objective alignment evaluation completes within 200ms (must not add perceptible latency to intent authorization)
- Behavior dashboard loads within 2 seconds for workspaces with up to 50 agents and 10,000 behavior records
- Coherence auditor completes full scan within 30 seconds for workspaces with up to 5,000 nodes

### Security
- Objective and behavior data scoped to workspace (existing workspace isolation model applies)
- Human override of behavior policy veto logged with identity for audit trail
- Policy creation restricted to human identities (agents cannot create or modify behavior policies)

### Reliability
- Behavior scoring failure (Observer Agent down) must not block agent session execution
- Objective matching failure must not block intent authorization in warning mode
- Coherence auditor failures logged as observations, not silently swallowed

### Data Integrity
- Behavior records are append-only (scores never retroactively modified)
- Objective status transitions are auditable (status change logged with timestamp and actor)
- Supports edges are immutable once created (intent-objective link is permanent record)

---

## Business Rules

### BR-1: Objective Lifecycle
- Objectives are created by humans only (extraction from chat or direct creation)
- Agents cannot create, modify, or archive objectives autonomously
- Objective with target_date in the past transitions to "expired" (coherence auditor)
- Completed objectives require human confirmation

### BR-2: Alignment Evaluation
- Alignment uses semantic similarity (cosine distance) between intent.goal embedding and objective embeddings
- Threshold for automatic linking: similarity >= 0.7
- Threshold for warning: similarity < 0.5 for all active objectives
- Ambiguous matches (multiple objectives >= 0.5) linked to highest score, surfaced for human confirmation

### BR-3: Behavior Scoring
- One behavior record per agent session per metric type (not retroactively modifiable)
- Score range: 0.0 to 1.0 (normalized by Observer Agent)
- Trends computed from last 5 records minimum (insufficient data shows "--")
- New agents have no behavior data until first session completes

### BR-4: Policy Enforcement
- Behavior-based policy rules evaluate against latest behavior score (not average)
- Policy status "testing" means observe-only (log what would be vetoed, do not block)
- Policy status "active" means enforce (block intent if condition met)
- Human override of veto always available; override logged with identity

### BR-5: Observer Behavior Learning
- Learning proposed only for behavior trends (3+ consecutive below-threshold sessions), not single scores
- Observer proposes via existing learning API with source "agent", suggested_by "observer", status "pending_approval"
- Learning type is "instruction" for behavioral guidance, "constraint" for hard safety rules
- Three-layer collision detection prevents duplicate/contradictory learnings (existing infrastructure)
- Dual-gate safety: rate limit (5 per agent per 7 days) + dismissed similarity check (0.85) (existing infrastructure)
- Human approval required before learning becomes active (pending_approval -> active)
- Learning effectiveness measured by score improvement after injection (behavior records as evidence)
- Ineffective learnings (no improvement after review period) surfaced for human review via observations

---

## Dependencies

### Existing Infrastructure (Available)
- Intent system with authorization pipeline (intent table, Authorizer Agent)
- Policy system with rules evaluation (policy table)
- Identity system with agent types (identity table, agent table)
- Observation system with lifecycle (observation table, observes edge)
- Embedding generation pipeline
- SSE event streaming for feed cards
- Graph visualization (Reagraph)

### Existing Infrastructure (Available -- Learning System, PR #145)
- `learning` table: text, learning_type (constraint|instruction|precedent), status (active|pending_approval|dismissed|superseded|deactivated), source (human|agent), priority, target_agents, suggested_by, pattern_confidence, embedding
- `learning_evidence` relation: links learning to observation/message/trace/agent_session
- `supersedes` relation: links new learning to old learning
- Learning CRUD API: POST/GET/PUT `/api/workspaces/:workspaceId/learnings`, actions endpoint for approve/dismiss/deactivate/supersede
- Three-layer collision detection: learning vs learning (0.90), vs policy (0.40, hard block on contradiction), vs decision (0.55)
- Observer learning proposal pipeline: clusters observations, root cause analysis (policy_failure|context_failure|behavioral_drift), proposes learnings with dual-gate safety (rate limit 5/agent/7 days + dismissed similarity 0.85)
- JIT prompt injection: learnings loaded into agent prompts at runtime with 500-token budget (constraints always, instructions by priority, precedents by similarity)
- Learning Library UI: browse, filter, approve, edit, deactivate learnings

### New Infrastructure Required
- `objective` table + schema migration
- `behavior` table + schema migration
- `supports` relation table + schema migration
- `exhibits` relation table + schema migration
- Observer Agent extension for behavior telemetry collection
- Authorizer Agent extension for objective alignment evaluation
- Policy evaluation extension for behavior metric conditions

### External Dependencies
- None (all telemetry sources are internal to Brain -- agent session data, trace records)
- Future: GitHub API integration for richer source telemetry (PR data, CI results) -- out of scope for initial release

---

## Glossary

| Term | Definition |
|------|-----------|
| **Objective** | A strategic goal node in the graph. Every agent action should trace to an objective. |
| **Behavior** | A record of agent process quality (craftsmanship) for a specific metric type and session. |
| **Alignment Score** | Semantic similarity (0-1) between an intent's goal and an objective's description. |
| **Organizational Waste** | Agent compute spent on work that does not support any active objective. |
| **Craftsmanship** | Quality of agent process (how work is done), distinct from output quality (what is produced). |
| **Behavior Threshold** | Minimum acceptable behavior score defined in a policy rule. |
| **Coherence Score** | Ratio of properly-connected nodes to total nodes in a workspace graph. |
| **Exhibits Edge** | Graph relation linking an identity to a behavior record (identity ->exhibits-> behavior). |
| **Supports Edge** | Graph relation linking an intent to an objective (intent ->supports-> objective). |
