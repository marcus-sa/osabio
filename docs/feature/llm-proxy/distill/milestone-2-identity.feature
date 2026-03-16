Feature: Identity Resolution (US-LP-002)
  As a workspace admin,
  I need to know which developer or agent made each LLM call,
  so that I can attribute costs and investigate usage patterns.

  Background:
    Given Brain's proxy is running and accepting requests

  # --- Happy Path ---

  Scenario: Full identity resolved from Claude Code metadata and headers
    Given Priya's request includes metadata.user_id "user_a1b2c3_account_550e8400-e29b-41d4-a716-446655440000_session_6ba7b810-9dad-11d1-80b4-00c04fd430c8"
    And the request includes workspace header "brain-v1"
    And the request includes task header "implement-oauth"
    When the proxy resolves identity
    Then the session is identified as "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
    And the account is identified as "550e8400-e29b-41d4-a716-446655440000"
    And the workspace is "brain-v1"
    And the task is "implement-oauth"

  # --- Graceful Degradation ---

  Scenario: Identity resolves without task header
    Given Priya's request includes metadata.user_id with valid session and account
    And the request includes workspace header "brain-v1"
    And no task header is present
    When the proxy resolves identity
    Then workspace and session are resolved
    And the trace is created without task attribution
    And the request is forwarded normally

  Scenario: Identity resolves without any metadata
    Given a third-party agent sends a request with workspace header "brain-v1"
    And no metadata.user_id is present in the request body
    When the proxy resolves identity
    Then workspace is resolved from the header
    And the trace is created with session omitted
    And the request is forwarded normally

  # --- Error Paths ---

  Scenario: Invalid workspace produces warning but does not block
    Given a request includes workspace header "nonexistent-workspace"
    When the proxy resolves identity
    Then the request is forwarded using the client's own API key
    And a warning observation is created noting the unresolved workspace
    And the trace is created without a workspace link

  Scenario: Malformed metadata.user_id parsed as opaque identifier
    Given a request includes metadata.user_id "some-random-string-not-matching-pattern"
    When the proxy resolves identity
    Then the user_hash is set to the raw string
    And no session or account is extracted
    And the request is forwarded normally
