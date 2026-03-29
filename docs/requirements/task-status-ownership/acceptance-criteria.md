# Acceptance Criteria: Task Status Ownership

## US-1: Remove server-side in_progress on assignment

```gherkin
Feature: Agent session creation does not change task status

  Scenario: Creating agent session with a ready task
    Given a task with status "ready"
    When an agent session is created for that task
    Then the task status remains "ready"
    And the task source_session is linked to the new session

  Scenario: Creating agent session with a todo task
    Given a task with status "todo"
    When an agent session is created for that task
    Then the task status remains "todo"
    And the task source_session is linked to the new session
```

## US-2: Remove server-side done on session accept

```gherkin
Feature: Session accept does not change task status

  Scenario: Accepting a session with task in in_progress
    Given an agent session linked to a task with status "in_progress"
    When the session is accepted
    Then the session status becomes "accepted"
    And the task status remains "in_progress"

  Scenario: Accepting a session with task already done
    Given an agent session linked to a task with status "done"
    When the session is accepted
    Then the session status becomes "accepted"
    And the task status remains "done"
```

## US-3: Add osabio commit-check CLI command

```gherkin
Feature: osabio commit-check parses task refs and sets done

  Scenario: Commit message with single task ref
    Given a commit with message "Implement login flow\n\ntask:abc123"
    When osabio commit-check runs
    Then task "abc123" status is set to "done"

  Scenario: Commit message with multiple task refs
    Given a commit with message "Batch update\n\ntasks: abc123, def456"
    When osabio commit-check runs
    Then task "abc123" status is set to "done"
    And task "def456" status is set to "done"

  Scenario: Commit message with no task refs
    Given a commit with message "Fix typo in README"
    When osabio commit-check runs
    Then no task status changes occur

  Scenario: Task already done (idempotent)
    Given a commit referencing task "abc123"
    And task "abc123" already has status "done"
    When osabio commit-check runs
    Then task "abc123" status remains "done"
    And no error is raised

  Scenario: Commit check does not block the git workflow
    When osabio commit-check runs as a post-commit hook
    Then it completes without blocking subsequent git operations
    And API failures are logged but do not cause a non-zero exit code
```

## US-4: Wire commit-check as post-commit hook

```gherkin
Feature: commit-check runs as post-commit hook

  Scenario: Git commit triggers commit-check
    Given a Osabio-managed repository with post-commit hook installed
    When a developer makes a git commit with message containing "task:abc123"
    Then osabio commit-check runs automatically after the commit
    And task "abc123" status is set to "done"
```

## US-5: GitHub processor sets done on push

```gherkin
Feature: GitHub commit processor sets done on push to non-main branch

  Scenario: Push to feature branch with task refs
    Given a commit pushed to branch "feature/login" with message "task:abc123"
    When the GitHub commit processor runs
    Then task "abc123" status is set to "done"
    And an implemented_by relation is created

  Scenario: Push to main branch
    Given a commit pushed to branch "main" with message "task:abc123"
    When the GitHub commit processor runs
    Then task "abc123" status is set to "completed"
    And an implemented_by relation is created
```

## US-6: GitHub processor sets completed on merge to main

```gherkin
Feature: GitHub commit processor sets completed on merge

  Scenario: PR merged to main with task refs
    Given commits merged to "main" referencing "task:abc123"
    When the GitHub commit processor runs for the merge
    Then task "abc123" status is set to "completed"

  Scenario: Task already completed (idempotent)
    Given a merge to main referencing "task:abc123"
    And task "abc123" already has status "completed"
    When the GitHub commit processor runs
    Then task "abc123" status remains "completed"
```

## Backward transitions (unchanged, for reference)

```gherkin
Feature: Server owns backward transitions

  Scenario: Session aborted resets task to ready
    Given an agent session linked to a task with status "in_progress"
    When the session is aborted
    Then the task status is set to "ready"

  Scenario: Session rejected resets task to ready
    Given an agent session linked to a task with status "in_progress"
    When the session is rejected
    Then the task status is set to "ready"
```
