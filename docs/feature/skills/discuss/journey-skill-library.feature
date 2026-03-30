Feature: Skill Library Management
  As a workspace admin managing domain expertise,
  I want to create, browse, activate, and deprecate skills,
  so agents can be equipped with curated, governed expertise.

  # Platform: web
  # Key heuristics: visibility of system status, error prevention, recognition over recall
  # Accessibility: WCAG 2.2 AA

  Background:
    Given Marcus is authenticated as a workspace admin for "Acme Corp"

  # --- Browse Library ---

  Scenario: View skill library with active skills
    Given the workspace has the following skills:
      | name             | version | status     | agents_count |
      | security-audit   | 1.2     | active     | 3            |
      | code-review      | 2.0     | active     | 5            |
      | legacy-migration | 0.9     | draft      | 0            |
    When Marcus navigates to the Skill Library
    Then he sees 3 skill cards
    And each card shows name, version, status badge, description, source type, and agent count

  Scenario: Filter skills by status
    Given the workspace has 2 active skills, 1 draft, and 1 deprecated
    When Marcus selects the "Active" filter
    Then only the 2 active skills are shown

  Scenario: Empty skill library
    Given the workspace has no skills
    When Marcus navigates to the Skill Library
    Then an empty state reads "No skills yet. Skills give your agents domain expertise."
    And a "Create Skill" button is prominently displayed

  # --- Create Skill ---

  Scenario: Create skill from GitHub source
    Given Marcus clicks "Create Skill"
    When he fills in:
      | field       | value                                              |
      | name        | security-audit                                     |
      | description | Comprehensive security audits of code changes      |
      | version     | 1.0                                                |
      | source_type | github                                             |
      | source      | acme-corp/agent-skills                             |
      | ref         | v1.0                                               |
      | subpath     | skills/security-audit                              |
    And checks required tools "read_file, search_codebase, check_dependencies"
    And clicks "Create Skill"
    Then the skill is created with status "draft"
    And 3 "skill_requires" edges are created linking to the selected tools
    And Marcus is redirected to the Skill Library showing the new skill

  Scenario: Create skill from git source
    Given Marcus clicks "Create Skill"
    When he selects source type "Git"
    And enters URL "https://internal.example.com/skills.git"
    And enters ref "main"
    And enters subpath "skills/database-migration"
    And fills in name "database-migration", description, version "1.0"
    And clicks "Create Skill"
    Then the skill is created with source type "git"

  Scenario: Duplicate skill name rejected
    Given the workspace has a skill named "security-audit"
    When Marcus tries to create another skill named "security-audit"
    Then an inline error reads "A skill named 'security-audit' already exists"
    And the "Create Skill" button remains disabled

  Scenario: Create skill with no required tools
    Given Marcus fills in all required fields for a new skill
    And does not check any required tools
    When he clicks "Create Skill"
    Then the skill is created with zero "skill_requires" edges
    And a note appears: "This skill has no required tools. Agents using it will rely on their direct tool grants."

  # --- Skill Detail ---

  Scenario: View skill detail page
    Given the skill "security-audit" v1.2 is active
    And it is assigned to agents "security-auditor, compliance-checker, pen-tester"
    And it is governed by policy "Security Tool Access"
    When Marcus clicks on "security-audit" in the library
    Then he sees the skill detail page with:
      | section          | content                                           |
      | Description      | Comprehensive security audits of code changes     |
      | Source           | GitHub: acme-corp/agent-skills @ v1.2             |
      | Required Tools   | read_file, search_codebase, check_dependencies    |
      | Agents Using     | security-auditor, compliance-checker, pen-tester  |
      | Governed By      | Security Tool Access (active)                     |

  # --- Lifecycle Management ---

  Scenario: Activate a draft skill
    Given the skill "legacy-migration" has status "draft"
    When Marcus clicks "Activate" on the skill detail page
    Then the status changes to "active"
    And the skill appears in the agent creation wizard Step 2

  Scenario: Deprecate skill with warning about affected agents
    Given the skill "security-audit" is active and assigned to 3 agents
    When Marcus clicks "Deprecate"
    Then a confirmation dialog shows:
      """
      This skill is assigned to 3 agents:
      - security-auditor
      - compliance-checker
      - pen-tester

      Deprecating it will exclude it from their future sessions.
      """
    When Marcus confirms
    Then the status changes to "deprecated"
    And the skill no longer appears in agent creation wizard Step 2
    And existing "possesses" edges are preserved (not deleted)

  Scenario: Deprecate skill with no agents
    Given the skill "legacy-migration" is active and assigned to 0 agents
    When Marcus clicks "Deprecate"
    Then the status changes to "deprecated" without a confirmation dialog

  # --- Edit Skill ---

  Scenario: Edit skill metadata
    Given Marcus is on the detail page for skill "security-audit" v1.2
    When he clicks "Edit"
    And updates the description to "Enhanced security audits with SAST integration"
    And updates the version to "1.3"
    And clicks "Save"
    Then the skill is updated with the new description and version
    And the updated_at timestamp is set

  Scenario: Update required tools
    Given Marcus is editing skill "security-audit"
    When he checks "run_sast" in the required tools list
    And clicks "Save"
    Then a new "skill_requires" edge is created for "run_sast"
    And agents possessing this skill will see "run_sast" in their skill-derived tools

  # --- Policy Governance ---

  Scenario: Skill governed by policy shows governance info
    Given the policy "Security Tool Access" governs skill "security-audit"
    When Marcus views the skill detail page
    Then a "Governed By" section shows "Security Tool Access (active)"
    And clicking the policy name navigates to the policy detail page
