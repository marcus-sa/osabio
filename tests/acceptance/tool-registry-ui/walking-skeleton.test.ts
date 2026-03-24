/**
 * Walking Skeleton: Tool Registry UI End-to-End
 *
 * Traces: US-UI-01, US-UI-02, US-UI-03, US-UI-04, US-UI-05, US-UI-11
 *
 * Thinnest E2E slice proving observable user value:
 *   Admin registers a provider -> Member connects account ->
 *   Admin seeds tools -> Admin grants access -> Both browse tools ->
 *   Agent executes injected tool end-to-end
 *
 * This skeleton answers: "Can workspace users manage integrations,
 * see their tools, and have agents actually execute those tools?"
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/providers         (register provider)
 *   GET  /api/workspaces/:wsId/providers          (list providers)
 *   POST /api/workspaces/:wsId/accounts/connect/  (connect account)
 *   GET  /api/workspaces/:wsId/accounts            (list accounts)
 *   GET  /api/workspaces/:wsId/tools               (list tools)
 *   GET  /api/workspaces/:wsId/tools/:toolId       (tool detail)
 *   POST /api/workspaces/:wsId/tools/:toolId/grants (grant access)
 *   POST /api/workspaces/:wsId/mcp-servers         (register MCP server)
 *   POST /api/workspaces/:wsId/mcp-servers/:id/discover (discover tools)
 *   POST /api/workspaces/:wsId/mcp-servers/:id/sync (import tools)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  createMockMcpClientFactory,
  createMockAnthropicMsw,
  sendProxyRequest,
  createProvider,
  listProviders,
  connectAccount,
  listAccounts,
  listTools,
  getToolDetail,
  grantToolAccess,
  seedTool,
  seedProvider,
  seedMcpServer,
  seedDiscoveredTool,
  seedGrant,
  addMcpServer,
  discoverTools,
  syncServerTools,
} from "./tool-registry-ui-test-kit";

const mockMcpFactory = createMockMcpClientFactory({
  tools: [
    {
      name: "github.create_issue",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
    },
    {
      name: "github.list_repos",
      description: "List repositories",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
  ],
  onCallTool: (name, args) => ({
    content: [{ type: "text", text: JSON.stringify({ tool: name, result: "ok", args }) }],
  }),
});

const getRuntime = setupToolRegistrySuite("tool_registry_ui_walking_skeleton", {
  mcpClientFactory: mockMcpFactory,
});

// MSW mock for skeleton 6
const mockAnthropic = createMockAnthropicMsw([]);
beforeAll(() => mockAnthropic.listen());
afterAll(() => mockAnthropic.close());

describe("Walking Skeleton: Admin manages integrations end-to-end", () => {
  // ---------------------------------------------------------------------------
  // Skeleton 1: Admin registers a provider and it appears in the provider list
  // US-UI-03 + US-UI-01 (Providers tab data)
  // ---------------------------------------------------------------------------
  it("admin registers an API key provider and sees it listed", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-skel1-${crypto.randomUUID()}`);

    // Given a workspace with no providers
    // When admin registers an API key provider named "Internal API"
    const createRes = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "internal-api",
      display_name: "Internal API",
      auth_method: "api_key",
      api_key_header: "X-API-Key",
    });

    // Then the provider is created successfully
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json() as {
      id: string;
      name: string;
      display_name: string;
      auth_method: string;
      has_client_secret: boolean;
    };
    expect(createBody.name).toBe("internal-api");
    expect(createBody.display_name).toBe("Internal API");
    expect(createBody.auth_method).toBe("api_key");
    expect(createBody.has_client_secret).toBe(false);

    // And the provider appears in the workspace provider list
    const listRes = await listProviders(baseUrl, admin, admin.workspaceId);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { providers: Array<{ name: string }> };
    expect(listBody.providers.length).toBeGreaterThanOrEqual(1);
    const found = listBody.providers.find((p) => p.name === "internal-api");
    expect(found).toBeDefined();
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Skeleton 2: Member connects account and sees it in account list
  // US-UI-04 + US-UI-07 (Accounts tab data)
  // ---------------------------------------------------------------------------
  it("member connects an API key account and sees it in their accounts", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-skel2-${crypto.randomUUID()}`);

    // Given a provider "Internal API" exists in the workspace
    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
    });

    // When member connects their API key
    const connectRes = await connectAccount(
      baseUrl,
      member,
      member.workspaceId,
      providerId,
      { api_key: "sk-test-key-12345" },
    );

    // Then the account is connected successfully
    expect(connectRes.status).toBe(201);
    const connectBody = await connectRes.json() as {
      id: string;
      status: string;
      has_api_key: boolean;
    };
    expect(connectBody.status).toBe("active");
    expect(connectBody.has_api_key).toBe(true);

    // And the account appears in member's account list
    const listRes = await listAccounts(baseUrl, member, member.workspaceId);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { accounts: Array<{ status: string }> };
    expect(listBody.accounts.length).toBeGreaterThanOrEqual(1);
    expect(listBody.accounts[0].status).toBe("active");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Skeleton 3: Admin browses tools grouped by toolkit
  // US-UI-02 (Tools tab data) -- depends on GET /tools endpoint (NEW)
  // ---------------------------------------------------------------------------
  it("admin browses tools and sees them grouped with grant counts", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-skel3-${crypto.randomUUID()}`);

    // Given the workspace has tools across two toolkits
    const { providerId } = await seedProvider(surreal, admin.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "gh-client-123",
    });

    await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      riskLevel: "medium",
      providerId,
    });

    await seedTool(surreal, admin.workspaceId, {
      name: "github.merge_pr",
      toolkit: "github",
      description: "Merge a pull request",
      riskLevel: "high",
      providerId,
    });

    await seedTool(surreal, admin.workspaceId, {
      name: "slack.post_message",
      toolkit: "slack",
      description: "Post a message to Slack",
      riskLevel: "low",
    });

    // When admin requests the tools list
    const listRes = await listTools(baseUrl, admin, admin.workspaceId);

    // Then the response includes all tools with toolkit grouping data
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { tools: Array<{
      name: string;
      toolkit: string;
      risk_level: string;
      status: string;
      grant_count: number;
    }> };

    expect(listBody.tools.length).toBe(3);

    const githubTools = listBody.tools.filter((t) => t.toolkit === "github");
    expect(githubTools.length).toBe(2);

    const slackTools = listBody.tools.filter((t) => t.toolkit === "slack");
    expect(slackTools.length).toBe(1);

    // And each tool has the expected data shape for the Tools tab
    const createIssue = listBody.tools.find((t) => t.name === "github.create_issue");
    expect(createIssue).toBeDefined();
    expect(createIssue!.risk_level).toBe("medium");
    expect(createIssue!.status).toBe("active");
    expect(createIssue!.grant_count).toBe(0);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Skeleton 4: Admin grants tool access and sees it reflected
  // US-UI-05 (Access tab) -- depends on POST/GET /tools/:id/grants (NEW)
  // ---------------------------------------------------------------------------
  it("admin grants tool access to an identity and sees the grant listed", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-skel4-${crypto.randomUUID()}`);

    // Given a tool exists in the workspace
    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      riskLevel: "medium",
    });

    // When admin grants access to the coding agent with a rate limit
    const grantRes = await grantToolAccess(baseUrl, admin, admin.workspaceId, toolId, {
      identity_id: admin.identityId,
      max_calls_per_hour: 20,
    });

    // Then the grant is created
    expect(grantRes.status).toBe(201);

    // And the tool detail shows the grant
    const detailRes = await getToolDetail(baseUrl, admin, admin.workspaceId, toolId);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as {
      name: string;
      grants: Array<{
        identity_id: string;
        identity_name: string;
        max_calls_per_hour?: number;
        granted_at: string;
      }>;
    };

    expect(detail.name).toBe("github.create_issue");
    expect(detail.grants.length).toBe(1);
    expect(detail.grants[0].identity_id).toBe(admin.identityId);
    expect(detail.grants[0].max_calls_per_hour).toBe(20);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Skeleton 5: Admin connects MCP server and discovers tools
  // US-UI-09 + US-UI-10 (MCP Server Connection + Tool Discovery)
  // ---------------------------------------------------------------------------
  it("admin connects an MCP server and imports discovered tools", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-skel5-${crypto.randomUUID()}`);

    // Given no MCP servers exist in the workspace
    // When admin registers an MCP server
    const addRes = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      transport: "streamable-http",
    });

    // Then the server is registered
    expect(addRes.status).toBe(201);
    const server = await addRes.json() as { id: string; name: string; last_status: string };
    expect(server.name).toBe("GitHub Tools");

    // When admin triggers discovery
    const discoverRes = await discoverTools(
      baseUrl, admin, admin.workspaceId, server.id, { dryRun: true },
    );

    // Then discovered tools are returned for review
    expect(discoverRes.status).toBe(200);
    const discovery = await discoverRes.json() as {
      tools: Array<{ name: string; action: string }>;
    };
    expect(discovery.tools.length).toBeGreaterThan(0);

    // When admin imports all discovered tools
    const syncRes = await syncServerTools(baseUrl, admin, admin.workspaceId, server.id);

    // Then tools appear in the workspace tool list
    expect(syncRes.status).toBe(200);
    const listRes = await listTools(baseUrl, admin, admin.workspaceId);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as {
      tools: Array<{ name: string }>;
    };
    expect(listBody.tools.length).toBeGreaterThan(0);
    const toolNames = listBody.tools.map((t) => t.name);
    expect(toolNames).toContain("github.create_issue");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Skeleton 6: Agent executes an injected integration tool end-to-end
  // US-UI-11 (Tool Execution via Proxy)
  //
  // This is the critical skeleton: without tool execution, injected tools
  // are non-functional. The proxy must connect to the upstream MCP server,
  // call tools/call, and return the result to the LLM.
  // ---------------------------------------------------------------------------
  it("agent executes an injected integration tool and receives the result", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-skel6-${crypto.randomUUID()}`);

    // Given an MCP server is registered
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });

    // And a discovered tool exists linked to the server
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      riskLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
      },
    });

    // And the agent has a can_use grant for the tool
    await seedGrant(surreal, agent.identityId, toolId);

    // Mock Anthropic: first response triggers tool_use, second returns text
    mockAnthropic.reset([
      {
        content: [{
          type: "tool_use",
          id: `toolu_skel6_${crypto.randomUUID().slice(0, 8)}`,
          name: "github.create_issue",
          input: { title: "Skeleton test issue" },
        }],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "I created the issue successfully." }],
        stopReason: "end_turn",
      },
    ]);

    // When the agent sends a proxy request
    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "Create a test issue on GitHub" }],
    });

    // Then the proxy returns the final text response
    expect(res.status).toBe(200);
    const body = await res.json() as { content: Array<{ type: string; text?: string }> };
    const textBlock = body.content?.find((c) => c.type === "text");
    expect(textBlock?.text).toContain("created the issue");
    // Anthropic was called twice: initial + follow-up with tool_result
    expect(mockAnthropic.callCount).toBe(2);
  }, 120_000);
});
