# Evolution: Evidence-Backed Intent Authorization

**Feature**: intent-evidence
**Completed**: 2026-03-28
**Phases**: 8 (55 steps)
**Waves**: DISCUSS > DESIGN > DISTILL > DELIVER

## Summary

Added a deterministic evidence verification layer to the intent authorization pipeline. Autonomous agents must now provide typed references to existing graph records (decisions, tasks, observations, policies, etc.) when requesting authorization. The system verifies these references for existence, workspace scope, temporal ordering, status liveness, authorship independence, and minimum age before the LLM evaluator runs.

### Business Context

Brain's intent authorization system previously relied solely on LLM risk assessment. An agent could fabricate free-text reasoning to justify any action. Evidence-backed authorization grounds decisions in verifiable system state — agents must cite real graph records, and the system validates those citations deterministically before the expensive LLM evaluation.

### Capabilities Delivered

1. **Evidence Submission** — Agents attach `evidence_refs` (polymorphic record references) when creating intents via MCP
2. **Deterministic Verification Pipeline** — Pure function pipeline verifies each reference for existence, workspace scope, temporal ordering, and status liveness in a single batched SurrealDB query
3. **Risk Score Adjustment** — Evidence shortfall increases risk score (soft enforcement) or rejects pre-LLM (hard enforcement)
4. **Authorship Independence** — Detects self-referencing loops where an agent cites only its own authored records
5. **Risk-Tiered Requirements** — Evidence requirements scale with risk tier (low: 1 any, medium: 2+ with decision/task, high: 3+ with decision AND task/observation)
6. **Enforcement Graduation** — Bootstrap (exempt) → soft (penalty) → hard (reject) enforcement modes per workspace
7. **Governance Feed Visibility** — Feed displays evidence chains with verification status, expandable detail cards, and zero-evidence warnings
8. **Policy-Driven Overrides** — Workspace admins define per-action evidence rules via the existing policy system
9. **Anomaly Detection** — Observer detects systematic evidence fabrication patterns (spam, reuse)
10. **Entity Detail Drill-Down** — Evidence references are clickable links that navigate to entity detail panels for all evidence entity types
11. **Workspace Settings UI** — Admin controls for enforcement mode, maturity thresholds, and transition audit trail

## Phases Completed

### Phase 01: Walking Skeleton (3 steps)
- Schema migration for `evidence_refs` and `evidence_verification` on intent, `evidence_enforcement` on workspace
- Evidence types, constants, MCP tool definition, handler, and intent query persistence
- Soft enforcement: missing evidence elevates risk score

### Phase 02: Core Verification (12 steps)
- Valid evidence submission and verification via MCP
- Empty evidence handling, unsupported entity type rejection
- All verification checks: existence, cross-workspace scope, superseded decision liveness, temporal ordering
- Soft enforcement risk penalty calibration
- Verification result persistence with count and timing
- Individual failed reference identification

### Phase 03: Fabrication Resistance (13 steps)
- R2 schema migration for authorship and tier fields
- Proxy context injection of workspace enforcement mode
- Authorship independence checking (self-referencing detection)
- Agent-confirmed decision counting, minimum age checks
- Hard enforcement pre-LLM rejection gate
- Risk-tiered evidence type requirements (observations-only rejection for high-risk)
- Automatic bootstrap → soft → hard enforcement transition at maturity threshold

### Phase 04: Policy + Monitoring (6 steps)
- Policy-defined evidence requirements for specific action types
- Policy override of default tier requirements
- Default tier fallback for unmatched policies
- Observer evidence spam and reuse anomaly detection
- Normal usage non-triggering validation

### Phase 05: Feed + Bootstrapping (6 steps)
- Governance feed evidence chain display for pending intents
- Failed evidence highlighting with failure reasons
- Zero-evidence warning display
- Bootstrap mode exemption for new workspaces
- Bootstrap → soft transition at maturity threshold
- Admin manual enforcement mode override via workspace settings

### Phase 06: Feed Evidence Cards (5 steps)
- Shared contract extension with per-ref evidence detail types
- Feed query joins for evidence entity titles and verification results
- Evidence summary badges on intent feed cards
- Expandable evidence detail sections
- Zero-evidence warning and soft-penalty messaging

### Phase 07: Evidence Reference Drill-Down (5 steps)
- Entity detail route table allowlist extension for all evidence entity types
- Name resolution for observation, learning, git_commit entities
- Entity detail response builders for new evidence entity kinds
- EntityDetailPanel rendering for observation, learning, git_commit
- Clickable evidence ref links in feed navigating to entity detail

### Phase 08: Workspace Settings - Evidence Enforcement (5 steps)
- Workspace settings API endpoints (GET/PUT) for enforcement config
- Settings route and page shell with sidebar navigation
- Enforcement mode display with manual override control (shadcn Select)
- Threshold editing controls for maturity transition
- Enforcement transition audit trail display

## Key Design Decisions

### WD-01: Evidence Pipeline Placement — After Policy Gate, Before LLM
Pipeline runs after the cheapest check (policy gate ~5ms) and before the most expensive (LLM ~2-5s). Hard enforcement can reject pre-LLM. (ADR-078)

### WD-02: Single Batched SurrealDB Query for All Refs
All evidence refs (max 10) resolved in a single SurrealDB query. Sub-100ms p95 latency target. (ADR-079)

### WD-03: Pure Function Pipeline with Single Effect Boundary
Same pattern as `evaluatePolicyGate` — pure functions composed around a single DB read. Fully unit-testable. No AI SDK imports.

### WD-04: Enforcement Mode as Workspace-Level Data
`bootstrap | soft | hard` stored on workspace table, not feature flags. Each workspace progresses independently. Consistent with "no hardcoded modes" principle.

### WD-06: Risk Score Penalty Over Binary Reject for Soft Enforcement
+20 risk score per missing ref below tier requirement. Graduated penalty feeds naturally into existing risk routing logic. (ADR-080)

### WD-08: Lazy Maturity Evaluation for Bootstrap Transition
Transitions evaluated at intent evaluation time, not via background jobs. Transitions are infrequent (once per workspace lifecycle stage).

## Architecture Artifacts

Migrated to permanent locations:
- `docs/architecture/intent-evidence/architecture-design.md`
- `docs/architecture/intent-evidence/component-boundaries.md`
- `docs/architecture/intent-evidence/data-models.md`
- `docs/architecture/intent-evidence/technology-stack.md`
- `docs/scenarios/intent-evidence/test-scenarios.md`
- `docs/scenarios/intent-evidence/walking-skeleton.md`
- `docs/ux/intent-evidence/journey-evidence-lifecycle.yaml`
- `docs/ux/intent-evidence/journey-evidence-lifecycle-visual.md`

Related ADRs (already in `docs/adrs/`):
- ADR-078: Evidence verification pipeline placement
- ADR-079: Batched evidence query over per-ref lookups
- ADR-080: Graduated enforcement over binary switch

## Lessons Learned

1. **SurrealDB RecordId serialization** — Evidence refs returned from SurrealDB as RecordId objects needed string parsing for UI display. The `String(recordId)` format uses Unicode angle brackets, but webhook payloads use backticks.
2. **Entity table allowlists** — Multiple places in the codebase maintain separate lists of allowed entity tables (graph route, entity detail route, graph query function). Adding new entity types requires updating all of them — a maintenance risk.
3. **Settings auto-save pattern** — Initial implementation used per-field auto-save which caused race conditions. Consolidated to single PUT with shadcn Select component.
4. **Walking skeleton value** — The 3-step walking skeleton proved the E2E path early, catching integration issues before the detailed verification logic was built.
