# JTBD Analysis: Osabio LLM Proxy

**Date**: 2026-03-15
**Analyst**: Luna (product-owner)
**Feature**: LLM Proxy -- Universal Agent Gateway
**Job Type**: Greenfield (Job 1) -- cross-cutting infrastructure spanning auth, observability, governance, and agent coordination

---

## Workflow Classification

**ODI Phase**: Discovery (Phase 1) -- this is new infrastructure that does not exist yet
**Sequence**: research -> discuss -> design -> distill -> baseline -> roadmap -> split -> execute -> review
**Research status**: Complete (see `docs/research/llm-proxy-research.md` and `docs/research/coding-agent-internals-research.md`)
**Walking skeleton**: Exists -- basic transparent Anthropic proxy in `app/src/server/proxy/anthropic-proxy-route.ts`

---

## Stakeholder Personas

### Persona 1: Marcus Olsson (Workspace Admin)

**Who**: Solo founder running a Osabio workspace with multiple coding agents, responsible for budgets and governance policies.
**Demographics**:
- Technical proficiency: Expert -- writes code, manages infrastructure, configures policies
- Frequency: Daily interaction with Osabio dashboard; weekly policy review
- Environment: MacBook Pro, multiple terminal sessions, Osabio web UI open alongside
- Primary motivation: Maintain control over agent spending and behavior without micromanaging every action

**Job Step Table**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Define budget | Set spending limits per workspace/project/task | Minimize the likelihood of unexpected cost overruns |
| Configure policies | Establish which agents can use which models | Minimize the time to update agent access rules |
| Monitor spend | Track real-time cost attribution across projects | Minimize the time to identify which project/agent is consuming the most tokens |
| Investigate anomalies | Understand why a specific agent session was expensive | Minimize the number of tools needed to trace cost to root cause |
| Audit agent actions | Review what an agent did and why during a session | Minimize the likelihood of undetected unauthorized agent behavior |
| Enforce governance | Ensure agents operate within policy boundaries | Minimize the likelihood of policy violations going unnoticed |

**Pain Points**:
- "I have no visibility into what my coding agents are doing with the LLM" -> Job Step: Monitor spend
- "I cannot tell which task consumed $40 yesterday" -> Job Step: Investigate anomalies
- "Agents can use any model tier without restriction" -> Job Step: Configure policies
- "I manually check Anthropic's billing dashboard to understand costs" -> Job Step: Monitor spend

**Success Metrics**:
- Cost per project/task visible within 5 seconds of query
- Policy violation detected and blocked before the LLM call completes
- Complete audit trail from intent to LLM call to code change traversable in a single graph query
- Budget exceeded alert fires within 1 minute of threshold breach

---

### Persona 2: Priya Chandrasekaran (Developer)

**Who**: Senior developer using Claude Code daily through the Osabio proxy, working on 2-3 projects simultaneously.
**Demographics**:
- Technical proficiency: Expert -- lives in terminal, uses Claude Code for all coding tasks
- Frequency: 100-500 LLM API calls per day across 5-15 user interactions
- Environment: Multiple terminal sessions with Claude Code, each scoped to different tasks
- Primary motivation: Get work done fast without the proxy adding friction or latency

**Job Step Table**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Connect agent | Point Claude Code at the Osabio proxy | Minimize the number of configuration steps to start working |
| Work uninterrupted | Use Claude Code normally through the proxy | Minimize the latency overhead added by the proxy |
| Attribute work | Associate LLM calls with the task being worked on | Minimize the effort to tag work to the correct task/project |
| Review session cost | See how much a coding session cost after completing work | Minimize the time to understand session cost breakdown |
| Debug proxy issues | Diagnose when something goes wrong with the proxy | Minimize the time to determine if a failure is proxy vs upstream |

**Pain Points**:
- "I don't want to change how I use Claude Code" -> Job Step: Connect agent
- "If the proxy adds noticeable latency, I'll bypass it" -> Job Step: Work uninterrupted
- "I have no idea how much my debugging session just cost" -> Job Step: Review session cost
- "When something fails, I can't tell if it's the proxy or Anthropic" -> Job Step: Debug proxy issues

