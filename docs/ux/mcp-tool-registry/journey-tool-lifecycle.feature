Feature: MCP Tool Registry with Proxy-Based Tool Injection and Credential Brokerage
  As a Brain workspace, agents get integration tools injected transparently
  via the LLM proxy, with credentials brokered at execution time,
  so agents never see raw tokens and admins govern tool access via the graph.

  # ── Job 1: Provider Registration ──────────────────────────────────

  Scenario: Workspace admin registers an OAuth2 credential provider
    Given a workspace with admin identity "admin-1"
    When the admin registers a credential provider with:
      | field              | value                                          |
      | name               | github                                         |
      | display_name       | GitHub                                         |
      | auth_method        | oauth2                                         |
      | authorization_url  | https://github.com/login/oauth/authorize       |
      | token_url          | https://github.com/login/oauth/access_token    |
      | client_id          | gh-client-123                                  |
      | scopes             | repo,read:org                                  |
    Then a credential_provider record exists in the workspace
    And the client_secret is encrypted at rest
    And the provider appears in the workspace provider list

  Scenario: Workspace admin registers an API key credential provider
    Given a workspace with admin identity "admin-1"
    When the admin registers a credential provider with:
      | field              | value                                          |
      | name               | internal-api                                   |
      | display_name       | Internal API                                   |
      | auth_method        | api_key                                        |
    Then a credential_provider record exists in the workspace
    And no OAuth-specific fields are required

  Scenario: Admin discovers tools from connected MCP server
    Given a workspace with registered credential_provider "github"
    And an MCP server at "https://mcp.github.example/sse" serving tools:
      | name                  | description               | destructiveHint |
      | github.create_issue   | Create a GitHub issue     | true            |
      | github.list_repos     | List repositories         | false           |
      | github.merge_pr       | Merge a pull request      | true            |
    When the admin connects the MCP server
    Then Brain calls tools/list on the server
    And 3 mcp_tool records are created in the workspace
    And tools with destructiveHint=true have risk_level "high"
    And tools with destructiveHint=false have risk_level "low"

  Scenario: Admin grants tool access to an agent identity
    Given mcp_tool "github.create_issue" exists in the workspace
    And identity "coding-agent-1" exists
    When the admin creates a can_use edge from "coding-agent-1" to "github.create_issue"
    Then "coding-agent-1" effective toolset includes "github.create_issue"

  # ── Job 2: Account Connection ─────────────────────────────────────

  Scenario: User connects their GitHub account via OAuth2
    Given credential_provider "github" with auth_method="oauth2" is registered in the workspace
    And identity "user-1" is a workspace member
    When "user-1" initiates connection to "github"
    Then Brain redirects to the provider's authorization_url with correct state
    When the provider redirects back with an authorization code
    Then Brain exchanges the code for access and refresh tokens
    And a connected_account record links "user-1" to "github"
    And tokens are encrypted at rest
    And connected_account status is "active"

  Scenario: User connects an API key provider via direct entry
    Given credential_provider "internal-api" with auth_method="api_key" is registered in the workspace
    And identity "user-1" is a workspace member
    When "user-1" submits their API key for "internal-api"
    Then a connected_account record links "user-1" to "internal-api"
    And the api_key is encrypted at rest
    And connected_account status is "active"

  Scenario: User denies OAuth consent
    Given credential_provider "github" with auth_method="oauth2" is registered in the workspace
    When "user-1" initiates connection but denies consent at provider
    Then Brain shows "Connection cancelled"
    And no connected_account record is created
    And no partial state remains

  # ── Job 3: Transparent Tool Injection ─────────────────────────────

  Scenario: Proxy injects tools into LLM request based on identity
    Given identity "coding-agent-1" has can_use edges to:
      | tool                  |
      | github.create_issue   |
      | github.list_repos     |
    And identity "coding-agent-1" possesses skill "code-review" which requires:
      | tool                  |
      | github.list_reviews   |
    And the agent sends an LLM request through the proxy with runtime tools:
      | tool        |
      | read_file   |
      | write_file  |
    When the proxy processes the request
    Then the forwarded request tools[] contains:
      | tool                  | source          |
      | read_file             | runtime         |
      | write_file            | runtime         |
      | github.create_issue   | direct grant    |
      | github.list_repos     | direct grant    |
      | github.list_reviews   | skill-derived   |
    And runtime tools are not modified

  Scenario: Proxy does not inject tools for identity with no grants
    Given identity "new-agent" has no can_use edges and no skills
    And the agent sends an LLM request through the proxy with runtime tools:
      | tool        |
      | read_file   |
    When the proxy processes the request
    Then the forwarded request tools[] contains only:
      | tool        |
      | read_file   |

  Scenario: Proxy deduplicates tools when skill and direct grant overlap
    Given identity "agent-1" has can_use edge to "github.create_issue"
    And identity "agent-1" possesses skill "triage" which also requires "github.create_issue"
    When the proxy resolves the effective toolset
    Then "github.create_issue" appears exactly once in tools[]

  # ── Job 4: Credential Brokerage at Execution ──────────────────────

  Scenario: Proxy executes OAuth2 tool call with brokered credentials
    Given identity "coding-agent-1" has connected_account for provider "github" (auth_method="oauth2")
    And the connected_account has a valid (non-expired) access_token
    And the LLM returns tool_call for "github.create_issue" with arguments:
      | field  | value                    |
      | title  | Fix login bug            |
      | repo   | brain/core               |
    When the proxy intercepts the tool call
    Then the proxy resolves mcp_tool "github.create_issue"
    And resolves credential_provider from mcp_tool.provider
    And resolves connected_account for identity + provider
    And injects access_token as Authorization: Bearer header
    And strips credentials from the response
    And writes a trace record with tool_call type
    And returns the sanitized result to the LLM

  Scenario: Proxy executes API key tool call with brokered credentials
    Given identity "agent-1" has connected_account for provider "internal-api" (auth_method="api_key")
    And the connected_account has an api_key
    And the LLM returns tool_call for "internal.query"
    When the proxy intercepts the tool call
    Then the proxy injects the api_key as the provider-specific header
    And strips credentials from the response
    And writes a trace record with tool_call type

  Scenario: Proxy refreshes expired OAuth2 token before execution
    Given identity "agent-1" has connected_account for "github" (auth_method="oauth2")
    And the access_token has expired but refresh_token is valid
    When the proxy intercepts a tool call for "github.list_repos"
    Then the proxy detects token_expires_at is past
    And calls the credential_provider.token_url with refresh_token
    And updates connected_account with new access_token and token_expires_at
    And proceeds with tool execution using the new token

  Scenario: Proxy returns error when no connected account exists
    Given identity "agent-1" has can_use edge to "github.create_issue"
    But identity "agent-1" has no connected_account for provider "github"
    When the LLM returns tool_call for "github.create_issue"
    Then the proxy returns a tool result with error:
      """
      GitHub account not connected. A workspace member needs to connect
      their GitHub account before this tool can execute.
      """
    And no external API call is made

  Scenario: Proxy passes through unknown tool calls to runtime
    Given the LLM returns tool_call for "read_file" (a runtime tool)
    When the proxy intercepts the tool call
    And "read_file" does not match any mcp_tool record
    Then the proxy passes the tool call through to the runtime
    And does not attempt credential resolution

  Scenario: Policy denies tool call
    Given identity "agent-1" has can_use edge to "github.merge_pr"
    And policy "no-auto-merge" governs "github.merge_pr" with condition "requires_human_approval"
    When the LLM returns tool_call for "github.merge_pr"
    Then the proxy evaluates governs_tool policy
    And returns a tool result with error:
      """
      Tool call denied by policy "no-auto-merge": requires human approval.
      """
    And writes a trace record with denial reason

  Scenario: Rate limit enforced on tool calls
    Given identity "agent-1" has can_use edge to "github.create_issue" with max_calls_per_hour=10
    And "agent-1" has made 10 calls to "github.create_issue" in the last hour
    When the LLM returns another tool_call for "github.create_issue"
    Then the proxy returns rate limit error with reset time
    And writes a trace record with rate_limit_exceeded

  # ── Walking Skeleton Boundary ─────────────────────────────────────

  Scenario: Walking skeleton - Brain-native tool execution via proxy
    Given identity "agent-1" has can_use edge to Brain-native tool "search_entities"
    And the agent sends an LLM request through the proxy
    When the proxy injects "search_entities" into tools[]
    And the LLM returns tool_call for "search_entities" with query "rate limiting"
    Then the proxy executes the graph query directly (no credential resolution)
    And returns search results to the LLM
    And writes a trace record
