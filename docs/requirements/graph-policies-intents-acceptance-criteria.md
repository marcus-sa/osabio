# Acceptance Criteria: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11

---

## US-GPI-1: Policy Nodes in Graph View

| # | Criterion | Source Scenario |
|---|-----------|----------------|
| AC-1.1 | Active and testing policies appear as nodes in workspace graph overview | Happy path |
| AC-1.2 | `governing` edges connect identity nodes to policy nodes | Happy path |
| AC-1.3 | `protects` edges connect policy nodes to workspace nodes | Happy path |
| AC-1.4 | Deprecated, draft, and superseded policies are excluded from graph | Boundary |
| AC-1.5 | Policy nodes use a distinct color via `entityColor("policy")` | Happy path |
| AC-1.6 | `EntityKind` type union includes `"policy"` | Contract |
| AC-1.7 | `KIND_LABELS` maps `"policy"` to `"Policy"` | Contract |
| AC-1.8 | Entity detail panel renders policy fields (title, status, version) | Edge case |

---

## US-GPI-2: Intent Nodes in Graph View

| # | Criterion | Source Scenario |
|---|-----------|----------------|
| AC-2.1 | Non-terminal intents (draft, pending_auth, pending_veto, authorized, executing) appear as graph nodes | Happy path |
| AC-2.2 | `triggered_by` edges connect intent nodes to task nodes | Happy path |
| AC-2.3 | `gates` edges connect intent nodes to agent session nodes | Happy path |
| AC-2.4 | Completed, vetoed, and failed intents are excluded from graph | Boundary |
| AC-2.5 | Intent node displays current status | Happy path |
| AC-2.6 | `GraphEntityTable` type includes `"intent"` | Contract |
| AC-2.7 | `KIND_LABELS` maps `"intent"` to `"Intent"` | Contract |
| AC-2.8 | Focused view accepts `?center=intent:<id>` for intent-centered navigation | Edge case |

---

## US-GPI-3: Vetoed Intents in Feed Awareness Tier

| # | Criterion | Source Scenario |
|---|-----------|----------------|
| AC-3.1 | Intents with `status = 'vetoed'` and `updated_at > now - 24h` appear in awareness tier | Happy path |
| AC-3.2 | Feed item `entityKind` is `"intent"` and `entityName` is the intent's `goal` field | Happy path |
| AC-3.3 | Feed item `reason` includes "Vetoed" and the evaluation reason text | Happy path |
| AC-3.4 | Feed item `status` is `"vetoed"` | Happy path |
| AC-3.5 | Feed item offers only `"Discuss"` action (no Approve/Override) | Happy path |
| AC-3.6 | Intents vetoed more than 24 hours ago are excluded | Boundary |
| AC-3.7 | Multiple vetoed intents are sorted by recency (most recent first) | Edge case |
| AC-3.8 | No duplicate feed items for intents already present in blocking tier | Error/dedup |

---

## US-GPI-4: Governance Edge Styles

| # | Criterion | Source Scenario |
|---|-----------|----------------|
| AC-4.1 | `edgeStyle("governing")` returns a style distinct from `edgeStyle("belongs_to")` | Happy path |
| AC-4.2 | `edgeStyle("protects")` returns a style distinct from `edgeStyle("belongs_to")` | Happy path |
| AC-4.3 | `edgeStyle("triggered_by")` returns a style distinct from `edgeStyle("has_task")` | Edge case |
| AC-4.4 | `edgeStyle("gates")` returns a style distinct from `edgeStyle("has_task")` | Edge case |
| AC-4.5 | Unknown edge types continue to use default style | Boundary |

---

## US-GPI-5: Entity Name Resolution for Intent and Policy

| # | Criterion | Source Scenario |
|---|-----------|----------------|
| AC-5.1 | `readEntityNameByTable(surreal, record, "intent")` returns the intent's `goal` field | Happy path |
| AC-5.2 | `readEntityNameByTable(surreal, record, "policy")` returns the policy's `title` field | Happy path |
| AC-5.3 | Missing intent/policy records return `undefined` (skip behavior preserved) | Error path |

---

## Cross-Cutting Criteria

| # | Criterion | Scope |
|---|-----------|-------|
| AC-X.1 | `EntityKind` type change does not break existing TypeScript compilation (all exhaustive switches updated) | All stories |
| AC-X.2 | `GraphEntityTable` type change does not break existing graph query functions | US-GPI-1, US-GPI-2 |
| AC-X.3 | Existing feed items (decisions, questions, observations, suggestions, agent sessions, pending_veto intents) continue to appear correctly | US-GPI-3 |
| AC-X.4 | Existing graph nodes (projects, features, tasks, decisions, etc.) continue to appear correctly | US-GPI-1, US-GPI-2 |