**Success Metrics**:
- Proxy adds less than 50ms latency to time-to-first-token
- Zero changes to Claude Code workflow -- just set `ANTHROPIC_BASE_URL`
- Session cost summary available immediately after session ends
- Proxy errors clearly distinguishable from upstream Anthropic errors

---

### Persona 3: Osabio Observer Agent (Autonomous Agent)

**Who**: Osabio's own Observer agent making LLM calls for graph scanning, verification, and pattern synthesis.
**Demographics**:
- Technical proficiency: N/A (autonomous software agent)
- Frequency: Periodic -- triggered by graph scans, observation verification, learning proposals
- Environment: Osabio server process, uses configured model providers
- Primary motivation: Complete analytical work within allocated budget and authority scope

**Job Step Table**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Authenticate | Prove identity and authority to the proxy | Minimize the likelihood of authentication blocking legitimate agent work |
| Request authorization | Validate that this LLM call is within policy scope | Minimize the time to receive authorization decision |
| Execute LLM call | Get a response from the model provider | Minimize the likelihood of proxy-introduced failures |
| Report usage | Have token usage and cost automatically attributed | Minimize the effort to attribute cost to the correct workspace/task |

**Pain Points**:
- "If the proxy rejects my call incorrectly, my observation verification stalls" -> Job Step: Request authorization
- "Cost attribution happens manually or not at all for internal agents" -> Job Step: Report usage

**Success Metrics**:
- Authorization decision within 10ms for pre-approved agent types
- Zero manual cost attribution -- all internal agent LLM calls automatically attributed
- Failed authorization produces actionable error with policy reference

---

### Persona 4: Elena Vasquez (Compliance Auditor)

**Who**: External auditor reviewing agent activity for a regulated client workspace, needs to verify what agents did and under what authority.
**Demographics**:
- Technical proficiency: Moderate -- comfortable with dashboards, not with raw logs
- Frequency: Quarterly audit cycles, ad-hoc investigation requests
- Environment: Osabio web UI, exported reports
- Primary motivation: Verify that agent actions were authorized and traceable

**Job Step Table**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Query activity | Find all LLM calls for a specific time period or project | Minimize the time to retrieve relevant activity records |
| Trace provenance | Follow the chain from LLM call back to authorizing intent and policy | Minimize the number of steps to establish full provenance chain |
| Verify authorization | Confirm each LLM call was authorized by an active policy | Minimize the likelihood of missing unauthorized calls |
| Export evidence | Produce audit artifacts for external review | Minimize the time to generate compliant audit reports |

**Pain Points**:
- "I need to verify every agent action has a policy backing it" -> Job Step: Verify authorization
- "Currently there is no audit trail for LLM calls -- they are invisible" -> Job Step: Query activity

**Success Metrics**:
- Every LLM call traceable to authorizing policy within 3 graph hops
- Activity query returns results in under 2 seconds for any time range
- Export produces complete provenance chain per LLM call

---

## Job Stories

### JS-1: Transparent Cost Visibility

**When** I finish a week of development across three projects and need to report time/cost allocation,
**I want to** see exactly how much each project consumed in LLM costs with per-task granularity,
**so I can** make informed decisions about where to invest more agent resources and justify the spending.

**Functional Job**: Attribute LLM costs to specific projects, tasks, and agent sessions.
**Emotional Job**: Feel confident that spending is transparent and defensible -- no hidden costs.
**Social Job**: Demonstrate to stakeholders that agent spending is tracked and accountable.

**Forces Analysis**:
- **Push**: Currently, Anthropic billing shows a single total with no project/task breakdown. Marcus manually estimates allocation by reviewing session timestamps. This takes 30+ minutes per week and is inaccurate.
- **Pull**: Per-task cost attribution computed automatically from every LLM call, viewable in the Osabio dashboard and queryable from the graph.
- **Anxiety**: "What if the proxy misattributes costs? What if it misses calls that bypass the proxy?"
- **Habit**: Checking Anthropic's billing dashboard directly. Rough mental accounting ("that big refactor was probably $20").
- **Assessment**: Switch likelihood HIGH. Push is strong (manual work, inaccuracy). Pull is concrete (automatic attribution). Key blocker: anxiety about accuracy. Design implication: proxy must capture 100% of calls with verifiable attribution.

