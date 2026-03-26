# Peer Review: Evidence-Backed Intent Authorization Architecture

```yaml
review_id: "arch_rev_20260326_intent_evidence"
reviewer: "solution-architect-reviewer"
artifact: "docs/feature/intent-evidence/design/*.md, docs/adrs/ADR-078.md, ADR-079.md, ADR-080.md"
iteration: 1

strengths:
  - "Pure function pipeline with single effect boundary follows established policy-gate pattern (ADR-078)"
  - "Batched SurrealDB query satisfies p95 < 100ms target with measurable design (ADR-079)"
  - "Graduated enforcement addresses cold-start bootstrap problem without disrupting existing workspaces (ADR-080)"
  - "No new external dependencies -- feature is entirely internal to existing stack"
  - "Reuse analysis explicitly documents what existing code is reused vs what is new and why"
  - "C4 diagrams cover L1, L2, and L3 for the complex subsystem (pipeline) with labeled arrows"
  - "Observability strategy specifies exact span attributes for monitoring"
  - "Schema migration strategy split by release with proper DEFINE FIELD OVERWRITE syntax"

issues_identified:
  architectural_bias:
    - issue: "None detected -- design extends existing patterns without introducing new paradigms or technologies"
      severity: "n/a"

  decision_quality:
    - issue: "ADR-079 could quantify the latency difference between batched and sequential more precisely (show measurement, not just estimate)"
      severity: "low"
      location: "ADR-079"
      recommendation: "Add note: measurements should be validated during Walking Skeleton implementation"
    - issue: "WD-06 penalty of +20 per missing ref is a magic number without empirical basis"
      severity: "medium"
      location: "wave-decisions.md WD-06"
      recommendation: "Document that +20 is a starting default to be calibrated during soft enforcement period; add observability to track actual routing impact"

  completeness_gaps:
    - issue: "No explicit error handling strategy for SurrealDB batch query failures"
      severity: "high"
      location: "architecture-design.md, component-boundaries.md"
      recommendation: "Document: if batch query fails, evidence verification returns a degraded result (verified_count=0, warning='verification unavailable') and the intent proceeds without evidence context. Fail-open in soft mode, fail-closed in hard mode."
    - issue: "Feed display architecture (US-08) is mentioned but not detailed at L2/L3"
      severity: "low"
      location: "architecture-design.md"
      recommendation: "Acceptable -- feed display is a Release 4 concern and the existing feed-queries.ts extension pattern is documented in component-boundaries.md"

  implementation_feasibility:
    - issue: "Batch query assumes SurrealDB SELECT FROM array-of-RecordIds returns heterogeneous results correctly. This should be validated."
      severity: "medium"
      location: "ADR-079"
      recommendation: "Walking Skeleton acceptance test should verify heterogeneous batch query (mix of decision, task, observation RecordIds) returns expected fields per entity type"

  priority_validation:
    q1_largest_bottleneck:
      evidence: "Free-text fabrication is the primary security gap (documented in research). Evidence verification directly addresses it."
      assessment: "YES"
    q2_simple_alternatives:
      evidence: "Three ADRs with 2+ alternatives each; wave-decisions.md documents 8 decisions with alternatives"
      assessment: "ADEQUATE"
    q3_constraint_prioritization:
      evidence: "Performance constraint (100ms) drives batch query decision; security constraint (zero false negatives) drives deterministic pipeline; adoption constraint drives graduated enforcement"
      assessment: "CORRECT"
    q4_data_justified:
      evidence: "Latency targets from KPIs (p95 < 100ms, p99 < 500ms); adoption targets (90%+ within 30 days); false rejection target (< 2%)"
      assessment: "JUSTIFIED"

approval_status: "conditionally_approved"
critical_issues_count: 0
high_issues_count: 1
```

## Revisions Required

### HIGH: Error handling for batch query failures

**Issue**: No explicit strategy for what happens when the SurrealDB batch query fails (connection error, timeout, malformed query).

**Resolution**: Added to architecture-design.md below.

