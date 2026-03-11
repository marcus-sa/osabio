# JTBD Job Stories: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11

---

## J1: Governance Visibility

### Job Story

**When** I am managing agent policies across a workspace with multiple identities and projects,
**I want to** see how policies connect to workspaces and identities in the graph,
**so I can** understand the governance topology and verify that coverage is complete.

### Functional Job
Visualize the governance structure -- which policies govern which identities, which policies protect which workspaces, and how policy versions relate (supersedes chains).

### Emotional Job
Feel confident that the governance setup is comprehensive and correctly configured. No blind spots, no orphaned identities without policy coverage.

### Social Job
Demonstrate to the team that governance is in place and well-structured. Be seen as someone who maintains clear oversight of agent permissions.

---

## J2: Intent Monitoring

### Job Story

**When** agents are requesting actions through the intent authorization pipeline,
**I want to** see intent nodes in the graph with their status and connections to tasks and agent sessions,
**so I can** understand the authorization flow and intervene when an intent is stuck or suspicious.

### Functional Job
Monitor the lifecycle of intents -- from draft through authorization to completion or veto. See which tasks triggered intents and which agent sessions are gated by them.

### Emotional Job
Feel in control of agent activity. Reduce anxiety about autonomous agents taking actions without visibility. Trust that the system surfaces problems before they escalate.

### Social Job
Show the team that agent actions are tracked and governed. Be seen as maintaining responsible AI operations.

---

## J3: Intent Feed Surfacing

### Job Story

**When** an intent gets vetoed by the authorization pipeline or a human reviewer,
**I want to** see vetoed intents in the governance feed within 24 hours of the veto,
**so I can** review what was blocked and understand why, without having to dig through logs.

### Functional Job
Surface recently-vetoed intents in the awareness tier of the governance feed with the veto reason, so the user knows what agent actions were blocked.

### Emotional Job
Feel reassured that the governance system is working -- vetoed intents prove the guardrails are active. No anxiety about missing important authorization events.

### Social Job
Demonstrate to stakeholders that the system catches and reports blocked agent actions, building trust in the platform's safety guarantees.
