# Journey: Behavioral Quality Governance

## Overview
**Goal**: Track and enforce quality standards on how agents work (process quality), not just what they produce (output).
**Persona**: Tomasz Kowalski, Senior Platform Engineer at a startup using Brain. Responsible for agent quality and reliability. Manages 6 coding agents with different specializations.
**Jobs Served**: J2 (Behavioral Quality Governance), J3 (Organizational Coherence Auditing)

## Emotional Arc
```
Confident                                                         *
                                                               *     *
                                                            *
Focused                                          *  *  *
                                               *
                                            *
Curious                                  *
                                      *
Hopeful                            *
                                *
Frustrated   *  *  *  *  *  *
          |---------|---------|---------|---------|---------|---------|
          Step 1    Step 2    Step 3    Step 4    Step 5    Step 6    Step 7
          Discover  Define    Collect   Review    Create   Enforce   Observe
          Quality   Behavior  Telem-    Behavior  Policy   Thresh-   & Learn
          Gap       Metrics   etry      Scores    Rules    olds
```

## Journey Flow

```
+------------------------------------------------------------------+
|  BEHAVIORAL QUALITY GOVERNANCE JOURNEY                            |
+------------------------------------------------------------------+

  [Tomasz reviews a PR from Coder-Alpha]
        |
        v
  +-- Step 1: Discover Quality Gap ------------------------------+
  | Tomasz notices Coder-Alpha's PR for payment module has 0%    |
  | test coverage. Checks last 5 PRs -- pattern of declining    |
  | test quality. No way to track this systematically.           |
  |                                                              |
  | Brain's Observer Agent flagged a contradiction 3 days ago    |
  | but the observation said "missing test files" -- no          |
  | behavioral context like "TDD adherence trending down."       |
  |                                                              |
  | Feeling: Frustrated -- "I caught this by accident. How       |
  |          many quality issues am I missing?"                  |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 2: Define Behavior Metrics ----------------------------+
  | Tomasz tells Brain about the behavioral metrics he wants:    |
  |                                                              |
  | "Track TDD adherence for all coding agents. Also track      |
  |  security-first practices and code review responsiveness."   |
  |                                                              |
  | Brain creates behavior metric types:                         |
  |                                                              |
  | +----------------------------------------------------------+ |
  | | BEHAVIOR METRICS DEFINED                                 | |
  | |                                                          | |
  | | 1. TDD_Adherence                                         | |
  | |    Description: Ratio of test-covered code to total      | |
  | |    Applies to: code_agent                                | |
  | |    Score range: 0.0 - 1.0                                | |
  | |                                                          | |
  | | 2. Security_First                                        | |
  | |    Description: Compliance with security advisories      | |
  | |    Applies to: code_agent                                | |
  | |    Score range: 0.0 - 1.0                                | |
  | |                                                          | |
  | | 3. Review_Responsiveness                                 | |
  | |    Description: Time to address review feedback          | |
  | |    Applies to: code_agent                                | |
  | |    Score range: 0.0 - 1.0                                | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Frustrated -> Hopeful -- "Now I have vocabulary    |
  |          to express what 'quality' means"                    |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 3: Collect Behavioral Telemetry ----------------------+
  | Observer Agent begins watching agent sessions and writing    |
  | behavior nodes:                                              |
  |                                                              |
  | After Coder-Alpha's session:                                 |
  |   RELATE identity:coder-alpha ->exhibits-> behavior:b1      |
  |   behavior:b1 = {                                            |
  |     metric_type: "TDD_Adherence",                            |
  |     score: 0.42,                                             |
  |     source_telemetry: {                                      |
  |       session: agent_session:xyz,                            |
  |       files_changed: 12,                                     |
  |       test_files_changed: 2,                                 |
  |       coverage_delta: -8%                                    |
  |     }                                                        |
  |   }                                                          |
  |                                                              |
  | After Coder-Beta's session:                                  |
  |   behavior:b2 = {                                            |
  |     metric_type: "Security_First",                           |
  |     score: 0.65,                                             |
  |     source_telemetry: {                                      |
  |       session: agent_session:abc,                            |
  |       cve_advisories_in_context: 2,                          |
  |       cve_advisories_addressed: 1                            |
  |     }                                                        |
  |   }                                                          |
  |                                                              |
  | Feeling: Hopeful -> Curious -- "Data is flowing. Let's      |
  |          see what it tells us"                               |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 4: Review Behavior Scores ----------------------------+
  | Tomasz opens the behavior dashboard:                         |
  |                                                              |
  | +----------------------------------------------------------+ |
  | | AGENT BEHAVIOR SCORES                                    | |
  | |                                                          | |
  | | Agent          | TDD    | Security | Review  | Trend    | |
  | | --------------|--------|----------|---------|---------- | |
  | | Coder-Alpha   | 0.42   | 0.91     | 0.88    | v DOWN   | |
  | | Coder-Beta    | 0.78   | 0.65     | 0.72    | - FLAT   | |
  | | Coder-Gamma   | 0.95   | 0.93     | 0.95    | ^ UP     | |
  | | Coder-Delta   | 0.81   | 0.85     | 0.60    | v DOWN   | |
  | | Architect-1   | --     | 0.90     | 0.92    | ^ UP     | |
  | | PM-Agent      | --     | --       | 0.88    | - FLAT   | |
  | |                                                          | |
  | | ! 2 agents below threshold (TDD < 0.7, Security < 0.8)  | |
  | | Coder-Alpha: TDD_Adherence 0.42 (threshold: 0.70)       | |
  | | Coder-Beta: Security_First 0.65 (threshold: 0.80)       | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Curious -> Focused -- "Now I can see the           |
  |          problem agents at a glance"                         |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 5: Create Policy Rules for Behavior ------------------+
  | Tomasz creates a policy linking behavior scores to scopes:   |
  |                                                              |
  | "If any coding agent's Security_First score drops below     |
  |  0.8, revoke production deployment scope immediately"        |
  |                                                              |
  | Brain creates policy node:                                   |
  | +----------------------------------------------------------+ |
  | | POLICY: Security Behavior Gate                           | |
  | |                                                          | |
  | | Selector:                                                | |
  | |   agent_role: code_agent                                 | |
  | |   resource: production_deploy                            | |
  | |                                                          | |
  | | Rules:                                                   | |
  | |   1. IF behavior.Security_First < 0.8                    | |
  | |      THEN deny production_deploy                         | |
  | |      PRIORITY: 100                                       | |
  | |                                                          | |
  | | Status: testing (observe-only for 2 weeks)               | |
  | | Human veto required: yes                                 | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Focused -- "Policy defined. Starting in test       |
  |          mode so we can calibrate"                           |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 6: Policy Enforcement Triggered ----------------------+
  | Two weeks later, policy status changed to "active."          |
  | Coder-Beta's Security_First is still 0.65.                   |
  |                                                              |
  | Coder-Beta submits intent:                                   |
  |   goal: "Deploy auth-service v2.3 to production"            |
  |   action_spec: { provider: "github", action: "deploy" }     |
  |                                                              |
  | Authorizer evaluates:                                        |
  |   1. Check policy: Security Behavior Gate                    |
  |   2. Query: Coder-Beta's Security_First = 0.65 < 0.8        |
  |   3. Rule effect: DENY                                       |
  |   4. Intent status: "vetoed"                                 |
  |                                                              |
  | Feed card:                                                   |
  | +----------------------------------------------------------+ |
  | | x INTENT VETOED BY BEHAVIOR POLICY                       | |
  | | Intent: "Deploy auth-service v2.3 to production"         | |
  | | Agent: Coder-Beta                                        | |
  | | Policy: Security Behavior Gate                           | |
  | | Reason: Security_First score 0.65 < threshold 0.80      | |
  | |                                                          | |
  | | Agent's recent security gaps:                            | |
  | |   - Ignored CVE-2026-1234 in session Mar 5              | |
  | |   - No security scan in last 3 sessions                 | |
  | |                                                          | |
  | | Actions: [Override (human)] [Review Agent] [Adjust Rule] | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Focused -> Confident -- "The system enforced       |
  |          the policy automatically with clear reasoning"      |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 7: Observer Proposes Behavior Learning ----------------+
  | Observer Agent detects Coder-Beta's behavior gap via its     |
  | existing learning proposal pipeline (PR #145):               |
  |                                                              |
  | 1. Clusters behavior records: Security_First trending down   |
  | 2. Classifies root cause: behavioral_drift                   |
  | 3. Proposes learning via POST /api/workspaces/:id/learnings: |
  |                                                              |
  | +----------------------------------------------------------+ |
  | | LEARNING PROPOSED (pending_approval)                     | |
  | |                                                          | |
  | | For: Coder-Beta (target_agents: ["coder-beta"])          | |
  | | Type: instruction                                        | |
  | | Text: "Always address CVE advisories present in your     | |
  | |        context window before proceeding with feature     | |
  | |        work. Security patches take priority."            | |
  | | Priority: high                                           | |
  | | Source: agent (observer)                                 | |
  | |                                                          | |
  | | Collision check: passed (no duplicate learnings,         | |
  | |   no policy contradiction, no decision conflict)         | |
  | | Dual-gate: passed (3/5 rate limit, no dismissed match)   | |
  | |                                                          | |
  | | Evidence: behavior:b2, behavior:b5, behavior:b8          | |
  | |   (3 sessions with Security_First < 0.80)               | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Tomasz approves the learning in the Learning Library.        |
  | Status transitions: pending_approval -> active.              |
  |                                                              |
  | Next time Coder-Beta starts a session, the learning is       |
  | loaded via JIT prompt injection (500-token budget).           |
  | Constraints always included; instructions by priority.       |
  |                                                              |
  | Feeling: Confident -> Satisfied -- "The system doesn't      |
  |          just block, it teaches. Agents improve over time."  |
  +--------------------------------------------------------------+
```

