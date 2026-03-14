# Requirements: Dynamic Behavior Definitions

## Business Context

Brain's current behavior scoring system uses a hardcoded `KNOWN_METRIC_TYPES` enum with two deterministic ratio-based scorers (TDD_Adherence, Security_First) and three unimplemented types (Conciseness, Review_Responsiveness, Documentation_Quality). This ceiling prevents workspace admins from measuring the soft skills and cultural values that matter most for autonomous agent governance: honesty, evidence-based reasoning, collaboration, thoroughness.

This feature replaces the hardcoded enum with user-defined Behavior Definitions scored by a specialized LLM "Scorer Agent," and closes the governance loop by integrating behavior scores into the Authorizer's policy evaluation and the Observer's learning proposal pipeline.

## Success Criteria

1. A workspace admin can create, activate, and retire behavior definitions in plain language without writing code
2. Agent actions are automatically scored against active definitions by a Scorer Agent
3. Low behavior scores trigger automatic capability restrictions via the Authorizer
4. The Observer proposes learnings from behavior score patterns
5. The complete "Reflex Circuit" (fabrication -> detection -> restriction -> diagnosis -> learning -> recovery) works end-to-end

## Personas

### Elena Vasquez -- Workspace Admin
- **Who**: Product manager leading a 4-person AI-augmented team with 3 coding agents and 1 design agent
- **Technical proficiency**: Comfortable with web UIs, does not write code
- **Frequency**: Daily interaction with Brain dashboard; weekly behavior review
- **Primary motivation**: Shape agent culture through explicit, measurable standards
- **Pain points**: Cannot measure honesty, collaboration, or evidence-grounding with current hardcoded metrics. Has no visibility into agent behavioral trends beyond TDD and Security.

### Coding-agent-alpha -- Autonomous Agent
- **Who**: An AI coding agent operating via MCP in Elena's workspace
- **Frequency**: Continuous operation, multiple sessions per day
- **Primary motivation**: Complete assigned tasks within authorized scopes
- **Pain points**: When restricted, receives unclear denial messages. Cannot self-diagnose behavioral issues.

### Marcus Chen -- Human Developer
- **Who**: Senior developer on Elena's team, works alongside coding agents
- **Frequency**: Views behavior scores weekly to understand agent reliability
- **Primary motivation**: Trust that agents he depends on are behaving honestly
- **Pain points**: Cannot verify whether an agent's status report is fabricated without manually checking the graph.

## Feature Breakdown

### Feature 0: Walking Skeleton -- The Reflex Circuit
**Priority**: Must Have (without this, the feature has no value)
**Jobs**: Job 2, Job 3
**Scope**: Minimum vertical slice proving the complete governance loop

### Feature 1: Behavior Definition CRUD
**Priority**: Must Have
**Jobs**: Job 1
**Scope**: Create, read, update, archive behavior definitions. Validation preview. Status lifecycle.

### Feature 2: Scorer Agent
**Priority**: Must Have
**Jobs**: Job 2
**Scope**: Specialized lightweight agent that evaluates telemetry against definitions. Evidence lookup. Rationale generation.

### Feature 3: Behavior Library UI
**Priority**: Should Have
**Jobs**: Job 1
**Scope**: Web UI for browsing, creating, editing behavior definitions. Community templates. Score dashboard.

### Feature 4: Policy/Authorizer Integration
**Priority**: Must Have
**Jobs**: Job 3
**Scope**: Dynamic metric names in policy predicates. Behavior score enrichment for dynamic definitions. Threshold-based restriction.

### Feature 5: Observer Integration Enhancement
**Priority**: Should Have
**Jobs**: Job 3 (conclude step)
**Scope**: Observer detects dynamic behavior score patterns. Proposes learnings from low scores. References behavior definitions in diagnosis.

### Feature 6: Graduated Enforcement
**Priority**: Could Have
**Jobs**: Job 3
**Scope**: Warn-only mode (default). Opt-in automatic restriction per definition. Manual override. Automatic recovery on score improvement.

## Non-Functional Requirements

### Performance
- Scorer Agent evaluation must complete within 30 seconds for a single telemetry event
- Behavior Library page must load within 2 seconds with up to 50 definitions
- Score timeline chart must render within 1 second with up to 200 data points

### Reliability
- Scorer Agent failures must not block agent actions (fail-open for scoring)
- Failed scoring events must be queued for retry (at least 3 attempts)
- Behavior records must be append-only; no scoring result is ever lost

### Security
- Only workspace admins can create, edit, or archive behavior definitions
- Behavior scores are workspace-scoped; no cross-workspace score visibility
- Scorer Agent has read-only access to the graph (cannot modify entities)

### Auditability
- Every behavior record must include the definition version that produced it
- Every restriction event must be traceable to the specific score and policy rule
- Every learning proposed from behavior scores must reference the triggering behavior record

## Business Rules

1. **Append-only scores**: Behavior records are never updated or deleted. New evaluations create new records.
2. **Active-only scoring**: Only definitions with status `active` are evaluated by the Scorer Agent.
3. **Definition versioning**: Editing an active definition increments its version. Historical scores reference the version that produced them.
4. **Deterministic fallback**: Existing deterministic scorers (TDD_Adherence, Security_First) continue working alongside LLM-scored definitions. They are represented as behavior definitions with scoring_mode=deterministic.
5. **Observer rate limit**: The Observer's existing 5-per-7-days learning proposal rate limit applies to behavior-triggered learnings.
6. **Recovery symmetry**: The threshold used to trigger a restriction must be the same threshold used to detect recovery.

## Domain Language Glossary

| Term | Definition |
|------|-----------|
| Behavior Definition | A user-created specification of a behavioral standard, expressed in plain language, with a goal, scoring logic, and applicable telemetry types |
| Behavior Node | A graph record containing a single scored evaluation of an agent action against a behavior definition (the existing `behavior` table) |
| Scorer Agent | A specialized lightweight LLM agent that evaluates telemetry events against behavior definitions and produces scores with rationale |
| Reflex Circuit | The complete governance loop: act -> score -> restrict -> diagnose -> learn -> recover |
| Scoring Rationale | The Scorer Agent's explanation of why a particular score was assigned, including evidence examined |
| Behavior Library | The web UI page for browsing, creating, and managing behavior definitions |
| Community Template | A pre-built behavior definition available system-wide that workspace admins can use as a starting point |
| Evidence Lookup | The process of querying the graph for data referenced in an agent's claims, used by the Scorer Agent to verify assertions |

## Risk Assessment

### Business Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| LLM scoring is too subjective for governance decisions | Medium | High | Show scoring rationale; support deterministic mode as fallback; allow dry-run before activation |
| API cost of LLM scoring at scale | Medium | Medium | Configurable telemetry type matching; batch scoring; cost estimation in UI |

### Technical Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Scorer Agent hallucination produces false scores | Medium | High | Evidence lookup grounding; rationale transparency; Observer cross-validation |
| Dynamic metric names break policy predicate parser | Low | High | Policy parser already supports dot-path; validate dynamic names against parser |
| Schema migration for behavior_definition table | Low | Low | Project convention: no backwards compatibility; clean schema change |

### Project Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Walking skeleton scope creep | Medium | Medium | Hard boundary: 7 steps, minimum viable per step |
| Feature depends on policy/authorizer changes | Low | Medium | Policy predicates already support behavior_scores dot-path |
