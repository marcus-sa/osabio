# Acceptance Criteria — MCP Tool Registry (#178)

## AC-1: Register Credential Provider [US-1, FR-6]

```gherkin
Given a workspace admin identity
When registering an OAuth2 provider with name, auth_method="oauth2", authorization_url, token_url, client_id, client_secret, scopes
Then a credential_provider record is created in the workspace
And client_secret is encrypted at rest (not stored plaintext)
And the provider appears in workspace provider listings
```

```gherkin
Given a workspace admin identity
When registering an API key provider with name, auth_method="api_key"
Then a credential_provider record is created with no OAuth-specific fields
And the provider appears in workspace provider listings
```

```gherkin
Given a credential_provider already exists with name "github" in the workspace
When registering another provider with name "github"
Then the system rejects with a duplicate name error
```

---

## AC-2: Discover Tools from MCP Server [US-2, FR-11, FR-12]

```gherkin
Given a connected MCP server serving 5 tools via tools/list
When Brain fetches the tool list
Then 5 mcp_tool records are created with name, description, input_schema, and output_schema (when present) from the response
And tools with destructiveHint=true get risk_level "high"
And tools with readOnlyHint=true get risk_level "low"
And tools without hints get risk_level "medium"
```

```gherkin
Given a connected MCP server that supports listChanged notifications
When the server pushes notifications/tools/list_changed
Then Brain re-fetches tools/list
And diffs against stored mcp_tool records
And creates new tools, updates changed schemas, marks removed tools as disabled
```

---

## AC-3: Grant Tool Access [US-3, FR-2]

```gherkin
Given mcp_tool "search_entities" and identity "agent-1"
When admin creates a can_use edge
Then the edge is persisted with granted_at timestamp
And "agent-1" effective toolset includes "search_entities"
```

```gherkin
Given a can_use edge with max_calls_per_hour=10
When "agent-1" has made 10 calls in the current hour
Then the 11th call returns rate limit error with reset time
```

---

## AC-4: Connect Account [US-4, FR-7]

### AC-4a: OAuth2 Connection

```gherkin
Given credential_provider "github" with auth_method="oauth2" in the workspace
When user initiates connection
Then Brain redirects to authorization_url with client_id, scopes, state, redirect_uri
```

```gherkin
Given the provider redirects back with authorization_code
When Brain exchanges the code at token_url
Then a connected_account is created with encrypted access_token and refresh_token
And status is "active"
And scopes reflect what was granted
```

```gherkin
Given the user denies consent at the provider
When the provider redirects back with error
Then no connected_account is created
And user sees "Connection cancelled" message
```

### AC-4b: Static Credential Connection

```gherkin
Given credential_provider "internal-api" with auth_method="api_key" in the workspace
When user submits their API key
Then a connected_account is created with encrypted api_key
And status is "active"
```

```gherkin
Given credential_provider "legacy-service" with auth_method="basic" in the workspace
When user submits username and password
Then a connected_account is created with basic_username and encrypted basic_password
And status is "active"
```

---

## AC-5: Proxy Tool Injection [US-5, FR-3, FR-4]

```gherkin
Given identity "agent-1" with can_use edges to ["github.create_issue", "search_entities"]
And the LLM request contains runtime tools ["read_file", "write_file"]
When the proxy processes the request
Then the forwarded request tools[] contains all 4 tools
And runtime tools are unmodified (same schema, same position)
And Brain-managed tools have correct name, description, input_schema from mcp_tool records
```

```gherkin
Given identity "agent-1" possesses skill "code-review"
And skill "code-review" requires tool "github.list_reviews" via skill_requires
And identity "agent-1" also has direct can_use to "github.list_reviews"
When the proxy resolves the effective toolset
Then "github.list_reviews" appears exactly once (deduplicated)
```

```gherkin
Given identity "new-agent" with no can_use edges and no skills
When the proxy processes the request
Then no tools are added to the request (only runtime tools remain)
```

---

## AC-6: Proxy Tool Call Routing [US-6, FR-5]

```gherkin
Given the LLM returns tool_call for "search_entities" (Brain-native)
When the proxy intercepts the tool call
Then the proxy executes the graph query directly
And returns the result to the LLM
And writes a trace record
```

```gherkin
Given the LLM returns tool_call for "github.create_issue" (integration)
When the proxy intercepts the tool call
Then the proxy routes to credential resolution (see AC-7)
```

```gherkin
Given the LLM returns tool_call for "read_file" (unknown to Brain)
When the proxy intercepts the tool call
Then the proxy passes the tool call through to the runtime
And does not write a trace record for it
```

---

## AC-7: Credential Brokerage [US-7, FR-8, FR-9]

### AC-7a: OAuth2 Credential Injection

```gherkin
Given mcp_tool "github.create_issue" with provider -> credential_provider "github" (auth_method="oauth2")
And connected_account for identity + provider with valid access_token
When the proxy executes the tool call
Then the access_token is attached as Authorization: Bearer header
And the API call is made to the tool's endpoint
And credentials are stripped from the response before returning to LLM
```

