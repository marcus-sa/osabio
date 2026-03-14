# Opportunity Scoring: Dynamic Behavior Definitions

## Scoring Method

- Importance: estimated % of workspace admins rating outcome 4+ on 5-point scale
- Satisfaction: estimated % of workspace admins rating current satisfaction 4+ on 5-point scale
- Score: Importance + max(0, Importance - Satisfaction)
- Priority: Extremely Underserved (15+), Underserved (12-15), Appropriately Served (10-12), Overserved (<10)

### Data Quality Notes
- Source: stakeholder analysis + codebase review + architecture context (team estimates, not user interviews)
- Sample size: single workspace admin persona extrapolated from product vision docs
- Confidence: Medium (team estimates grounded in existing codebase analysis)

---

## Job 1: Define Behavioral Standards

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the time to articulate a new behavioral value as a measurable standard | 90% | 5% | 17.5 | Extremely Underserved |
| 2 | Minimize the likelihood of creating a definition that conflicts with existing ones | 75% | 10% | 14.0 | Underserved |
| 3 | Minimize the effort to express complex values in evaluatable plain language | 85% | 5% | 16.5 | Extremely Underserved |
| 4 | Minimize the likelihood of an ambiguous definition producing inconsistent scores | 80% | 10% | 14.8 | Underserved |
| 5 | Minimize the time between defining a standard and seeing it enforced | 88% | 5% | 17.1 | Extremely Underserved |
| 6 | Minimize the likelihood of a definition producing misleading scores undetected | 82% | 15% | 14.9 | Underserved |
| 7 | Minimize the time to correct a definition that scores too harshly or leniently | 70% | 10% | 13.0 | Underserved |
| 8 | Minimize the likelihood of stale definitions producing irrelevant scores | 60% | 20% | 10.0 | Appropriately Served |

## Job 2: Real-time Behavioral Auditing

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 9 | Minimize the likelihood of an agent action going unscored against active definitions | 92% | 10% | 17.4 | Extremely Underserved |
| 10 | Minimize the time to identify which definitions apply to a given telemetry event | 78% | 15% | 14.1 | Underserved |
| 11 | Minimize the likelihood of the Scorer Agent evaluating with incomplete context | 85% | 10% | 16.0 | Extremely Underserved |
| 12 | Minimize the time between an agent action and the score being available | 80% | 5% | 15.5 | Extremely Underserved |
| 13 | Minimize the likelihood of Scorer Agent hallucination going undetected | 88% | 5% | 17.1 | Extremely Underserved |
| 14 | Minimize the time to diagnose and correct a scoring anomaly | 72% | 10% | 13.4 | Underserved |
| 15 | Minimize the likelihood of losing provenance data for a scored action | 65% | 40% | 9.0 | Overserved |

## Job 3: Behavioral Boundary Enforcement

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 16 | Minimize the time to detect when an agent's scores breach a threshold | 85% | 10% | 15.5 | Extremely Underserved |
| 17 | Minimize the likelihood of restricting the wrong agent capabilities | 90% | 5% | 17.5 | Extremely Underserved |
| 18 | Minimize the likelihood of a false positive restriction disrupting legitimate work | 92% | 5% | 17.9 | Extremely Underserved |
| 19 | Minimize the time between breach detection and capability restriction | 78% | 5% | 15.1 | Extremely Underserved |
| 20 | Minimize the time a well-behaved agent stays unnecessarily restricted | 75% | 5% | 14.5 | Underserved |
| 21 | Minimize the friction of restoring capabilities after recovery | 70% | 10% | 13.0 | Underserved |
| 22 | Minimize the likelihood of the same root cause recurring without a preventive learning | 80% | 25% | 11.5 | Appropriately Served |

---

## Top Opportunities (Score >= 15)

1. **#18** False positive restriction prevention -- Score: 17.9 -- Story: Warn-only mode, graduated enforcement
2. **#1** Time to articulate new standard -- Score: 17.5 -- Story: Behavior definition CRUD
3. **#17** Restricting wrong capabilities -- Score: 17.5 -- Story: Targeted scope restriction with provenance
4. **#9** Agent action going unscored -- Score: 17.4 -- Story: Automatic telemetry-to-definition matching
5. **#5** Time to enforcement -- Score: 17.1 -- Story: Activate definition and immediate scoring
6. **#13** Scorer hallucination detection -- Score: 17.1 -- Story: Scoring rationale display and audit
7. **#3** Effort to express values -- Score: 16.5 -- Story: Plain-language definition editor
8. **#11** Incomplete scoring context -- Score: 16.0 -- Story: Context assembly for Scorer Agent
9. **#12** Time to score availability -- Score: 15.5 -- Story: Real-time scoring pipeline
10. **#16** Time to detect threshold breach -- Score: 15.5 -- Story: Automatic threshold monitoring
11. **#19** Time to restriction -- Score: 15.1 -- Story: Authorizer integration with behavior scores

## Overserved Areas (Score < 10)

1. **#15** Provenance data retention -- Score: 9.0 -- Already well-served by append-only behavior table with source_telemetry FLEXIBLE object. No additional investment needed.

## Appropriately Served Areas (Score 10-12)

1. **#8** Stale definition management -- Score: 10.0 -- Low urgency; basic status lifecycle (active/archived) is sufficient
2. **#22** Recurring root cause prevention -- Score: 11.5 -- Already partially served by Observer's learning-from-trends pipeline; enhancement, not greenfield

---

## Prioritization Result: Story Mapping Rows

### Row 1: Walking Skeleton (Feature 0 -- Reflex Circuit)
Outcomes: #1, #5, #9, #12, #13, #16, #19
- Behavior Definition CRUD (create one definition)
- Scorer Agent scores one telemetry event
- Score appears in workspace behaviors
- Authorizer reads score and blocks if below threshold
- Observer proposes learning from low score

### Row 2: Library and Monitoring
Outcomes: #2, #3, #6, #7, #10, #11
- Behavior Library UI (browse, create, edit, import/export)
- Definition validation and dry-run mode
- Scoring rationale display
- Trend analysis for dynamic definitions
- Definition conflict detection

### Row 3: Graduated Enforcement
Outcomes: #17, #18, #20, #21
- Warn-only mode (default)
- Opt-in automatic restriction per definition
- Targeted scope restriction (not blanket)
- Automatic capability restoration on recovery
- Manual override for false positives
