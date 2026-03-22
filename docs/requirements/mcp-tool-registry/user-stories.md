# User Stories — MCP Tool Registry (#178)

Each story traces to at least one JTBD job story.

---

## Epic: MCP Tool Registry

### US-1: Register Credential Provider [J1]

**As a** workspace admin
**I want to** register a credential provider (OAuth2, API key, bearer, or basic auth)
**So that** workspace members can connect their accounts and agents can use integration tools

**Size**: M
**Priority**: Must-have (Walking Skeleton prerequisite)

**Acceptance Criteria**: See AC-1

---

### US-2: Discover Tools from MCP Server [J1]

**As a** workspace admin
**I want to** connect an MCP server and have Brain discover its tools automatically
**So that** I don't have to manually define each tool's schema

**Size**: L
**Priority**: Should-have (manual tool creation is the walking skeleton path)

**Acceptance Criteria**: See AC-2

---

### US-3: Grant Tool Access to Identity [J1, J3]

**As a** workspace admin
**I want to** grant specific tool access to agent identities via can_use edges
**So that** I control which agents can use which tools

**Size**: S
**Priority**: Must-have (Walking Skeleton)

**Acceptance Criteria**: See AC-3

---

### US-4: Connect Account [J2]

**As a** workspace member
**I want to** connect my account to a provider — via OAuth flow or by entering credentials directly
**So that** agents can act with my identity without me sharing credentials outside Brain

**Size**: L
**Priority**: Must-have (required for credential brokerage)

**Acceptance Criteria**: See AC-4

---

### US-5: Proxy Injects Tools into LLM Request [J3]

**As an** agent routing through Brain's proxy
**I want** Brain-managed tools injected into my LLM requests automatically
**So that** I have integration capabilities without runtime-specific configuration

**Size**: L
**Priority**: Must-have (Walking Skeleton core)

**Acceptance Criteria**: See AC-5

---

### US-6a: Proxy Routes Brain-Native Tool Calls [J3]

**As an** agent
**I want** the proxy to intercept tool calls for Brain-native tools (graph queries, context tools) and execute them directly
**So that** I get seamless access to Brain's knowledge graph without runtime-specific wiring

**Size**: L
**Priority**: Must-have (Walking Skeleton core)

**Acceptance Criteria**: See AC-6 (Brain-native and pass-through scenarios)

---

### US-6b: Proxy Routes Integration Tool Calls [J3, J4]

**As an** agent
**I want** the proxy to intercept tool calls for integration tools and execute them with brokered credentials
**So that** I can use GitHub/Slack/Linear tools without holding any credentials

**Size**: L
**Priority**: Must-have (after US-7 credential brokerage)

**Acceptance Criteria**: See AC-6 (integration scenario) + AC-7

---

### US-7: Credential Brokerage at Execution [J4]

**As a** Brain proxy
**I want to** resolve and inject credentials by auth method at tool call time
**So that** agents never see raw tokens/keys and OAuth2 credentials are always fresh

**Size**: L
**Priority**: Must-have (required for integration tools)

**Acceptance Criteria**: See AC-7

---

### US-8: Tool Governance via Policy [J1, J4]

**As a** workspace admin
**I want to** attach governance policies to tools
**So that** high-risk tool calls require approval or are rate-limited

**Size**: M
**Priority**: Should-have

**Acceptance Criteria**: See AC-8

---

### US-9: Tool Call Tracing [J4]

**As a** workspace admin or auditor
**I want** every tool call to produce a forensic trace record
**So that** I can audit what agents did with integration tools

**Size**: S
**Priority**: Must-have (Walking Skeleton)

**Acceptance Criteria**: See AC-9

---

### US-10: Revoke Connected Account [J2]

**As a** workspace member
**I want to** disconnect my account from a provider
**So that** agents can no longer act with my credentials

**Size**: S
**Priority**: Must-have

**Acceptance Criteria**: See AC-10

---

### US-11: Tool Registry UI [J1, J2]

**As a** workspace admin or member
**I want** a Tool Registry UI to browse tools, manage providers, connect accounts, and grant access
**So that** I can govern the workspace's integration toolset without CLI or raw API calls

**Size**: XL
**Priority**: Must-have (final phase — backend-first, UI layers on top)

**Sub-capabilities**:
- **Browse tools**: list workspace `mcp_tool` records grouped by toolkit, filterable by status/risk_level, showing name, description, risk_level, provider, and grant count
- **Provider management**: register/edit/delete `credential_provider` records — form adapts to auth_method (OAuth2 shows client_id/secret/URLs/scopes; api_key/bearer/basic shows only name/display_name)
- **Account connection**: "Connect" button per provider — OAuth2 triggers redirect flow, static methods show credential entry form. Shows connection status (active/expired/revoked) with reconnect action
- **Tool access management**: assign `can_use` edges from identities to tools, with optional max_calls_per_hour. View effective toolset per identity (direct + skill-derived)
- **Tool governance**: attach `governs_tool` policy edges to tools with conditions and limits
- **MCP server connection**: connect external MCP servers, trigger `tools/list` discovery, review discovered tools before import
- **Connected accounts dashboard**: list connected accounts per identity with status, provider, scopes, connected_at. Revoke action deletes credentials

**Acceptance Criteria**: See AC-11

---

## Walking Skeleton Stories (ordered)

1. **US-3** — Grant tool access (schema + can_use)
2. **US-5** — Proxy tool injection
3. **US-6a** — Proxy routes Brain-native tool calls
4. **US-9** — Tool call tracing
5. **US-1** — Credential provider registration (all auth methods)
6. **US-4** — Account connection (static credentials first, then OAuth2)
7. **US-7** — Credential brokerage (static injection first, then OAuth2 with refresh)
8. **US-6b** — Proxy routes integration tool calls
9. **US-8** — Tool governance
10. **US-2** — MCP server discovery
11. **US-10** — Account revocation
12. **US-11** — Tool Registry UI (browse, manage, connect, grant)