```gherkin
Given connected_account with expired access_token and valid refresh_token
When the proxy attempts tool execution
Then the proxy sends refresh request to credential_provider.token_url
And updates connected_account with new access_token and token_expires_at
And proceeds with execution using the new token
```

```gherkin
Given connected_account with expired access_token and expired/invalid refresh_token
When the proxy attempts tool execution
Then connected_account.status is set to "expired"
And the proxy returns error: "GitHub credentials expired. Please reconnect."
And no API call is made
```

### AC-7b: Static Credential Injection

```gherkin
Given mcp_tool "internal.query" with provider -> credential_provider "internal-api" (auth_method="api_key")
And connected_account for identity + provider with api_key
When the proxy executes the tool call
Then the api_key is attached as the provider-specific header
And credentials are stripped from the response
```

```gherkin
Given mcp_tool "legacy.fetch" with provider -> credential_provider "legacy-service" (auth_method="basic")
And connected_account with basic_username and basic_password
When the proxy executes the tool call
Then Authorization: Basic {base64(username:password)} header is attached
And credentials are stripped from the response
```

### AC-7c: Missing Account

```gherkin
Given no connected_account exists for the identity and provider
When the proxy intercepts a tool call for that provider's tool
Then the proxy returns error: "Provider account not connected."
And no API call is made
```

---

## AC-8: Tool Governance [US-8, FR-10]

```gherkin
Given policy "no-auto-merge" with governs_tool edge to "github.merge_pr"
And governs_tool has condition "requires_human_approval"
When the proxy intercepts tool_call for "github.merge_pr"
Then the proxy evaluates the policy
And returns error: "Tool call denied by policy: requires human approval"
And writes trace with denial reason
```

---

## AC-9: Tool Call Tracing [US-9, FR-13]

```gherkin
Given any Brain-managed tool call (native or integration)
When the proxy executes the call
Then a trace record is created with:
  | field       | value                              |
  | trace_type  | tool_call                          |
  | tool_name   | the tool's name                    |
  | identity    | the calling identity               |
  | workspace   | the workspace                      |
  | duration_ms | execution time                     |
  | outcome     | success / error / denied / rate_limited |
```

---

## AC-10: Revoke Connected Account [US-10]

```gherkin
Given an active connected_account for identity "user-1" and provider "github"
When "user-1" revokes the connection
Then connected_account.status is set to "revoked"
And subsequent tool calls for github tools return "account disconnected" error
And all credential fields (access_token, refresh_token, api_key, basic_password) are deleted (not just marked)
```

---

## AC-11: Tool Registry UI [US-11]

### AC-11a: Browse Tools

```gherkin
Given a workspace with 8 mcp_tool records across toolkits "github" and "slack"
When the admin opens the Tool Registry page
Then tools are listed grouped by toolkit
And each tool shows name, description, risk_level, status, and provider name
And the list is filterable by status (active/disabled) and risk_level
```

### AC-11b: Register Credential Provider

```gherkin
Given the admin clicks "Add Provider"
When they select auth_method "oauth2"
Then the form shows fields: name, display_name, authorization_url, token_url, client_id, client_secret, scopes
And submitting creates a credential_provider record
```

```gherkin
Given the admin clicks "Add Provider"
When they select auth_method "api_key"
Then the form shows only: name, display_name
And OAuth-specific fields are hidden
```

### AC-11c: Connect Account (OAuth2)

```gherkin
Given credential_provider "github" with auth_method="oauth2"
When a workspace member clicks "Connect" on "github"
Then the browser redirects to the provider's authorization URL
And on successful callback, the connected_account appears with status "active"
```

### AC-11d: Connect Account (Static)

```gherkin
Given credential_provider "internal-api" with auth_method="api_key"
When a workspace member clicks "Connect" on "internal-api"
Then a credential entry form appears with an API key field
And on submission, the connected_account appears with status "active"
```

### AC-11e: Tool Access Management

```gherkin
Given mcp_tool "github.create_issue" and identity "coding-agent-1"
When the admin assigns tool access with max_calls_per_hour=20
Then a can_use edge is created
And the identity's effective toolset view shows "github.create_issue"
```

```gherkin
Given identity "agent-1" with 2 direct grants and 1 skill-derived tool
When the admin views effective toolset for "agent-1"
Then all 3 tools are shown with source labels ("direct" or skill name)
```

### AC-11f: Connected Accounts Dashboard

```gherkin
Given identity "user-1" has 3 connected accounts (github: active, slack: active, internal-api: expired)
When "user-1" opens connected accounts
Then all 3 are listed with provider name, status, scopes, and connected_at
And "internal-api" shows a "Reconnect" action
And active accounts show a "Revoke" action
```

### AC-11g: MCP Server Discovery

```gherkin
Given the admin enters an MCP server URL and clicks "Connect"
When Brain calls tools/list and discovers 5 tools
Then a review screen shows the 5 discovered tools with names, descriptions, and suggested risk_levels
And the admin can accept or skip individual tools before import
And accepted tools become mcp_tool records in the workspace
```
