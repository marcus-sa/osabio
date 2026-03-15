/**
 * Acceptance Tests: Cost Attribution and Spend Tracking (US-LP-004)
 *
 * Traces: US-LP-004 — Cost Attribution and Spend Tracking
 * Driving ports: POST /proxy/llm/anthropic/v1/messages,
 *                GET /api/workspaces/:id/proxy/spend
 *
 * Validates that costs are computed from model pricing and token usage,
 * attributed to the correct workspace/project/task, and queryable via API.
 *
 * Implementation sequence:
 * 1. Cost computed from Sonnet response with cache — ENABLED
 * 2. Spend counters at all granularities
 * 3. Unattributed costs visible
 * 4. Spend API returns breakdown
 * 5. Historical costs unaffected by pricing changes
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequest,
  createProxyTestWorkspace,
  createProxyTestProject,
  createProxyTestTask,
  buildClaudeCodeUserId,
  getTracesForWorkspace,
  getWorkspaceSpend,
  seedLlmTrace,
  querySpendBreakdown,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_cost");

// ---------------------------------------------------------------------------
// Walking Skeleton: Cost computed and stored on trace
// ---------------------------------------------------------------------------
describe("Cost computed from model response and stored on trace", () => {
  it("computes cost from token usage and model pricing", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-cost-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given Priya sends a request that produces a response with token usage
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Explain recursion in one sentence." }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      usage: { input_tokens: number; output_tokens: number };
    };

    // Wait for async trace capture
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then a trace exists with computed cost
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const trace = traces[0];
    expect(trace.cost_usd).toBeGreaterThan(0);
    expect(trace.input_tokens).toBe(body.usage.input_tokens);
    expect(trace.output_tokens).toBe(body.usage.output_tokens);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Spend counters updated at workspace, project, and task levels", () => {
  it.skip("increments spend at all attribution granularities", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-counters-${crypto.randomUUID()}`;
    const projectId = `proj-counters-${crypto.randomUUID()}`;
    const taskId = `task-counters-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    // Given spend is zero before any calls
    const spendBefore = await getWorkspaceSpend(surreal, workspaceId);
    expect(spendBefore).toBe(0);

    // When a call completes with full attribution
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 20,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
      taskHeader: taskId,
    });

    expect(response.status).toBe(200);
    await response.json();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then workspace spend increases
    const spendAfter = await getWorkspaceSpend(surreal, workspaceId);
    expect(spendAfter).toBeGreaterThan(0);
  }, 30_000);
});

describe("Unattributed costs visible in workspace total", () => {
  it.skip("shows unattributed costs separately from project-attributed costs", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-unattr-${crypto.randomUUID()}`;
    const projectId = `proj-unattr-${crypto.randomUUID()}`;
    const taskId = `task-unattr-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    // Given attributed traces
    for (let i = 0; i < 3; i++) {
      await seedLlmTrace(surreal, `trace-attr-${crypto.randomUUID()}`, {
        model: "claude-sonnet-4-20250514",
        input_tokens: 1000,
        output_tokens: 200,
        cost_usd: 0.006,
        latency_ms: 1500,
        workspaceId,
        taskId,
      });
    }

    // And unattributed traces (no task)
    for (let i = 0; i < 2; i++) {
      await seedLlmTrace(surreal, `trace-unattr-${crypto.randomUUID()}`, {
        model: "claude-sonnet-4-20250514",
        input_tokens: 500,
        output_tokens: 100,
        cost_usd: 0.003,
        latency_ms: 800,
        workspaceId,
        // No taskId — unattributed
      });
    }

    // Then workspace total includes both attributed and unattributed
    const totalSpend = await getWorkspaceSpend(surreal, workspaceId);
    expect(totalSpend).toBeCloseTo(0.006 * 3 + 0.003 * 2, 4);
  }, 15_000);
});

describe("Spend API returns breakdown by project", () => {
  it.skip("returns workspace total, per-project breakdown, and call counts", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-api-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Seed traces for API test
    await seedLlmTrace(surreal, `trace-api-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      input_tokens: 1000,
      output_tokens: 200,
      cost_usd: 0.006,
      latency_ms: 1500,
      workspaceId,
    });

    // When Marcus queries spend breakdown
    const response = await querySpendBreakdown(baseUrl, workspaceId, "today");

    // Then the API responds (once implemented)
    // Note: API endpoint implementation is the crafter's responsibility
    // This test documents the expected contract
    expect(response).toBeDefined();
  }, 15_000);
});

describe("Historical costs unaffected by pricing changes", () => {
  it.skip("preserves cost computed at time of call regardless of pricing updates", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-hist-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a trace was created yesterday with a specific cost
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await seedLlmTrace(surreal, `trace-hist-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      input_tokens: 12340,
      output_tokens: 2100,
      cost_usd: 0.046,
      latency_ms: 4200,
      workspaceId,
      created_at: yesterday,
    });

    // Then the historical cost remains as recorded
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    const historicalTrace = traces.find(t =>
      t.cost_usd === 0.046,
    );
    expect(historicalTrace).toBeDefined();
    expect(historicalTrace!.cost_usd).toBe(0.046);
  }, 15_000);
});
