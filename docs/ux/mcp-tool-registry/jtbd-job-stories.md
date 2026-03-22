# JTBD Job Stories — MCP Tool Registry (#178)

## Job 1: Provider Registration (Workspace Admin)

**Job Story**: "When I want my team's agents to interact with GitHub, Slack, Linear, or internal APIs, I want to register credential providers once for my workspace, so I can enable integrations without giving raw credentials to agents."

**Dimensions**:
- **Functional**: Register credential providers (OAuth2 with client ID/secret/URLs/scopes, or API key/bearer/basic for simpler integrations) per workspace
- **Emotional**: Confidence that credentials are secured and agents can't leak them
- **Social**: Perceived as responsible steward of team's API access and secrets

---

## Job 2: Account Connection (User/Agent Identity)

**Job Story**: "When a credential provider is available in my workspace, I want to connect my account — via OAuth flow or by entering an API key — so agents can act on my behalf without me sharing credentials directly with them."

**Dimensions**:
- **Functional**: Connect via OAuth2 authorization code flow (GitHub/Slack/Linear) or enter static credentials (API key/bearer/basic) — store encrypted, enable agents to use my identity
- **Emotional**: Trust that my tokens are managed safely and I can revoke access anytime
- **Social**: Perceived as a team member who enables agent productivity without security shortcuts

---

## Job 3: Transparent Tool Injection (Agent/Proxy)

**Job Story**: "When an agent routes an LLM request through Brain's proxy, I want the right integration and context tools injected into the request automatically, so agents get a unified toolset without knowing how discovery works."

**Dimensions**:
- **Functional**: Resolve identity -> resolve effective toolset (direct grants + skill-derived) -> inject tool definitions alongside runtime tools
- **Emotional**: Seamless — agents never experience "missing tool" friction
- **Social**: Agents perceived as competent by users because they have the right capabilities

---

## Job 4: Credential Brokerage at Execution (Proxy)

**Job Story**: "When an LLM responds with a tool call for an integration tool, I want the proxy to intercept it, resolve credentials, execute the call, and return sanitized results, so agents never see raw tokens and credentials are always fresh."

**Dimensions**:
- **Functional**: Intercept tool_calls -> match to mcp_tool -> resolve connected_account -> inject credential by auth method (OAuth2 bearer, API key, bearer token, basic auth) -> execute -> strip credentials -> trace
- **Emotional**: Security confidence — credentials never leak to LLM context or agent logs
- **Social**: Auditors and compliance see a clean credential chain with full provenance
