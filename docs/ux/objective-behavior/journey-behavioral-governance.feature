Feature: Behavioral Quality Governance
  As a platform engineer managing autonomous coding agents,
  I want to track behavioral quality metrics and enforce minimum standards through policy,
  so that agent craftsmanship is governed systematically and agents improve over time.

  Background:
    Given Tomasz Kowalski is a platform engineer in workspace "BrainOS"
    And agent identity "Coder-Alpha" exists with role "code_agent"
    And agent identity "Coder-Beta" exists with role "code_agent"
    And agent identity "Coder-Gamma" exists with role "code_agent"

  # --- Step 2: Define Behavior Metrics ---

  Scenario: Define behavior metric types via chat
    Given Tomasz is in a conversation in workspace "BrainOS"
    When Tomasz sends "Track TDD adherence for all coding agents"
    Then the system registers behavior metric type "TDD_Adherence" with:
      | field        | value                                    |
      | description  | Ratio of test-covered code to total code |
      | applies_to   | code_agent                               |
      | score_range  | 0.0 - 1.0                                |
    And the Observer Agent begins collecting this metric for all code_agent identities

  Scenario: Define multiple behavior metrics in one conversation
    Given Tomasz is in a conversation in workspace "BrainOS"
    When Tomasz sends "Also track security-first practices and code review responsiveness"
    Then the system registers metric types "Security_First" and "Review_Responsiveness"
    And each metric type has description, applicable roles, and score range
    And Tomasz sees confirmation listing all 3 active metric types

  # --- Step 3: Collect Behavioral Telemetry ---

  Scenario: Observer Agent writes behavior node after agent session
    Given metric type "TDD_Adherence" is registered
    And Coder-Alpha completes a session that changed 12 files with 2 test files
    When the Observer Agent evaluates the session telemetry
    Then a behavior record is created with:
      | field             | value                           |
      | metric_type       | TDD_Adherence                   |
      | score             | 0.42                            |
    And the behavior record has source_telemetry containing:
      | field              | value              |
      | files_changed      | 12                 |
      | test_files_changed | 2                  |
      | coverage_delta     | -8%                |
    And an exhibits edge is created: identity:coder-alpha ->exhibits-> behavior:new-record
    And the behavior record has a workspace reference

  Scenario: Observer Agent writes Security_First behavior after session with CVE advisories
    Given metric type "Security_First" is registered
    And Coder-Beta completes a session with 2 CVE advisories in context
    And Coder-Beta addressed 1 of the 2 advisories
    When the Observer Agent evaluates the session telemetry
    Then a behavior record is created with:
      | field       | value           |
      | metric_type | Security_First  |
      | score       | 0.65            |
    And source_telemetry includes cve_advisories_in_context: 2 and cve_advisories_addressed: 1

  Scenario: No behavior data for new agent
    Given agent identity "Coder-New" was just created
    And "Coder-New" has completed no sessions
    When Tomasz views the behavior dashboard
    Then "Coder-New" appears with "--" for all metric scores
    And a note reads "No behavior data yet. Scores populate after first session."

  # --- Step 4: Review Behavior Scores ---

  Scenario: View behavior dashboard with scores and trends
    Given Coder-Alpha has 5 TDD_Adherence records with scores [0.72, 0.65, 0.58, 0.50, 0.42]
    And Coder-Beta has 5 Security_First records with scores [0.70, 0.68, 0.67, 0.66, 0.65]
    And Coder-Gamma has 5 TDD_Adherence records with scores [0.88, 0.90, 0.92, 0.94, 0.95]
    When Tomasz opens the behavior dashboard
    Then he sees a table with columns: Agent, TDD, Security, Review, Trend
    And Coder-Alpha shows TDD_Adherence: 0.42 with trend DOWN
    And Coder-Beta shows Security_First: 0.65 with trend DOWN
    And Coder-Gamma shows TDD_Adherence: 0.95 with trend UP
    And agents below threshold are highlighted with warning indicator

  Scenario: View behavior detail for specific agent
    Given Coder-Alpha has TDD_Adherence score 0.42
    When Tomasz clicks on Coder-Alpha's TDD_Adherence cell
    Then he sees a detail view with:
      | data                  | value                     |
      | current_score         | 0.42                      |
      | 7_day_trend           | -0.30 (from 0.72)         |
      | sessions_measured     | 5                         |
      | last_session          | 12 files, 2 test files    |
      | threshold             | 0.70 (policy-defined)     |
    And a sparkline chart showing score history

  # --- Step 5: Create Policy Rules ---

  Scenario: Create behavior-based policy in testing mode
    Given Tomasz is in a conversation in workspace "BrainOS"
    When Tomasz sends "If any coding agent's Security_First score drops below 0.8, revoke production deployment scope"
    Then a policy node is created with:
      | field              | value                    |
      | title              | Security Behavior Gate   |
      | status             | testing                  |
      | human_veto_required | true                    |
    And the policy has selector: agent_role "code_agent", resource "production_deploy"
    And the policy has rule: condition "Security_First < 0.8", effect "deny", priority 100
    And Tomasz sees: "Policy created in testing mode. Will observe for 2 weeks before enforcement."

  Scenario: Activate policy after testing period
    Given policy "Security Behavior Gate" has status "testing"
    And the policy has been in testing mode for 14 days
    And during testing, 3 intents would have been vetoed
    When Tomasz reviews the testing results and activates the policy
    Then policy status transitions to "active"
    And Tomasz sees confirmation with testing summary: "3 intents would have been vetoed during testing period"

  # --- Step 6: Policy Enforcement ---

  Scenario: Intent vetoed due to below-threshold behavior score
    Given policy "Security Behavior Gate" has status "active"
    And Coder-Beta's latest Security_First score is 0.65
    When Coder-Beta submits intent with goal "Deploy auth-service v2.3 to production"
    And the intent action_spec has provider "github" and action "deploy"
    Then the Authorizer evaluates the intent against active policies
    And the Authorizer queries Coder-Beta's Security_First behavior score
    And the score 0.65 is below threshold 0.80
    And the intent evaluation is set to decision "REJECT" with reason "Security_First score 0.65 below policy threshold 0.80"
    And the intent status transitions to "vetoed"
    And a feed card appears with:
      | field   | value                                          |
      | title   | Intent Vetoed by Behavior Policy               |
      | agent   | Coder-Beta                                     |
      | policy  | Security Behavior Gate                         |
      | reason  | Security_First score 0.65 < threshold 0.80     |
    And the feed card includes actions: "Override (human)", "Review Agent", "Adjust Rule"

  Scenario: Human overrides behavior policy veto for hotfix
    Given Coder-Beta's intent "Deploy critical auth hotfix" was vetoed by Security Behavior Gate
    And Tomasz determines the hotfix is time-critical
    When Tomasz clicks "Override (human)" on the feed card
    Then the intent status transitions from "vetoed" to "authorized"
    And an observation is created with:
      | field    | value                                                    |
      | severity | info                                                     |
      | text     | Human override: behavior policy veto bypassed for hotfix |
    And the override is logged in the intent evaluation with Tomasz's identity

  Scenario: Intent proceeds when behavior score is above threshold
    Given policy "Security Behavior Gate" has status "active"
    And Coder-Gamma's latest Security_First score is 0.93
    When Coder-Gamma submits intent with goal "Deploy payment-service v1.5 to production"
    Then the Authorizer evaluates the intent against active policies
    And Coder-Gamma's Security_First score 0.93 passes threshold 0.80
    And the intent proceeds to normal authorization flow

  # --- Step 7: Observer Proposes Behavior Learning (via existing learning pipeline, PR #145) ---

  Scenario: Observer proposes learning for underperforming agent via behavior extension
    Given Coder-Beta's Security_First score has been below 0.80 for 3 consecutive sessions
    And the source_telemetry shows 2 CVE advisories ignored across sessions
    When the Observer Agent clusters behavior records and classifies root cause as "behavioral_drift"
    Then the Observer proposes a learning via POST /api/workspaces/:workspaceId/learnings with:
      | field           | value                                                                                          |
      | text            | Always address CVE advisories present in your context window before proceeding with feature work. |
      | learning_type   | instruction                                                                                     |
      | status          | pending_approval                                                                                |
      | source          | agent                                                                                           |
      | suggested_by    | observer                                                                                        |
      | target_agents   | ["coder-beta"]                                                                                  |
      | priority        | high                                                                                            |
    And the learning passes three-layer collision detection (no duplicate, no policy contradiction, no decision conflict)
    And the learning passes dual-gate safety (rate limit and dismissed similarity check)
    And a learning_evidence edge links the learning to the triggering behavior records
    And a feed card notifies Tomasz: "Observer proposed learning for Coder-Beta: Security Advisory Compliance"

  Scenario: Tomasz approves proposed learning in Learning Library
    Given the Observer proposed a learning for Coder-Beta with status "pending_approval"
    When Tomasz approves the learning via POST /api/workspaces/:workspaceId/learnings/:id/actions with action "approve"
    Then the learning status transitions to "active"
    And the learning is available for JIT prompt injection

  Scenario: Learning loaded into agent session via JIT prompt injection
    Given an active learning exists for Coder-Beta with text "Always address CVE advisories..."
    And the learning has learning_type "instruction" and priority "high"
    When Coder-Beta starts a new agent session
    Then the learning is loaded via JIT prompt injection within the 500-token budget
    And instructions are loaded by priority (high before medium/low)
    And the session context includes the learning for traceability

  Scenario: Behavior improves after learning injection
    Given Coder-Beta received learning "Security Advisory Compliance" 5 sessions ago
    And Coder-Beta's Security_First scores since learning: [0.70, 0.75, 0.82, 0.85, 0.88]
    When the Observer evaluates behavior trends
    Then the Observer creates an observation noting the improvement
    And a feed card appears: "Coder-Beta's Security_First improved from 0.65 to 0.88 after learning injection"

  Scenario: Observer rate-limited from proposing too many learnings
    Given the Observer has proposed 5 learnings for Coder-Beta in the last 7 days
    When the Observer detects another behavioral_drift pattern for Coder-Beta
    Then no new learning is proposed (dual-gate rate limit: 5 per agent per 7 days)
    And the Observer creates an observation noting the pattern for human review

  Scenario: Proposed learning blocked by policy collision
    Given an active policy exists with rule "All agents must use structured logging"
    When the Observer proposes a learning that contradicts the policy (collision score > 0.40)
    Then the learning is blocked by three-layer collision detection
    And the Observer is notified of the policy-learning conflict
    And Tomasz can review the conflict in the Learning Library

  # --- Error Paths ---

  Scenario: Source telemetry unavailable for behavior scoring
    Given metric type "TDD_Adherence" is registered
    And Coder-Alpha completes a session but the source telemetry service is unavailable
    When the Observer Agent attempts to evaluate the session
    Then no behavior record is written for this session
    And the dashboard shows "Last updated: 2 hours ago" for Coder-Alpha
    And the Observer Agent retries on next evaluation cycle

  Scenario: All agents fail a behavior threshold after policy change
    Given Tomasz changes the TDD_Adherence threshold from 0.70 to 0.95
    And 5 of 6 coding agents have TDD_Adherence below 0.95
    When the next round of intents is submitted
    Then multiple veto feed cards appear
    And the system creates an observation with severity "warning":
      "Policy 'TDD Quality Gate' is vetoing 83% of agents. Consider threshold adjustment."

  @property
  Scenario: Behavior scores reflect trends not snapshots
    Given behavior scores are recorded per session over time
    Then policy evaluation uses the latest score from the last 5 sessions (rolling average or latest)
    And the dashboard displays trend direction based on at least 3 data points
    And single-session anomalies do not trigger policy enforcement without trend confirmation

  @property
  Scenario: Behavior data is workspace-scoped
    Given behavior records exist in workspace "BrainOS"
    Then behavior queries for workspace "BrainOS" return only records scoped to that workspace
    And behavior scores from other workspaces are never visible or used in policy evaluation