## Shared Artifacts

| Artifact | Source | Displayed As | Consumers |
|----------|--------|-------------|-----------|
| `${behavior_id}` | `behavior` table (SurrealDB) | Record ID | Exhibits edge, dashboard, policy evaluation |
| `${metric_type}` | `behavior.metric_type` field | String enum | Dashboard columns, policy conditions, learning nodes |
| `${behavior_score}` | `behavior.score` field | Float 0-1 | Dashboard cells, policy evaluation, trend computation |
| `${source_telemetry}` | `behavior.source_telemetry` field | Object | Dashboard detail view, learning node context |
| `${identity_name}` | `identity.name` field | Text string | Dashboard rows, feed cards, learning nodes |
| `${policy_threshold}` | `policy.rules[*].condition` field | Float | Dashboard threshold markers, policy evaluation |
| `${behavior_trend}` | Computed from behavior score history | UP/DOWN/FLAT | Dashboard trend column, Observer behavior extension input |
| `${learning_text}` | `learning.text` field | Text string | JIT prompt injection (500-token budget), Learning Library UI |
| `${learning_type}` | `learning.learning_type` field | constraint/instruction/precedent | Collision detection, JIT loading priority |
| `${learning_status}` | `learning.status` field | pending_approval/active/dismissed/deactivated/superseded | Learning Library lifecycle, prompt injection filter |

