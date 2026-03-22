/**
 * Walking Skeleton: Tool Registry UI End-to-End
 *
 * Traces: US-UI-01, US-UI-02, US-UI-03, US-UI-04, US-UI-05
 *
 * Thinnest E2E slice proving observable user value:
 *   Admin registers a provider -> Member connects account ->
 *   Admin seeds tools -> Admin grants access -> Both browse tools
 *
 * This skeleton answers: "Can workspace users manage integrations
 * and see their tools, providers, accounts, and grants?"
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/providers         (register provider)
 *   GET  /api/workspaces/:wsId/providers          (list providers)
 *   POST /api/workspaces/:wsId/accounts/connect/  (connect account)
 *   GET  /api/workspaces/:wsId/accounts            (list accounts)
 *   GET  /api/workspaces/:wsId/tools               (list tools)
 *   GET  /api/workspaces/:wsId/tools/:toolId       (tool detail)
 *   POST /api/workspaces/:wsId/tools/:toolId/grants (grant access)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  createProvider,
  listProviders,
  connectAccount,
  listAccounts,
  listTools,
  getToolDetail,
  grantToolAccess,
  seedTool,
  seedProvider,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_walking_skeleton");

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
});
