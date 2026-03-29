# Acceptance Criteria: Osabio CLI Proxy Setup

```gherkin
Feature: Osabio CLI proxy setup

  Scenario: Fresh setup with no existing settings.local.json
    Given a repo with no .claude/settings.local.json
    And osabio init has completed OAuth successfully
    When the proxy setup step runs
    Then .claude/settings.local.json is created with:
      | key                    | value                                                                    |
      | env.ANTHROPIC_BASE_URL | {server_url}/proxy/llm/anthropic                                        |
      | env.ANTHROPIC_CUSTOM_HEADERS  | X-Osabio-Auth: {proxy_token}                                              |
    And the proxy token is stored in ~/.osabio/config.json
    And the CLI prints confirmation with proxy URL and token expiry

  Scenario: Existing settings.local.json with other config
    Given a repo with .claude/settings.local.json containing other env vars
    When the proxy setup step runs
    Then the env keys are merged (not overwritten)
    And existing non-Brain env vars are preserved
    And existing non-env config keys are preserved

  Scenario: Re-running osabio init refreshes proxy token
    Given a repo already configured with proxy settings
    When the user runs osabio init again
    Then a new proxy token is issued via the existing OAuth flow
    And .claude/settings.local.json is updated with the new token
    And the old token is invalidated server-side

  Scenario: Proxy token is long-lived
    Given the OAuth flow completes
    When the server issues a proxy token
    Then the token has a TTL of at least 90 days
    And the expiry is stored in ~/.osabio/config.json under the repo entry

  Scenario: Session start detects expired token
    Given a proxy token that has expired
    When a Claude Code session starts (SessionStart hook)
    Then the hook warns the user to re-run osabio init

  Scenario: Proxy validates Osabio auth headers
    Given a request to the LLM proxy
    When the request includes X-Osabio-Auth: {proxy_token} header
    Then the proxy validates the token against the server
    And derives the workspace and identity from the token record
    And forwards the request to Anthropic using Osabio's own API key

  Scenario: Proxy rejects unauthenticated requests
    Given a request to the LLM proxy
    When the request is missing Osabio auth headers
    Then the proxy returns 401 with a clear error message

  Scenario: .gitignore verification
    Given a repo where .claude/settings.local.json is not in .gitignore
    When the proxy setup step runs
    Then the CLI warns that .claude/settings.local.json should be gitignored
    And offers to add it to .gitignore

  Scenario: No fallback to direct Anthropic
    Given the Osabio proxy is unreachable
    When Claude Code sends a request
    Then the request fails with a connection error
    And no fallback to direct Anthropic API occurs
```