**Strategy**:
- **Soft enforcement**: Fail-open. If the batch query fails, return a degraded `EvidenceVerificationResult` with `verified_count: 0`, `warnings: ["verification unavailable: {error}"]`. The intent proceeds to LLM evaluation without evidence context. Risk router applies maximum evidence shortfall penalty, routing the intent to veto window for human review.
- **Hard enforcement**: Fail-closed. If the batch query fails, reject the intent with `error_reason: "Evidence verification unavailable"`. This prevents authorization without evidence verification under hard enforcement.
- **Bootstrap enforcement**: Fail-open (evidence not required, so failure is informational).

This follows the project's "fail fast" principle for hard enforcement while maintaining availability under soft enforcement.

### MEDIUM: Penalty calibration note

**Issue**: +20 per missing ref is undocumented magic number.

**Resolution**: Documented in wave-decisions.md WD-06 that +20 is a starting default. Added: "This default should be calibrated during the soft enforcement adoption period using the `evidence.shortfall_penalty_total` span attribute to track actual routing impact. Adjust based on observed false rejection rate (KPI-5 target: < 2%)."

### MEDIUM: Heterogeneous batch query validation

**Issue**: Assumption about SurrealDB handling heterogeneous RecordId arrays needs validation.

**Resolution**: Documented in ADR-079 that Walking Skeleton acceptance tests must verify heterogeneous batch query behavior (mixed entity types in a single SELECT FROM array).

## Re-Review After Revisions

```yaml
review_id: "arch_rev_20260326_intent_evidence_v2"
reviewer: "solution-architect-reviewer"
iteration: 2
approval_status: "approved"
critical_issues_count: 0
high_issues_count: 0
notes: "All high and medium issues addressed. Error handling strategy documented. Penalty calibration plan in place. Batch query validation flagged for Walking Skeleton. Architecture is ready for handoff."
```

## Handoff Package

### For acceptance-designer (DISTILL wave)

- Architecture document: `docs/feature/intent-evidence/design/architecture-design.md`
- Component boundaries: `docs/feature/intent-evidence/design/component-boundaries.md`
- Data models: `docs/feature/intent-evidence/design/data-models.md`
- Technology stack: `docs/feature/intent-evidence/design/technology-stack.md`
- Wave decisions: `docs/feature/intent-evidence/design/wave-decisions.md`
- ADRs: `docs/adrs/ADR-078-evidence-verification-pipeline-placement.md`, `ADR-079-batched-evidence-query-over-per-ref-lookups.md`, `ADR-080-graduated-enforcement-over-binary-switch.md`
- DISCUSS wave artifacts: `docs/feature/intent-evidence/discuss/` (user stories, story map, KPIs, shared artifacts, prioritization, DoR validation)

### For platform-architect (DEVOPS wave)

- Development paradigm: **Functional** (pure pipelines, composition, effect boundaries)
- No new external integrations requiring contract tests
- New OpenTelemetry span attributes to monitor: `evidence.verification_time_ms`, `evidence.ref_count`, `evidence.verified_count`, `evidence.failed_count`, `evidence.enforcement_mode`, `evidence.tier_met`, `evidence.shortfall_penalty_total`
- Schema migrations required per release (2 migrations total)
- No new infrastructure dependencies

### Quality Gate Status

- [x] Requirements traced to components
- [x] Component boundaries with clear responsibilities
- [x] Technology choices in ADRs with alternatives
- [x] Quality attributes addressed (performance, security, reliability, maintainability, auditability, observability)
- [x] Dependency-inversion compliance (pure pipeline, injected dependencies)
- [x] C4 diagrams (L1 + L2 + L3 for complex subsystem, Mermaid)
- [x] Integration patterns specified
- [x] OSS preference validated (no new dependencies)
- [x] AC behavioral, not implementation-coupled
- [x] External integrations annotated (none new)
- [x] Architectural enforcement tooling recommended (dependency-cruiser)
- [x] Peer review completed and approved (iteration 2)