## Error Paths

| Error | User Sees | Recovery |
|-------|-----------|----------|
| No behavior data for an agent (new agent) | Dashboard shows "--" for all metrics | "No behavior data yet. Scores populate after first session." |
| Source telemetry unavailable (GitHub API down) | Behavior score not updated for session | Observer retries; dashboard shows "Last updated: 2 hours ago" |
| Policy threshold too aggressive (all agents failing) | Multiple veto feed cards simultaneously | Tomasz adjusts threshold or switches policy to "testing" mode |
| Hotfix mode conflicts with TDD policy | Agent vetoed during time-critical fix | Human override button on feed card; override logged as exception |
| Behavior score oscillates rapidly | Trend shows erratic UP/DOWN | Observer creates observation: "Inconsistent behavior pattern" |
| Observer rate limit hit (5/agent/7 days) | No new learning proposed | Observer logs observation; existing learnings continue injection |
| Proposed learning collides with existing policy | Learning blocked by collision detection (0.40 threshold) | Observer notified; Tomasz reviews policy-learning conflict in Learning Library |

## Integration Points

| From Step | To Step | Data Passed | Validation |
|-----------|---------|-------------|------------|
| 2 -> 3 | Metric type definitions | Observer Agent knows what to measure |
| 3 -> 4 | Behavior records with scores | Dashboard queries behavior table with identity join |
| 4 -> 5 | Identified threshold violations | Policy rule conditions reference metric_type and threshold |
| 5 -> 6 | Active policy with rules | Authorizer queries active policies matching agent role |
| 6 -> 7 | Vetoed intent + behavior scores | Observer clusters behavior records, classifies behavioral_drift, proposes learning via existing pipeline |
| 7 -> 3 | Learning injected into agent via JIT prompt injection | Next session behavior should show score improvement; learning_evidence edge traces to triggering behavior records |
