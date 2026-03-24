# JTBD Job Stories — openclaw-gateway

## Personas (Exclusions: Mission Control Operator)

| Persona | Description |
|---------|-------------|
| **Coding Agent Developer** | Developer using OpenClaw CLI, Cursor, or editor extensions to write code. Wants Brain's shared memory and governance without changing tools. |
| **Platform Engineer** | Engineer who provisions and configures Brain as a gateway for the team's OpenClaw agents. Manages device registration, authority scopes, and model routing. |
| **Autonomous Agent** | Non-human actor (coding agent, architect agent) executing tasks via the gateway protocol. Needs context injection, policy-bounded execution, and trace recording. |

---

## Job Stories

### J1: Context-Aware Coding Session

> **When** I start a coding session in my OpenClaw-compatible editor,
> **I want to** automatically receive relevant project decisions, constraints, and active learnings from the knowledge graph,
> **So I can** write code that aligns with architectural decisions without manually copy-pasting context.

**Persona**: Coding Agent Developer
**Dimensions**:
- Functional: Receive graph context at session start; submit work that flows through Brain's orchestrator
- Emotional: Feel confident that my agent "knows" the project; reduce anxiety about contradicting prior decisions
- Social: Be seen as shipping aligned code; avoid "didn't you read the decision?" feedback

---

### J2: Zero-Config Agent Onboarding

> **When** I connect a new OpenClaw device or agent to Brain for the first time,
> **I want to** authenticate with my existing device keys and be automatically registered,
> **So I can** start working immediately without manual `brain init` setup per agent.

**Persona**: Coding Agent Developer
**Dimensions**:
- Functional: Ed25519 device auth bridges to Brain identity; DCR auto-registers the agent as an OAuth client
- Emotional: Feel that onboarding is frictionless; no "wall of config" before first use
- Social: Recommend Brain to team without the caveat "setup takes 20 minutes per agent"

---

### J3: Governed Agent Execution

> **When** an autonomous agent submits work through the gateway,
> **I want to** have Brain evaluate policies, check budgets, and enforce authority scopes before execution,
> **So I can** trust that agents operate within defined boundaries without manual supervision.

**Persona**: Platform Engineer
**Dimensions**:
- Functional: Intent evaluation, policy graph check, budget enforcement, authority scope validation — all before LLM call
- Emotional: Feel safe giving agents autonomy; reduce fear of runaway spend or unauthorized actions
- Social: Demonstrate to leadership that agent autonomy is governed, auditable, and bounded

---

### J4: Native Trace Recording

> **When** an agent completes work through the gateway,
> **I want to** have every tool call, decision, and LLM interaction recorded as a native graph trace,
> **So I can** audit agent behavior, debug issues, and understand the full provenance chain.

**Persona**: Platform Engineer
**Dimensions**:
- Functional: Hierarchical trace recording in Brain's graph (not reconstructed from proxy logs); spans from intent to final action
- Emotional: Feel in control; confidence that nothing is a black box
- Social: Satisfy compliance requirements; answer "what did the agent do and why?"

---

### J5: Real-Time Agent Streaming

> **When** my agent is executing a task,
> **I want to** see LLM output tokens, file changes, and lifecycle events streamed in real time,
> **So I can** monitor progress and intervene (approve/deny exec requests) without waiting for completion.

**Persona**: Coding Agent Developer
**Dimensions**:
- Functional: WebSocket event stream maps Brain's `StreamEvent` to Gateway Protocol events; exec approval/denial flows through intent authorizer
- Emotional: Feel engaged and in control; reduce anxiety about "what is the agent doing right now?"
- Social: Share progress with teammates; demonstrate agent productivity

---

### J6: Multi-Agent Workspace Coordination

> **When** multiple agents connect to the same workspace through the gateway,
> **I want to** have them share context through the knowledge graph rather than direct messaging,
> **So I can** avoid the "telephone game" where instructions get distorted between agents.

**Persona**: Platform Engineer
**Dimensions**:
- Functional: Each agent reads/writes to the shared graph; presence tracking shows who's connected; decisions/observations are visible across agents
- Emotional: Feel that adding agents improves rather than degrades coordination quality
- Social: Be seen as running a well-coordinated engineering operation

---

### J7: Model Routing and Spend Control

> **When** agents request LLM completions through the gateway,
> **I want to** route requests to configured providers and track per-agent spend against budgets,
> **So I can** optimize costs and prevent any single agent from consuming disproportionate resources.

**Persona**: Platform Engineer
**Dimensions**:
- Functional: `model.list` returns configured models; Brain holds API keys (agents never see them); token salary enforcement per agent
- Emotional: Feel financially in control; no surprise bills
- Social: Report accurate per-agent cost breakdowns to stakeholders
