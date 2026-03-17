Feature: Self-Hosted Deployment Setup
  As a platform operator deploying Brain for my team,
  I want to configure a locked-down instance via environment variables,
  so I can automate deployment without manual signup steps.

  Background:
    Given a fresh Brain installation with SurrealDB running

  # --- Step 1: Configuration Validation ---

  Scenario: Valid self-hosted configuration accepted
    Given the environment has SELF_HOSTED=true
    And ADMIN_EMAIL is set to "marcus@nwave.io"
    And ADMIN_PASSWORD is set to a 24-character password
    When the server configuration is loaded
    Then the configuration parses without error
    And self-hosted mode is enabled

  Scenario: Missing admin credentials rejected
    Given the environment has SELF_HOSTED=true
    And ADMIN_EMAIL is not set
    When the migration runs
    Then it fails with error "ADMIN_EMAIL is required when SELF_HOSTED=true"

  Scenario: Missing admin password rejected
    Given the environment has SELF_HOSTED=true
    And ADMIN_EMAIL is set to "marcus@nwave.io"
    And ADMIN_PASSWORD is not set
    When the migration runs
    Then it fails with error "ADMIN_PASSWORD is required when SELF_HOSTED=true"

  # --- Step 2: Admin Seeding ---

  Scenario: Admin user seeded during migration
    Given the environment has SELF_HOSTED=true
    And ADMIN_EMAIL is "marcus@nwave.io"
    And ADMIN_PASSWORD is "correct-horse-battery-staple"
    When the migration runs
    Then a user record exists with email "marcus@nwave.io"
    And the stored password is hashed with argon2id
    And the migration output includes "Admin user seeded: marcus@nwave.io"

  Scenario: Re-running migration skips existing admin
    Given the admin user "marcus@nwave.io" was already seeded
    When the migration runs again
    Then no duplicate user is created
    And the migration output includes "Admin user already exists"

  # --- Step 3: Registration Disabled ---

  Scenario: Signup returns 403 in self-hosted mode
    Given the server is running with SELF_HOSTED=true
    When a visitor attempts to register with email "intruder@example.com"
    Then the signup endpoint returns HTTP 403
    And the response body includes "Registration is disabled"

  Scenario: Signup works normally when not self-hosted
    Given the server is running without SELF_HOSTED set
    When a visitor registers with email "newuser@example.com"
    Then registration succeeds normally

  # --- Step 4: Admin Login ---

  Scenario: Admin logs in with seeded credentials
    Given the server is running with SELF_HOSTED=true
    And the admin user "marcus@nwave.io" was seeded during migration
    When the admin logs in with email "marcus@nwave.io" and the correct password
    Then authentication succeeds
    And the admin reaches the dashboard

  # --- Worktree Manager Feature Flag ---

  Scenario: Repo path UI hidden when worktree manager disabled
    Given the server is running with WORKTREE_MANAGER_ENABLED=false
    When the admin opens workspace settings
    Then the repository path configuration is not visible

  Scenario: Repo path UI shown when worktree manager enabled
    Given the server is running with WORKTREE_MANAGER_ENABLED=true
    When the admin opens workspace settings
    Then the repository path configuration is visible
    And the admin can set the repo path for the workspace
