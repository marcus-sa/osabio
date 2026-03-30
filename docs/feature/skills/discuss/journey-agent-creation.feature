Feature: Create Agent with Skills
  As a workspace admin creating a specialized agent,
  I want to assign domain expertise and review tool grants during creation,
  so the agent is fully equipped from its first session.

  # Platform: web
  # Key heuristics: visibility of system status, user control and freedom, recognition over recall
  # Accessibility: WCAG 2.2 AA

  Background:
    Given Marcus is authenticated as a workspace admin
    And the workspace "Acme Corp" has the following active skills:
      | name             | version | source_type | description                                      |
      | security-audit   | 1.2     | github      | Comprehensive security audits of code changes    |
      | code-review      | 2.0     | github      | Code quality and maintainability review          |
      | database-migration | 1.0   | git         | Safe database schema migrations with rollback    |
      | api-design       | 1.1     | github      | REST and GraphQL API design to OpenAPI standards |
    And the skill "security-audit" requires tools "read_file, search_codebase, check_dependencies"
    And the skill "code-review" requires tools "search_codebase, run_linter"

  # --- Step 1: Agent Config ---

  Scenario: Configure sandbox agent identity
    Given Marcus navigates to Create Agent
    When he selects "Sandbox" runtime
    And enters name "security-auditor"
    And enters description "Performs comprehensive security audits of code changes before merge"
    And selects model "claude-sonnet-4-20250514"
    And sets "Create observation" authority to "Autonomous"
    Then the "Next" button is enabled
    And sandbox-specific config fields (coding agents, environment variables) are visible

  Scenario: Configure external agent identity
    Given Marcus navigates to Create Agent
    When he selects "External" runtime
    And enters name "ci-scanner"
    Then sandbox-specific config fields are hidden
    And the "Next" button is enabled when name and model are filled

  Scenario: Agent name uniqueness validation
    Given the workspace has an agent named "security-auditor"
    When Marcus enters "security-auditor" in the name field and moves focus away
    Then an inline error appears: "An agent named 'security-auditor' already exists"
    And the "Next" button remains disabled

  # --- Step 2: Skills Setup ---

  Scenario: Browse and assign skills
    Given Marcus completed Step 1 for sandbox agent "security-auditor"
    And he is on Step 2
    Then 4 active skills are displayed as a checklist
    And each skill card shows name, version, description, and source type icon
    When he checks "security-audit" and "code-review"
    Then a count badge shows "2 skills selected"

  Scenario: Skip skills assignment
    Given Marcus is on Step 2 of Create Agent
    When he clicks "Skip"
    Then he advances to Step 3
    And zero skills are selected

  Scenario: Navigate back from skills preserves step 1
    Given Marcus completed Step 1 with name "security-auditor" and Sandbox runtime
    And he is on Step 2
    When he clicks "Back"
    Then Step 1 form fields retain their values
    And the runtime remains "Sandbox"

  Scenario: Empty workspace skills
    Given the workspace "Acme Corp" has no active skills
    When Marcus reaches Step 2
    Then an empty state message reads "No skills in this workspace yet"
    And a link to the Skill Library is shown
    And "Skip" is the primary action button

  Scenario: External agent sees skills caveat
    Given Marcus selected "External" runtime in Step 1
    When he reaches Step 2
    Then a muted banner reads "Skills and skill-derived tools are only used by sandbox agents"
    And "Skip" is the primary action

  # --- Step 3: Tools Review ---

  Scenario: Skill-derived tools displayed with provenance
    Given Marcus selected "security-audit" and "code-review" in Step 2
    When he arrives at Step 3
    Then the "Skill-derived tools" section shows:
      | tool              | via                          |
      | read_file         | security-audit               |
      | search_codebase   | security-audit, code-review  |
      | check_dependencies| security-audit               |
      | run_linter        | code-review                  |
    And these tools are displayed as read-only (no checkboxes)

  Scenario: Select additional tools manually
    Given Marcus is on Step 3 with 4 skill-derived tools
    And the workspace has additional tools "create_branch, merge_pr, post_comment, deploy_staging"
    When he checks "create_branch" and "post_comment"
    Then the summary shows "6 total tools (4 from skills + 2 additional)"

  Scenario: Skip additional tools
    Given Marcus is on Step 3
    When he clicks "Skip"
    Then agent creation proceeds with only skill-derived tools (no additional)

  Scenario: Navigate back from tools preserves skill selections
    Given Marcus selected 2 skills in Step 2 and is on Step 3
    When he clicks "Back"
    Then Step 2 shows "security-audit" and "code-review" still checked

  # --- Agent Creation ---

  Scenario: Successful agent creation with skills and tools
    Given Marcus has configured:
      | field       | value                                    |
      | name        | security-auditor                         |
      | runtime     | Sandbox                                  |
      | skills      | security-audit, code-review              |
      | add. tools  | create_branch, post_comment              |
    When he clicks "Create Agent"
    Then the agent is created in an atomic transaction
    And 2 "possesses" edges link the agent identity to the selected skills
    And 2 "can_use" edges link the agent identity to the additional tools
    And a success confirmation shows:
      | field   | value                              |
      | Runtime | Sandbox                            |
      | Skills  | 2 (security-audit, code-review)    |
      | Tools   | 6 (4 skill-derived + 2 additional) |

  Scenario: Agent creation with no skills and no additional tools
    Given Marcus skipped Step 2 and Step 3
    When he clicks "Create Agent"
    Then the agent is created with zero "possesses" edges and zero "can_use" edges
    And the success confirmation shows Skills: 0, Tools: 0

  Scenario: Skill deprecated during wizard flow
    Given Marcus selected "security-audit" in Step 2
    And the admin deprecated "security-audit" while Marcus was on Step 3
    When Marcus clicks "Create Agent"
    Then an error message reads: "Skill 'security-audit' was deprecated. Go back to update your selection."
    And the agent is not created
    And Marcus can click "Back" to return to Step 2
