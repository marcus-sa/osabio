Feature: Contextual Review with Agent Conversation Log
  As an engineering lead reviewing agent work
  I want to see the agent's full conversation log alongside the code diff
  So that I can understand the agent's reasoning and provide informed feedback

  Background:
    Given a workspace with a task where the agent has completed work

  # --- Happy Path ---

  # US-CS-004 AC: Agent Log displays full chronological conversation trail
  Scenario: Review includes the agent conversation log
    When Marcus opens the review for the completed session
    Then the review provides the conversation log
    And the log entries are in chronological order

  # US-CS-004 AC: User prompts visually distinct from agent output
  Scenario: Agent log shows user prompts as distinct entries
    Given Marcus sent a follow-up prompt during the session
    When Marcus views the conversation log
    Then user prompts appear as a separate entry type from agent output

  # US-CS-004 AC: File change notifications inline with file names
  Scenario: File change notifications appear in the conversation log
    Given the agent modified files during its work
    When Marcus views the conversation log
    Then file change entries appear in the log
    And each file change entry identifies the file that was changed

  # US-CS-004 AC: Session metadata in review header
  Scenario: Review includes session metadata
    When Marcus opens the review for the completed session
    Then the review shows when the session started
    And the review shows the session's final status

  # US-CS-004 review for session with no user intervention
  Scenario: Review page for session with no user follow-up prompts
    Given the agent completed its work without any user prompts
    When Marcus views the conversation log
    Then the log contains only agent output and file changes
    And no user prompt entries appear in the log

  # --- Error Paths ---

  # Edge: review log for nonexistent session
  Scenario: Conversation log for nonexistent session fails
    When Marcus requests the conversation log for a session that does not exist
    Then the request fails because the session was not found

  # Edge: review log for aborted session
  Scenario: Conversation log available for aborted session
    Given the agent session was aborted before completion
    When Marcus views the conversation log
    Then the log shows activity up to the point of abort

  # US-CS-004 AC: Reject includes feedback textarea
  Scenario: Reject feedback is informed by conversation log context
    Given Marcus is reviewing a completed session with its conversation log
    When Marcus rejects the work with feedback "Missing error handling in auth module"
    Then the rejection is accepted
    And the feedback is delivered to the agent
    And the session resumes with the agent working

  # Edge: reject then view updated log
  Scenario: Conversation log updates after rejection and resumed work
    Given Marcus rejected the work with feedback "Add input validation"
    And the agent resumed work incorporating the feedback
    When Marcus views the updated conversation log
    Then the log includes the rejection feedback as a user prompt entry