---

### JS-2: Zero-Friction Agent Gateway

**When** I start a new coding session with Claude Code and need it routed through the Osabio proxy,
**I want to** have the proxy be completely transparent -- same API, same speed, same features,
**so I can** get Osabio's observability benefits without any change to my development workflow.

**Functional Job**: Route all LLM API calls through the proxy without modifying agent behavior.
**Emotional Job**: Feel that the proxy is invisible -- never reminded it exists during productive work.
**Social Job**: Not be "that person" who slows down the team by adding infrastructure overhead.

**Forces Analysis**:
- **Push**: Without the proxy, LLM calls are invisible to the Osabio graph. Agent sessions cannot be traced. Cost is unattributed.
- **Pull**: Set one environment variable and everything works. Zero latency overhead. Full trace capture in the background.
- **Anxiety**: "What if the proxy adds latency? What if it breaks streaming? What if extended thinking stops working?"
- **Habit**: Pointing Claude Code directly at `api.anthropic.com`. No configuration needed.
- **Assessment**: Switch likelihood MEDIUM-HIGH. Push is moderate (invisible calls). Pull is strong (one env var). Key blocker: latency anxiety + feature parity anxiety. Design implication: proxy MUST be a passthrough -- zero transformation, zero buffering on the hot path.

---

### JS-3: Governed Agent Autonomy

**When** I grant an agent elevated authority scope (e.g., allow it to make Opus-tier LLM calls for complex analysis),
**I want to** know that the proxy enforces my policies in real-time -- checking budget, model access, and rate limits before every call,
**so I can** expand agent autonomy confidently without worrying about runaway costs or unauthorized model usage.

**Functional Job**: Enforce workspace policies (budget, model access, rate limits) at the LLM call boundary.
**Emotional Job**: Feel in control of agent behavior even when granting significant autonomy.
**Social Job**: Be seen as a responsible steward of organizational resources and AI governance.

**Forces Analysis**:
- **Push**: Today, agents can call any model at any volume with no enforcement. A bug in an agent loop could burn through $500 in minutes.
- **Pull**: Policy enforcement at the proxy layer means agents physically cannot exceed their authority scope for LLM calls.
- **Anxiety**: "What if policy enforcement blocks legitimate work? What if it adds too much latency?"
- **Habit**: Trusting agents to self-regulate. Not having policies at all.
- **Assessment**: Switch likelihood HIGH. Push is strong (financial risk from uncontrolled agents). Pull is strong (automated enforcement). Key blocker: false positive anxiety (blocking good calls). Design implication: policy decisions must be fast (<10ms) and errors must clearly explain which policy blocked the call and how to get authorized.

---

### JS-4: Auditable Agent Provenance

**When** I need to audit what an agent did during a specific incident or time period,
**I want to** query the knowledge graph and see every LLM call with full provenance -- who authorized it, what policy governed it, which task it served, and what it produced,
**so I can** verify compliance, investigate incidents, and demonstrate responsible AI governance.

**Functional Job**: Store every LLM call as a first-class graph entity with edges to sessions, tasks, policies, and workspaces.
**Emotional Job**: Feel assured that nothing slips through the cracks -- every agent action is recorded.
**Social Job**: Demonstrate to auditors and regulators that the organization has verifiable AI governance.

**Forces Analysis**:
- **Push**: LLM calls are currently logged but not linked to the knowledge graph. You cannot query "show me all LLM calls for task X" or "which policy governed this call."
- **Pull**: Graph-native traces enable queries like "total cost of task X" and "full provenance chain from intent to LLM call to code change."
- **Anxiety**: "What if trace storage consumes too much database space? What if graph writes slow down the proxy?"
- **Habit**: Checking server logs with grep. No structured audit trail.
- **Assessment**: Switch likelihood HIGH. Push is strong (no audit trail). Pull is unique (graph-native provenance). Key blocker: performance anxiety. Design implication: trace writes MUST be async and non-blocking.

