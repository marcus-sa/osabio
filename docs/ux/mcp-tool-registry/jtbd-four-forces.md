# Four Forces Analysis — MCP Tool Registry (#178)

## Job 1: Provider Registration (Workspace Admin)

| Force | Analysis |
|-------|----------|
| **Push** (current frustration) | Agents can't interact with GitHub/Slack/Linear at all. Workspace admins have no way to enable integrations — the only option is raw API keys in env vars per agent runtime, which is insecure and unscalable. |
| **Pull** (desired future) | Register a provider once, all workspace agents get governed access. One admin action enables N agents. Credentials encrypted at rest, never exposed to agent context. |
| **Anxiety** (adoption concerns) | "What if the OAuth app credentials get compromised?" "What if an agent makes API calls I didn't authorize?" "How do I audit what happened?" |
| **Habit** (current behavior) | Manually setting `GITHUB_TOKEN` in agent runtime env vars. Copy-pasting tokens between tools. Some teams avoid integrations entirely because of credential risk. |

---

## Job 2: Account Connection (User/Agent Identity)

| Force | Analysis |
|-------|----------|
| **Push** (current frustration) | Users can't delegate their API identity to agents. Either the user does integration work manually, or shares raw tokens via env vars — violating OAuth best practices and security policy. |
| **Pull** (desired future) | Two paths: standard OAuth consent screen for GitHub/Slack/Linear, or simple API key entry for internal APIs. Either way, agents act with user's identity and scoped permissions. Revocable anytime. |
| **Anxiety** (adoption concerns) | "Will agents post as me without my knowledge?" "Can I see what actions were taken with my credentials?" "What happens when my token expires?" |
| **Habit** (current behavior) | Users manually execute integration tasks (creating issues, posting to Slack) because they don't trust automated access. Or they share personal access tokens, losing auditability. |

---

## Job 3: Transparent Tool Injection (Agent/Proxy)

| Force | Analysis |
|-------|----------|
| **Push** (current frustration) | Osabio's proxy already injects context (decisions, learnings, observations) but NOT tools. Agents in any runtime (OpenClaw, Cursor, etc.) only see their local tools. Integration capabilities are invisible — agents can't create GitHub issues, send Slack messages, or query Linear even when the workspace has those integrations. |
| **Pull** (desired future) | Proxy resolves identity -> effective toolset -> injects tool definitions additively alongside whatever tools the runtime already provides. Agent sees one unified toolset. Zero configuration per agent. |
| **Anxiety** (adoption concerns) | "Will injected tools conflict with runtime tools?" "Will tool injection increase latency?" "What if too many tools get injected and confuse the LLM?" |
| **Habit** (current behavior) | Agents only use tools their runtime provides (filesystem, shell, git). Osabio-native context tools are exposed via the CLI MCP server (stdio), not via the proxy. Integration tools don't exist at all. |

---

## Job 4: Credential Brokerage at Execution (Proxy)

| Force | Analysis |
|-------|----------|
| **Push** (current frustration) | No mechanism exists to attach credentials to tool calls at execution time. If an agent could somehow call `github.create_issue`, there's no way to resolve whose credentials to use, whether tokens are expired, or how to refresh them — all transparently. |
| **Pull** (desired future) | Proxy intercepts integration tool_calls, resolves mcp_tool -> credential_provider -> connected_account, refreshes if expired, attaches token, executes, strips credentials from response, writes trace. Zero credential exposure to agent or LLM. |
| **Anxiety** (adoption concerns) | "What if token refresh fails mid-call?" "What if the proxy adds too much latency?" "What if credential resolution picks the wrong account?" |
| **Habit** (current behavior) | No credential brokerage exists. The proxy forwards LLM requests but doesn't intercept tool calls. Tool execution is entirely the runtime's responsibility. |
