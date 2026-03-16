Feature: Spend Monitoring Dashboard (US-LP-006)
  As a workspace admin,
  I need real-time LLM spending visibility with project breakdown,
  so that I can monitor costs and catch anomalies before they become expensive.

  Background:
    Given Brain's proxy has been capturing traces with cost data
    And Marcus is the admin of workspace "brain-v1"

  # --- Happy Path ---

  Scenario: Dashboard shows workspace spend with budget progress
    Given the daily budget is $50.00 and today's spend is $23.47
    When Marcus views the spend overview
    Then he sees 47% of daily budget consumed
    And the total spend $23.47 and limit $50.00 are displayed
    And the dashboard loads within 2 seconds

  Scenario: Dashboard shows per-project spend breakdown
    Given workspace "brain-v1" has traces attributed to 3 projects
    When Marcus views the project breakdown
    Then each project shows today's spend, month-to-date spend, and call count
    And projects are sorted by today's spend descending
    And project spend plus unattributed equals the workspace total

  Scenario: Dashboard shows per-session cost breakdown
    Given multiple agent sessions have made LLM calls today
    When Marcus views the session cost breakdown
    Then each session shows total cost, primary model used, and duration
    And sessions are sorted by cost descending

  # --- Anomaly Detection ---

  Scenario: Anomaly alert appears for unusual call rate
    Given session "priya/auth-refactor" has 342 calls in 2.1 hours
    And the average session rate is 100 calls per 2 hours
    When the anomaly detector evaluates sessions
    Then an alert describes "3x average call rate, possible debugging loop"
    And the alert offers investigate and dismiss actions

  # --- Budget Alerts ---

  Scenario: Budget threshold alert fires at 80%
    Given workspace daily budget is $50.00 with alert threshold at 80%
    When daily spend reaches $40.00
    Then a budget alert indicates 80% of daily budget consumed
    And the alert shows current spend, limit, and projected exhaustion time
