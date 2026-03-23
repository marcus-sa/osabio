# Acceptance Criteria — mcp-server-auth

## Gherkin Scenarios

### Static Headers

```gherkin
Feature: Static Header Authentication for MCP Servers

  Scenario: Add MCP server with static API key header
    Given admin is on the Add MCP Server dialog
    When admin enters server name "github-mcp" and URL "https://mcp.github.com"
    And admin selects auth mode "Static Headers"
    And admin adds header "Authorization" with value "Bearer ghp_abc123"
    And admin clicks "Add Server"
    Then the MCP server is created with auth_mode "static_headers"
    And the header value is encrypted at rest
    And the header value is not returned in GET /mcp-servers responses

  Scenario: Static headers injected during discovery
    Given MCP server "github-mcp" has static header "Authorization: Bearer ghp_abc123"
    When admin triggers discovery on "github-mcp"
    Then the MCP client connection includes the header "Authorization: Bearer ghp_abc123"
    And tools/list returns tools from the authenticated server

  Scenario: Static headers injected during tool execution
    Given MCP server "github-mcp" has static header "Authorization: Bearer ghp_abc123"
    And tool "create_issue" was discovered from "github-mcp"
    When the proxy executes tool "create_issue"
    Then the MCP client connection includes the header "Authorization: Bearer ghp_abc123"

  Scenario: Edit static headers
    Given MCP server "github-mcp" has static header "Authorization: Bearer ghp_old"
    When admin updates the header value to "Bearer ghp_new"
    Then subsequent connections use the updated header
    And the old value is no longer stored
```

### OAuth 2.1 Discovery

```gherkin
Feature: MCP OAuth 2.1 Auto-Discovery

  Scenario: Successful OAuth discovery from MCP server
    Given MCP server at "https://mcp.example.com" returns 401 on unauthenticated request
    And "https://mcp.example.com/.well-known/oauth-protected-resource" returns:
      | authorization_servers | ["https://auth.example.com"] |
    And "https://auth.example.com/.well-known/oauth-authorization-server" returns:
      | authorization_endpoint | https://auth.example.com/authorize |
      | token_endpoint         | https://auth.example.com/token     |
      | registration_endpoint  | https://auth.example.com/register  |
    When admin adds MCP server "https://mcp.example.com" with auth mode "OAuth"
    Then Brain displays discovered auth server "auth.example.com"
    And admin sees an "Authorize" button

  Scenario: OAuth discovery fails gracefully
    Given MCP server at "https://mcp.example.com" does not serve Protected Resource Metadata
    When admin adds MCP server with auth mode "OAuth"
    Then Brain shows "OAuth discovery failed"
    And admin can switch to "Static Headers" or select a manual provider

  Scenario: Auto-created provider from discovery
    Given OAuth discovery succeeds for "https://mcp.example.com"
    When admin completes authorization
    Then a credential_provider is created with discovery_source = "https://mcp.example.com"
    And the provider's authorization_url and token_url match discovered values
```

### OAuth 2.1 Authorization Flow

```gherkin
Feature: OAuth 2.1 Browser Authorization

  Scenario: Complete OAuth authorization flow
    Given MCP server "example-mcp" has discovered OAuth config
    When admin clicks "Authorize"
    Then Brain generates a PKCE code_verifier and code_challenge
    And Brain opens authorization_endpoint with:
      | response_type  | code                    |
      | code_challenge | {S256 challenge}        |
      | redirect_uri   | {Brain callback URL}    |
      | state          | {random state}          |
    And after user authorizes, callback receives authorization code
    And Brain exchanges code for tokens at token_endpoint with code_verifier
    And tokens are encrypted and stored in connected_account
    And MCP server status shows "Connected"

  Scenario: Token refresh on expiry
    Given MCP server "example-mcp" has an expired access_token
    And a valid refresh_token exists
    When the proxy attempts to execute a tool on "example-mcp"
    Then Brain refreshes the token at token_endpoint
    And the new access_token is encrypted and stored
    And tool execution proceeds with the new token

  Scenario: Refresh token expired
    Given MCP server "example-mcp" has an expired refresh_token
    When the proxy attempts to execute a tool on "example-mcp"
    Then MCP server status changes to "auth_error"
    And admin sees "Auth expired — re-authorize" in the UI
```
