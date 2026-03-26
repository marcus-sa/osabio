Feature: Governance Feed Evidence Display and Workspace Bootstrapping
  As a workspace administrator,
  I want to review evidence chains in the governance feed and onboard new workspaces gracefully,
  so that I can make informed veto decisions and new workspaces adopt evidence requirements gradually.

  Background:
    Given workspace "Acme Supply Chain" has evidence enforcement set to "hard"
    And Ravi Patel is a workspace administrator

  # --- US-08: Feed Evidence Display ---

  Scenario: Governance feed shows verified evidence chain for pending intent
    Given an intent in "pending_veto" status with 3 verified evidence references
    When Ravi Patel views the intent in the governance feed
    Then each evidence reference shows entity type, title, and verification status
    And the evidence summary shows "3/3 verified"

  Scenario: Feed highlights failed evidence references with reason
    Given an intent with 2 verified and 1 failed evidence reference
    When Ravi Patel views the intent in the governance feed
    Then verified references show a success indicator
    And the failed reference shows a failure indicator with reason
    And the evidence summary shows "2/3 verified"

  Scenario: Feed shows zero-evidence warning for intents without evidence
    Given an intent with no evidence references under soft enforcement
    When Ravi Patel views the intent in the governance feed
    Then the feed displays a zero-evidence warning
    And the warning indicates the risk score was elevated

  Scenario: Feed allows navigation to referenced entities
    Given an intent with evidence referencing a confirmed decision
    When Ravi Patel views the intent in the governance feed
    Then the decision reference is displayed with its title
    And the reference links to the decision detail

  # --- US-09: Workspace Bootstrapping ---

  Scenario: New workspace starts in bootstrap enforcement mode
    Given a newly created workspace "Fresh Supply Chain" with no confirmed decisions
    When the first agent creates an intent without evidence references
    Then the intent proceeds to evaluation without evidence requirements
    And the intent is flagged with a bootstrap exemption

  Scenario: Workspace transitions from bootstrap to soft when first decision is confirmed
    Given workspace "Fresh Supply Chain" in "bootstrap" enforcement mode
    When Ravi Patel confirms the first decision in the workspace
    Then the workspace enforcement transitions to "soft"

  Scenario: Manual enforcement override allows admin to set enforcement mode
    Given workspace "Acme Supply Chain" in "soft" enforcement mode
    When Ravi Patel manually sets enforcement to "hard"
    Then the workspace enforcement is "hard"
    And the manual override is recorded for audit
