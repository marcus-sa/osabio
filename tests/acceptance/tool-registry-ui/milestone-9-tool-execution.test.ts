/**
 * Milestone 9: Tool Execution via Proxy
 *
 * Traces: US-UI-11 (Tool Execution via Proxy)
 *
 * Tests the proxy pipeline's ability to execute integration-classified
 * tool calls on upstream MCP servers. This is the most critical milestone:
 * without tool execution, injected tools are non-functional.
 *
 * Covers single tool execution, credential injection, multi-turn loop,
 * error handling (unreachable server, MCP errors), access denied,
 * and mixed brain-native + integration tool calls.
 *
 * NOTE: These tests require both a mock Anthropic API and a mock MCP server
 * injected via ServerDependencies. The mock MCP server uses InMemoryTransport
 * from @modelcontextprotocol/sdk. The mock Anthropic API returns configurable
 * tool_use/text responses.
 *
 * Driving ports:
 *   POST /proxy/v1/messages  (proxy entry point -- agent sends LLM request)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  seedMcpServer,
  seedDiscoveredTool,
  seedProvider,
  seedAccount,
  seedGrant,
  seedPolicy,
  seedGovernance,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_tool_execution");

// ---------------------------------------------------------------------------
// Happy Path: Single Tool Execution
// ---------------------------------------------------------------------------
describe("Proxy executes integration tool calls on upstream MCP server", () => {
  it.skip("executes a single integration tool call and returns result to LLM", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-exec-${crypto.randomUUID()}`);

    // Given an MCP server with a tool the agent can use
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
      },
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // When the LLM responds with tool_use for "github.create_issue"
    // Then the proxy connects to the upstream MCP server
    // And calls tools/call with the tool name and input
    // And returns the MCP server response as a tool_result
    // And resends to the LLM with the tool_result appended
    //
    // Full proxy round-trip verified during DELIVER with mock Anthropic + mock MCP server.
    expect(toolId).toBeTruthy();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Credential Injection
// ---------------------------------------------------------------------------
describe("Proxy injects credentials into MCP transport", () => {
  it.skip("injects API key credential from connected account into MCP transport headers", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-cred-${crypto.randomUUID()}`);

    // Given a provider with an API key
    const { providerId } = await seedProvider(surreal, agent.workspaceId, {
      name: "jira-api-key",
      displayName: "Jira API Key",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
    });

    // And an MCP server linked to the provider
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "Jira Tools",
      url: "https://mcp.test.local/jira",
      lastStatus: "ok",
      providerId,
    });

    // And the agent has a connected account with encrypted API key
    await seedAccount(surreal, {
      identityId: agent.identityId,
      providerId,
      workspaceId: agent.workspaceId,
      apiKeyEncrypted: "encrypted:test-jira-api-key",
    });

    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "jira.create_ticket",
      toolkit: "jira",
      providerId,
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // When proxy executes tool_use for "jira.create_ticket"
    // Then the proxy decrypts the API key from the connected account
    // And injects it as X-API-Key header on the MCP transport
    // And the MCP server receives the authenticated request
    //
    // Verified during DELIVER with mock MCP server asserting received headers.
    expect(toolId).toBeTruthy();
  }, 120_000);

  it.skip("injects bearer token credential into MCP transport headers", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-bearer-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, agent.workspaceId, {
      name: "monitoring-bearer",
      displayName: "Monitoring API",
      authMethod: "bearer",
    });

    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "Monitoring Tools",
      url: "https://mcp.test.local/monitoring",
      lastStatus: "ok",
      providerId,
    });

    await seedAccount(surreal, {
      identityId: agent.identityId,
      providerId,
      workspaceId: agent.workspaceId,
      bearerTokenEncrypted: "encrypted:test-bearer-token",
    });

    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "monitoring.get_metrics",
      toolkit: "monitoring",
      providerId,
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // When proxy executes tool_use for "monitoring.get_metrics"
    // Then the proxy injects the bearer token as Authorization: Bearer header
    expect(toolId).toBeTruthy();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Multi-Turn Loop
// ---------------------------------------------------------------------------
describe("Proxy handles multi-turn tool use loops", () => {
  it.skip("completes multi-turn loop: tool call -> result -> tool call -> result -> text", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-multi-${crypto.randomUUID()}`);

    // Given two tools the agent can use
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    const { toolId: t1 } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.list_issues",
      toolkit: "github",
    });
    const { toolId: t2 } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_comment",
      toolkit: "github",
    });
    await seedGrant(surreal, agent.identityId, t1);
    await seedGrant(surreal, agent.identityId, t2);

    // When the LLM first calls github.list_issues
    // And the proxy executes and returns the result
    // And the LLM then calls github.create_comment
    // And the proxy executes and returns the result
    // And the LLM produces a final text response
    // Then the proxy returns the final text response to the agent
    //
    // Verified during DELIVER with mock Anthropic returning sequential tool_use responses.
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
  }, 120_000);

  it.skip("stops after maximum 10 iterations to prevent infinite loops", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-max-${crypto.randomUUID()}`);

    // Given a tool that always triggers more tool calls
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "Loop Server",
      url: "https://mcp.test.local/loop",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "loop.infinite",
      toolkit: "loop",
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // When the LLM keeps calling the tool beyond 10 iterations
    // Then the proxy stops and returns the last response
    //
    // Verified during DELIVER with mock Anthropic always returning tool_use.
    expect(toolId).toBeTruthy();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Tool execution error handling", () => {
  it.skip("returns error tool_result when upstream MCP server is unreachable", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-unreach-${crypto.randomUUID()}`);

    // Given a tool whose server is unreachable
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "Dead Server",
      url: "https://mcp.unreachable.invalid/tools",
      lastStatus: "error",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "dead.some_tool",
      toolkit: "dead",
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // When the proxy tries to execute a tool call on the unreachable server
    // Then the proxy returns a tool_result with is_error: true
    // And the error content explains the server is unavailable
    // And the LLM can inform the user about the failure
    expect(toolId).toBeTruthy();
  }, 120_000);

  it.skip("returns error tool_result when MCP server returns an error response", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-mcperr-${crypto.randomUUID()}`);

    // Given a tool whose server returns errors for tools/call
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "Error Server",
      url: "https://mcp.test.local/error",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "error.fail_always",
      toolkit: "error",
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // When the proxy executes the tool call
    // Then the MCP error is forwarded as tool_result with is_error: true
    expect(toolId).toBeTruthy();
  }, 120_000);

  it.skip("rejects tool call when agent lacks can_use grant", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-noacc-${crypto.randomUUID()}`);

    // Given a tool exists but the agent has no can_use grant
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
    });
    // NOTE: no seedGrant call -- agent lacks access

    // When the LLM tries to call "github.create_issue"
    // Then the proxy does not inject the tool (tool not in resolved toolset)
    // And if the LLM hallucinates the tool call, it is classified as "unknown"
    // And returns a tool_result with is_error: true saying tool not registered
    expect(serverId).toBeTruthy();
  }, 120_000);

  it.skip("returns error tool_result when tool has no source_server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-nosrv-${crypto.randomUUID()}`);

    // Given a manually-created tool with no source_server
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, "nonexistent", {
      name: "manual.orphan_tool",
      toolkit: "manual",
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // When the proxy tries to execute the tool
    // Then it cannot resolve the source server
    // And returns a tool_result with is_error: true
    expect(toolId).toBeTruthy();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Governance Enforcement During Execution
// ---------------------------------------------------------------------------
describe("Tool governance is checked before execution", () => {
  it.skip("blocks tool execution when governance policy rejects the call", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-gov-${crypto.randomUUID()}`);

    // Given a tool with a restrictive governance policy
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.merge_pr",
      toolkit: "github",
      riskLevel: "high",
    });
    await seedGrant(surreal, agent.identityId, toolId);

    const { policyId } = await seedPolicy(surreal, agent.workspaceId, {
      title: "no-auto-merge",
      identityId: agent.identityId,
    });
    await seedGovernance(surreal, policyId, toolId, {
      conditions: "requires_human_approval",
      maxPerDay: 0,
    });

    // When the proxy executes the tool call
    // Then the governance policy blocks execution
    // And returns a tool_result with is_error: true indicating governance rejection
    expect(toolId).toBeTruthy();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Connection Lifecycle
// ---------------------------------------------------------------------------
describe("MCP connections are request-scoped", () => {
  it.skip("reuses connection for multiple tool calls to same server within one request", async () => {
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-reuse-${crypto.randomUUID()}`);

    // Given two tools on the same server
    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    const { toolId: t1 } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.list_issues",
      toolkit: "github",
    });
    const { toolId: t2 } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
    });
    await seedGrant(surreal, agent.identityId, t1);
    await seedGrant(surreal, agent.identityId, t2);

    // When the LLM calls both tools in a multi-turn loop
    // Then the proxy creates one MCP connection to "GitHub Tools"
    // And reuses it for the second tool call
    // And closes it when the proxy request completes
    //
    // Verified during DELIVER with mock MCP server tracking connection count.
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
  }, 120_000);
});