---

## Opportunity Scoring

Outcome statements derived from job stories, scored using team estimates (no external user survey available).

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the time to determine which project/task consumed the most LLM cost | 95 | 10 | 18.0 | Extremely Underserved |
| 2 | Minimize the likelihood of an agent exceeding its budget without detection | 90 | 15 | 16.5 | Extremely Underserved |
| 3 | Minimize the latency overhead added by the proxy to LLM calls | 90 | 70 | 11.0 | Appropriately Served |
| 4 | Minimize the number of steps to trace an LLM call back to its authorizing policy | 85 | 5 | 16.5 | Extremely Underserved |
| 5 | Minimize the likelihood of policy violations going undetected at the LLM layer | 88 | 10 | 16.6 | Extremely Underserved |
| 6 | Minimize the effort to configure the proxy for a coding agent | 80 | 60 | 10.0 | Appropriately Served |
| 7 | Minimize the time to identify the root cause of a proxy failure vs upstream failure | 75 | 20 | 13.0 | Underserved |
| 8 | Minimize the likelihood of losing LLM call data when the proxy restarts | 70 | 30 | 11.0 | Appropriately Served |
| 9 | Minimize the time to generate an audit report for a specific time period | 82 | 5 | 15.9 | Extremely Underserved |
| 10 | Minimize the number of configuration changes to support a new model provider | 65 | 40 | 9.0 | Overserved |

**Scoring Method**: Team estimates. Confidence: Medium. Sample: internal team assessment.

### Top Opportunities (Score >= 12)

1. **Cost attribution** (18.0) -- No solution exists today. Highest priority.
2. **Policy violation detection** (16.6) -- Agents currently operate without LLM-layer governance.
3. **Budget enforcement** (16.5) -- No spending controls at the agent level.
4. **Provenance tracing** (16.5) -- LLM calls not connected to the knowledge graph.
5. **Audit reporting** (15.9) -- No structured audit trail for LLM activity.
6. **Failure diagnosis** (13.0) -- Proxy errors are opaque when they occur.

### Overserved Areas (Score < 10)

1. **Multi-provider support** (9.0) -- Current Anthropic-only focus is appropriate for walking skeleton. Defer.

---

## 8-Step Universal Job Map: "Use LLM Through Osabio Proxy"

| Step | Description | Missing Requirements Risk |
|------|-------------|--------------------------|
| 1. **Define** | Developer decides to use Claude Code for a task | Needs to know proxy is available and how to connect |
| 2. **Locate** | Developer finds proxy URL and configuration instructions | Needs clear setup docs; `osabio init` should handle this |
| 3. **Prepare** | Developer sets `ANTHROPIC_BASE_URL` and optional attribution headers | Needs to be one command or zero config after initial setup |
| 4. **Confirm** | Developer verifies proxy is working (first request succeeds) | Needs health check endpoint; clear error if proxy is down |
| 5. **Execute** | Agent makes LLM calls through proxy; proxy forwards, captures, enforces | Core proxy functionality -- passthrough + async capture |
| 6. **Monitor** | Admin watches costs accumulate; proxy detects anomalies | Dashboard integration; spend alerts; anomaly detection |
| 7. **Modify** | Admin adjusts policies/budgets; developer troubleshoots failures | Policy updates take effect immediately; clear error messages |
| 8. **Conclude** | Session ends; final trace captured; cost summary available | Session-end detection; aggregated cost per session |

Steps 1-4 and 7-8 are where most requirements hide. The walking skeleton covers Step 5 only.

---

## Cross-References

- Research: `docs/research/llm-proxy-research.md` (proxy architecture, SSE passthrough, cost attribution)
- Research: `docs/research/coding-agent-internals-research.md` (agent loop patterns, traffic volumes, multi-model strategy)
- Walking skeleton: `app/src/server/proxy/anthropic-proxy-route.ts`
- Osabio architecture: policy graph, intent system, authority scopes, trace tables, observation system
