Feature: Graph Policies & Intents
  As a workspace admin managing agent governance
  I want to see policies and intents in the graph view and governance feed
  So I can understand governance topology, monitor authorization flow, and review vetoed actions

  Background:
    Given a workspace "Brain" with active projects
    And identity "ci-agent" in the workspace
    And identity "dev-agent" in the workspace

  # --- J1: Governance Visibility (Policy Nodes in Graph) ---

  Scenario: Policy node appears in workspace graph
    Given an active policy "Agent Budget Guard" version 3 in workspace "Brain"
    And identity "ci-agent" is governed by "Agent Budget Guard"
    When Rena Okafor opens the workspace graph view
    Then a node appears with label "Agent Budget Guard" and kind "policy"
    And the node uses the policy color theme

  Scenario: Policy-to-identity governing edge visible
    Given an active policy "Agent Budget Guard" in workspace "Brain"
    And identity "ci-agent" is governed by "Agent Budget Guard"
    And identity "dev-agent" is governed by "Agent Budget Guard"
    When Rena Okafor opens the workspace graph view
    Then an edge "governing" connects "ci-agent" to "Agent Budget Guard"
    And an edge "governing" connects "dev-agent" to "Agent Budget Guard"

  Scenario: Policy-to-workspace protects edge visible
    Given an active policy "Agent Budget Guard" that protects workspace "Brain"
    When Rena Okafor opens the workspace graph view
    Then an edge "protects" connects "Agent Budget Guard" to "Brain"

  Scenario: Deprecated policy not shown in graph by default
    Given a deprecated policy "Old Budget Rule" in workspace "Brain"
    When Rena Okafor opens the workspace graph view
    Then no node appears for "Old Budget Rule"

  Scenario: Policy supersession chain visible
    Given an active policy "Agent Budget Guard v3" that supersedes "Agent Budget Guard v2"
    And "Agent Budget Guard v2" has status "superseded"
    When Rena Okafor clicks on "Agent Budget Guard v3" in the graph
    Then the entity detail shows a "supersedes" relationship to "Agent Budget Guard v2"

  # --- J2: Intent Monitoring (Intent Nodes in Graph) ---

  Scenario: Active intent appears in workspace graph
    Given an intent "Deploy v2.1 to staging" with status "executing" in workspace "Brain"
    And the intent was triggered by task "Deploy to staging"
    When Carlos Medina opens the workspace graph view
    Then a node appears with label "Deploy v2.1 to staging" and kind "intent"
    And an edge "triggered_by" connects the intent to "Deploy to staging"

  Scenario: Intent-to-agent-session gates edge visible
    Given an intent "Deploy v2.1 to staging" with status "executing"
    And the intent gates agent session "deploy-agent-0312"
    When Carlos Medina opens the workspace graph view
    Then an edge "gates" connects "Deploy v2.1 to staging" to "deploy-agent-0312"

  Scenario: Completed intent not shown in graph
    Given an intent "Run test suite" with status "completed" in workspace "Brain"
    When Carlos Medina opens the workspace graph view
    Then no node appears for "Run test suite"

  Scenario: Pending veto intent visible in graph with alert styling
    Given an intent "Scale database replicas" with status "pending_veto" in workspace "Brain"
    When Carlos Medina opens the workspace graph view
    Then a node appears for "Scale database replicas" with kind "intent"
    And the node indicates pending human review status

  Scenario: Intent entity detail shows authorization metadata
    Given an intent "Deploy v2.1 to staging" with status "executing" and priority 45
    When Carlos Medina clicks on the intent node in the graph
    Then the entity detail shows goal "Deploy v2.1 to staging"
    And the detail shows status "executing"
    And the detail shows priority 45

  # --- J3: Intent Feed Surfacing (Vetoed Intents in Feed) ---

  Scenario: Recently vetoed intent appears in awareness tier
    Given an intent "Delete staging environment" was vetoed 6 hours ago
    And the intent evaluation reason was "risk exceeded budget threshold"
    When Amara Diallo opens the governance feed for workspace "Brain"
    Then the awareness tier contains an item with entity kind "intent"
    And the item entity name is "Delete staging environment"
    And the item reason includes "Vetoed"
    And the item status is "vetoed"
    And the item offers a "Discuss" action

  Scenario: Vetoed intent outside 24-hour window not shown
    Given an intent "Drop production table" was vetoed 30 hours ago
    When Amara Diallo opens the governance feed
    Then the awareness tier does not contain an item for "Drop production table"

  Scenario: Multiple vetoed intents sorted by recency
    Given intent "Delete staging env" was vetoed 2 hours ago
    And intent "Purge cache" was vetoed 8 hours ago
    When Amara opens the governance feed
    Then "Delete staging env" appears before "Purge cache" in the awareness tier

  Scenario: Pending veto intent remains in blocking tier (existing behavior)
    Given an intent "Scale database replicas" with status "pending_veto"
    When Carlos opens the governance feed
    Then the blocking tier contains an item for "Scale database replicas"
    And the item offers "Approve", "Veto", and "Discuss" actions

  # --- Contract & Theme Integration ---

  Scenario: EntityKind union includes policy
    Given the contracts.ts EntityKind type definition
    Then "policy" is a valid EntityKind value

  Scenario: Graph theme handles policy color
    Given the graph-theme.ts entityColor function
    When called with kind "policy"
    Then it returns a valid CSS custom property

  Scenario: KIND_LABELS includes policy and intent
    Given the EntityBadge KIND_LABELS mapping
    Then "policy" maps to label "Policy"
    And "intent" maps to label "Intent"
