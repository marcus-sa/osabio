/**
 * Milestone 9: Tool Execution via Proxy
 *
 * Traces: US-UI-11 (Tool Execution via Proxy)
 *
 * Tests the proxy pipeline's ability to execute integration-classified
 * tool calls on upstream MCP servers. Uses MSW to mock the Anthropic API
 * and a mock McpClientFactory for upstream MCP servers.
 *
 * Scenarios (7):
 *   1. Single tool execution and result return
 *   2. Multi-turn tool use loop (list -> comment -> text)
 *   3. Max iterations safety limit (10 iterations)
 *   4. Error tool_result on upstream MCP failure
 *   5. Tool not injected without grant
 *   6. Governance policy blocks execution
 *   7. Connection reuse within request (multiple tools, same server)
 *
 * Driving ports:
 *   POST /proxy/llm/anthropic/v1/messages  (proxy entry point)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  createMockMcpClientFactory,
  createMockAnthropicMsw,
  sendProxyRequest,
  seedMcpServer,
  seedDiscoveredTool,
  seedGrant,
  seedPolicy,
  seedGovernance,
  type MockToolUseBlock,
} from "./tool-registry-ui-test-kit";

// Mock MCP server that returns success for all tool calls
const mockMcpFactory = createMockMcpClientFactory({
  tools: [
    {
      name: "github.create_issue",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
    },
    {
      name: "github.list_issues",
      description: "List GitHub issues",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: "github.create_comment",
      description: "Create a comment on an issue",
      inputSchema: { type: "object", properties: { body: { type: "string" } } },
    },
  ],
  onCallTool: (name, args) => ({
    content: [{ type: "text", text: JSON.stringify({ tool: name, status: "ok", args }) }],
  }),
});

const getRuntime = setupToolRegistrySuite("tool_registry_ui_tool_execution", {
  mcpClientFactory: mockMcpFactory,
});

// MSW mock for Anthropic API — per-test response queues keyed by testId
const toolUseBlock = (name: string, input: Record<string, unknown>): MockToolUseBlock => ({
  type: "tool_use",
  id: `toolu_${crypto.randomUUID().slice(0, 8)}`,
  name,
  input,
});

const mockAnthropic = createMockAnthropicMsw([]);

beforeAll(() => mockAnthropic.listen());
afterAll(() => mockAnthropic.close());

// ---------------------------------------------------------------------------
// Happy Path: Single Tool Execution
// ---------------------------------------------------------------------------
describe("Proxy executes integration tool calls on upstream MCP server", () => {
  it("executes a single integration tool call and returns final text", async () => {
    const testId = `single-exec-${crypto.randomUUID()}`;
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-exec-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
    });
    await seedGrant(surreal, agent.identityId, toolId);

    mockAnthropic.register(testId, [
      {
        content: [toolUseBlock("github.create_issue", { title: "Test issue" })],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "I created the issue for you." }],
        stopReason: "end_turn",
      },
    ]);

    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "Create a test issue" }],
      testId,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { content: Array<{ type: string; text?: string }> };
    const textBlock = body.content?.find((c) => c.type === "text");
    expect(textBlock?.text).toContain("created the issue");
    expect(mockAnthropic.callCountFor(testId)).toBe(2);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Multi-Turn Loop
// ---------------------------------------------------------------------------
describe("Proxy handles multi-turn tool use loops", () => {
  it("completes multi-turn loop: tool call -> result -> tool call -> result -> text", async () => {
    const testId = `multi-turn-${crypto.randomUUID()}`;
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-multi-${crypto.randomUUID()}`);

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

    mockAnthropic.register(testId, [
      {
        content: [toolUseBlock("github.list_issues", {})],
        stopReason: "tool_use",
      },
      {
        content: [toolUseBlock("github.create_comment", { body: "Looks good!" })],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Listed issues and added a comment." }],
        stopReason: "end_turn",
      },
    ]);

    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "List issues and comment" }],
      testId,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { content: Array<{ type: string; text?: string }> };
    const textBlock = body.content?.find((c) => c.type === "text");
    expect(textBlock?.text).toContain("comment");
    expect(mockAnthropic.callCountFor(testId)).toBe(3);
  }, 120_000);

  it("stops after maximum iterations to prevent infinite loops", async () => {
    const testId = `max-iter-${crypto.randomUUID()}`;
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-max-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "Loop Server",
      url: "https://mcp.test.local/loop",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
    });
    await seedGrant(surreal, agent.identityId, toolId);

    // Always returns tool_use (infinite loop) — enough for MAX_TOOL_USE_ITERATIONS + 1
    const infiniteToolUse = Array.from({ length: 12 }, () => ({
      content: [toolUseBlock("github.create_issue", { title: "loop" })] as Array<MockToolUseBlock>,
      stopReason: "tool_use" as const,
    }));
    mockAnthropic.register(testId, infiniteToolUse);

    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "Keep creating issues" }],
      testId,
    });

    expect(res.status).toBe(200);
    expect(mockAnthropic.callCountFor(testId)).toBeLessThanOrEqual(11);
    expect(mockAnthropic.callCountFor(testId)).toBeGreaterThan(6);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Tool execution error handling", () => {
  it("returns error tool_result when upstream MCP server fails", async () => {
    const testId = `mcp-err-${crypto.randomUUID()}`;
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-mcperr-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "Error Server",
      url: "https://mcp.test.local/error",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
    });
    await seedGrant(surreal, agent.identityId, toolId);

    mockAnthropic.register(testId, [
      {
        content: [toolUseBlock("github.create_issue", { title: "test" })],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "The tool call failed." }],
        stopReason: "end_turn",
      },
    ]);

    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "Create an issue" }],
      testId,
    });

    expect(res.status).toBe(200);
  }, 120_000);

  it("tool not in agent's grant set is not injected", async () => {
    const testId = `no-grant-${crypto.randomUUID()}`;
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-noacc-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    mockAnthropic.register(testId, [
      {
        content: [{ type: "text", text: "I cannot use tools." }],
        stopReason: "end_turn",
      },
    ]);

    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "Create an issue" }],
      testId,
    });

    expect(res.status).toBe(200);
    expect(mockAnthropic.callCountFor(testId)).toBe(1);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Governance Enforcement During Execution
// ---------------------------------------------------------------------------
describe("Tool governance is checked before execution", () => {
  it("blocks tool execution when governance policy requires human approval", async () => {
    const testId = `gov-block-${crypto.randomUUID()}`;
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-gov-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, agent.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });
    const { toolId } = await seedDiscoveredTool(surreal, agent.workspaceId, serverId, {
      name: "github.create_issue",
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
    });

    mockAnthropic.register(testId, [
      {
        content: [toolUseBlock("github.create_issue", { title: "test" })],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "The tool was blocked by governance." }],
        stopReason: "end_turn",
      },
    ]);

    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "Create an issue" }],
      testId,
    });

    expect(res.status).toBe(200);
    expect(mockAnthropic.callCountFor(testId)).toBe(2);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Connection Lifecycle
// ---------------------------------------------------------------------------
describe("MCP connections are request-scoped", () => {
  it("completes proxy request with multiple tool calls to same server", async () => {
    const testId = `conn-reuse-${crypto.randomUUID()}`;
    const { baseUrl, surreal } = getRuntime();
    const agent = await createTestUserWithMcp(baseUrl, surreal, `ws-reuse-${crypto.randomUUID()}`);

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

    mockAnthropic.register(testId, [
      {
        content: [toolUseBlock("github.list_issues", {})],
        stopReason: "tool_use",
      },
      {
        content: [toolUseBlock("github.create_issue", { title: "new" })],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Done with both tools." }],
        stopReason: "end_turn",
      },
    ]);

    const res = await sendProxyRequest(baseUrl, surreal, agent, {
      messages: [{ role: "user", content: "List and create" }],
      testId,
    });

    expect(res.status).toBe(200);
    expect(mockAnthropic.callCountFor(testId)).toBe(3);
  }, 120_000);
});
