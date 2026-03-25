/**
 * Acceptance Tests: Brain-Native Tools in MCP Agent Endpoint
 *
 * Verifies that Brain-native tools (search, list, create, etc.) are exposed
 * directly in the /mcp/agent/:sessionId endpoint. Read tools are always
 * available. Write tools are gated behind intent authorization.
 *
 * Driving ports:
 *   POST /mcp/agent/:sessionId (tools/list, tools/call, create_intent)
 *
 * Auth: X-Brain-Auth proxy token
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import {
  createWorkspaceDirectly,
  createAgentSessionDirectly,
  createIntentDirectly,
  createGatesEdge,
  seedProxyToken,
  createTaskDirectly,
} from "../shared-fixtures";
import { BRAIN_READ_TOOL_NAMES, BRAIN_WRITE_TOOL_NAMES } from "../../../app/src/server/mcp/brain-tool-definitions";

// ── Types ──

type ToolsListResult = {
  jsonrpc: string;
  id: string | number;
  result?: { tools: Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }> };
  error?: { code: number; message: string; data?: unknown };
};

type ToolsCallResult = {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

// ── Suite Setup ──

const getRuntime = setupAcceptanceSuite("agent_mcp_brain_tools", {
  configOverrides: {
    sandboxAgentEnabled: true,
    sandboxAgentType: "claude",
    orchestratorMockAgent: true,
  },
});

// ── Test Helpers ──

function mcpRequest(
  baseUrl: string,
  sessionId: string,
  proxyToken: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/mcp/agent/${sessionId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Brain-Auth": proxyToken,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: params ?? {},
    }),
  });
}

async function setupSessionContext(surreal: ReturnType<typeof getRuntime>["surreal"], suffix: string) {
  const ws = await createWorkspaceDirectly(surreal, `brain_tools_${suffix}`);
  const session = await createAgentSessionDirectly(surreal, ws.workspaceId);
  const proxyToken = await seedProxyToken(
    surreal, ws.identityId, ws.workspaceId, { sessionId: session.sessionId },
  );
  return { ...ws, ...session, proxyToken };
}

// ── Tests ──

describe("Brain-Native Tools in MCP Agent Endpoint", () => {

  // ── tools/list ──

  it("tools/list includes all brain read tools without any intent", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    const response = await mcpRequest(baseUrl, ctx.sessionId, ctx.proxyToken, "tools/list");
    expect(response.ok).toBe(true);

    const body = (await response.json()) as ToolsListResult;
    const toolNames = body.result!.tools.map((t) => t.name);

    // All read tools present
    for (const name of BRAIN_READ_TOOL_NAMES) {
      expect(toolNames).toContain(name);
    }

    // Infrastructure tools present
    expect(toolNames).toContain("get_context");
    expect(toolNames).toContain("create_intent");
  }, 15_000);

  it("tools/list shows write tools with [GATED] prefix when no intent exists", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    const response = await mcpRequest(baseUrl, ctx.sessionId, ctx.proxyToken, "tools/list");
    const body = (await response.json()) as ToolsListResult;
    const tools = body.result!.tools;

    for (const name of BRAIN_WRITE_TOOL_NAMES) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("[GATED]");
      expect(tool!.description).toContain('provider="brain"');
    }
  }, 15_000);

  it("tools/list shows write tool without [GATED] prefix after intent authorization", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    // Authorize create_observation via intent
    const intent = await createIntentDirectly(surreal, ctx.workspaceId, ctx.identityId, {
      goal: "Create observations during code review",
      status: "authorized",
      actionSpec: { provider: "brain", action: "create_observation", params: {} },
      evaluation: {
        decision: "APPROVE", risk_score: 5, reason: "Brain-native write",
        evaluated_at: new Date(), policy_only: true,
      },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "brain_action", action: "execute", resource: "mcp_tool:brain:create_observation" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, ctx.sessionId);

    const response = await mcpRequest(baseUrl, ctx.sessionId, ctx.proxyToken, "tools/list");
    const body = (await response.json()) as ToolsListResult;
    const tool = body.result!.tools.find((t) => t.name === "create_observation");

    expect(tool).toBeDefined();
    expect(tool!.description).not.toContain("[GATED]");
  }, 15_000);

  // ── Read tool execution ──

  it("search_entities executes successfully without intent", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    // Seed a task to search for
    await createTaskDirectly(surreal, ctx.workspaceId, {
      title: "Implement OAuth 2.1 authentication flow",
      status: "open",
    });

    const response = await mcpRequest(
      baseUrl, ctx.sessionId, ctx.proxyToken, "tools/call",
      { name: "search_entities", arguments: { query: "OAuth authentication", limit: 5 } },
    );

    expect(response.ok).toBe(true);
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
  }, 15_000);

  it("list_workspace_entities lists tasks without intent", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    await createTaskDirectly(surreal, ctx.workspaceId, {
      title: "Setup CI pipeline",
      status: "open",
    });

    const response = await mcpRequest(
      baseUrl, ctx.sessionId, ctx.proxyToken, "tools/call",
      { name: "list_workspace_entities", arguments: { kind: "task" } },
    );

    expect(response.ok).toBe(true);
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeUndefined();
    const result = body.result as { kind: string; count: number; entities: unknown[] };
    expect(result.kind).toBe("task");
    expect(result.count).toBeGreaterThanOrEqual(1);
  }, 15_000);

  it("check_constraints executes without intent", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    const response = await mcpRequest(
      baseUrl, ctx.sessionId, ctx.proxyToken, "tools/call",
      { name: "check_constraints", arguments: { proposed_action: "Migrate to PostgreSQL" } },
    );

    expect(response.ok).toBe(true);
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeUndefined();
    const result = body.result as { proceed: boolean };
    expect(result.proceed).toBe(true); // No constraints to conflict with
  }, 15_000);

  // ── Write tool gating ──

  it("create_observation returns intent_required when no intent", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    const response = await mcpRequest(
      baseUrl, ctx.sessionId, ctx.proxyToken, "tools/call",
      { name: "create_observation", arguments: { text: "Found a bug", severity: "warning" } },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeDefined();
    expect(body.error!.message).toBe("intent_required");
    expect(body.error!.data).toBeDefined();
    const data = body.error!.data as { tool: string; action_spec_template: { provider: string } };
    expect(data.tool).toBe("create_observation");
    expect(data.action_spec_template.provider).toBe("brain");
  }, 15_000);

  it("create_observation succeeds after intent authorization", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    // Authorize create_observation
    const intent = await createIntentDirectly(surreal, ctx.workspaceId, ctx.identityId, {
      goal: "Log observations during review",
      status: "authorized",
      actionSpec: { provider: "brain", action: "create_observation", params: {} },
      evaluation: {
        decision: "APPROVE", risk_score: 5, reason: "Brain-native write",
        evaluated_at: new Date(), policy_only: true,
      },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "brain_action", action: "execute", resource: "mcp_tool:brain:create_observation" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, ctx.sessionId);

    // Now call the gated tool
    const response = await mcpRequest(
      baseUrl, ctx.sessionId, ctx.proxyToken, "tools/call",
      { name: "create_observation", arguments: { text: "Found a potential race condition", severity: "warning" } },
    );

    expect(response.ok).toBe(true);
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeUndefined();
    const result = body.result as { observation_id: string; severity: string; status: string };
    expect(result.observation_id).toMatch(/^observation:/);
    expect(result.severity).toBe("warning");
    expect(result.status).toBe("open");
  }, 15_000);

  it("create_work_item (task) succeeds after intent authorization", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ctx = await setupSessionContext(surreal, crypto.randomUUID().slice(0, 8));

    // Authorize create_work_item
    const intent = await createIntentDirectly(surreal, ctx.workspaceId, ctx.identityId, {
      goal: "Create tasks for implementation",
      status: "authorized",
      actionSpec: { provider: "brain", action: "create_work_item", params: {} },
      evaluation: {
        decision: "APPROVE", risk_score: 10, reason: "Brain-native write",
        evaluated_at: new Date(), policy_only: true,
      },
    });
    await surreal.query(
      `UPDATE $intent SET authorization_details = $details;`,
      {
        intent: intent.intentRecord,
        details: [{ type: "brain_action", action: "execute", resource: "mcp_tool:brain:create_work_item" }],
      },
    );
    await createGatesEdge(surreal, intent.intentId, ctx.sessionId);

    const response = await mcpRequest(
      baseUrl, ctx.sessionId, ctx.proxyToken, "tools/call",
      {
        name: "create_work_item",
        arguments: { kind: "task", title: "Add input validation", rationale: "Prevent injection attacks" },
      },
    );

    expect(response.ok).toBe(true);
    const body = (await response.json()) as ToolsCallResult;
    expect(body.error).toBeUndefined();
    const result = body.result as { entity_id: string; kind: string; title: string };
    expect(result.entity_id).toMatch(/^task:/);
    expect(result.kind).toBe("task");
    expect(result.title).toBe("Add input validation");
  }, 15_000);
});
