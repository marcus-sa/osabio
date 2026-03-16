/**
 * Acceptance Tests: Spend Monitoring Dashboard (US-LP-006)
 *
 * Traces: US-LP-006 — Spend Monitoring Dashboard
 * Driving ports: GET /api/workspaces/:id/proxy/spend,
 *                GET /api/workspaces/:id/proxy/sessions
 *
 * Validates that the dashboard API returns spend breakdowns by workspace,
 * project, and session, with anomaly detection and budget alerts.
 *
 * Implementation sequence:
 * 1. Dashboard API returns workspace spend overview — ENABLED
 * 2. Per-project spend breakdown — ENABLED
 * 3. Per-session cost breakdown — ENABLED
 * 4. Anomaly detection for unusual call rate — ENABLED
 * 5. Budget threshold alert — ENABLED
 * 6. Unattributed costs visible — ENABLED
 * 7. Cache invalidation on trace creation — ENABLED
 * 8. Spend and session endpoints registered — ENABLED
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyTestProject,
  createProxyTestTask,
  seedLlmTrace,
  seedAgentSession,
  getObservationsForWorkspace,
  TEST_PROXY_MODEL,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_dashboard");

// ---------------------------------------------------------------------------
// Helper: query spend endpoint
// ---------------------------------------------------------------------------
async function fetchSpend(baseUrl: string, workspaceId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/proxy/spend`, {
    method: "GET",
  });
}

// ---------------------------------------------------------------------------
// Helper: query sessions endpoint
// ---------------------------------------------------------------------------
async function fetchSessions(baseUrl: string, workspaceId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${workspaceId}/proxy/sessions`, {
    method: "GET",
  });
}

// ---------------------------------------------------------------------------
// Scenario 1: Spend endpoint returns 200 with workspace overview
// ---------------------------------------------------------------------------
describe("Spend endpoint registered and returns workspace overview", () => {
  it("GET /api/workspaces/:wsId/proxy/spend returns 200 with total spend and budget", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-dash-overview-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId, { dailyBudget: 50.0 });

    // Seed traces with known costs
    for (let i = 0; i < 3; i++) {
      await seedLlmTrace(surreal, `trace-overview-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 2000,
        output_tokens: 500,
        cost_usd: 5.0,
        latency_ms: 2000,
        workspaceId,
      });
    }

    const response = await fetchSpend(baseUrl, workspaceId);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      total_spend: number;
      daily_budget: number;
      budget_progress_pct: number;
      projects: unknown[];
    };

    expect(body.total_spend).toBeCloseTo(15.0, 1);
    expect(body.daily_budget).toBe(50.0);
    expect(body.budget_progress_pct).toBeCloseTo(30.0, 0);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 2: Per-project breakdown sorted by today_spend DESC
// ---------------------------------------------------------------------------
describe("Spend response includes per-project breakdown", () => {
  it("returns per-project breakdown with today_spend, mtd_spend, call_count sorted by today_spend DESC", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-projbreak-${crypto.randomUUID()}`;
    const project1Id = `proj-high-${crypto.randomUUID()}`;
    const project2Id = `proj-low-${crypto.randomUUID()}`;
    const task1Id = `task-1-${crypto.randomUUID()}`;
    const task2Id = `task-2-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, project1Id, workspaceId);
    await createProxyTestProject(surreal, project2Id, workspaceId);
    await createProxyTestTask(surreal, task1Id, project1Id, workspaceId);
    await createProxyTestTask(surreal, task2Id, project2Id, workspaceId);

    // Project 1: higher spend (3 traces x $0.10)
    for (let i = 0; i < 3; i++) {
      await seedLlmTrace(surreal, `trace-p1-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 2000,
        output_tokens: 500,
        cost_usd: 0.10,
        latency_ms: 2000,
        workspaceId,
        taskId: task1Id,
      });
    }

    // Project 2: lower spend (2 traces x $0.02)
    for (let i = 0; i < 2; i++) {
      await seedLlmTrace(surreal, `trace-p2-${crypto.randomUUID()}`, {
        model: "claude-haiku-3.5",
        input_tokens: 500,
        output_tokens: 100,
        cost_usd: 0.02,
        latency_ms: 500,
        workspaceId,
        taskId: task2Id,
      });
    }

    const response = await fetchSpend(baseUrl, workspaceId);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      total_spend: number;
      projects: Array<{
        project_id: string;
        today_spend: number;
        mtd_spend: number;
        call_count: number;
      }>;
    };

    // Projects sorted by today_spend DESC
    expect(body.projects.length).toBeGreaterThanOrEqual(2);
    expect(body.projects[0].today_spend).toBeGreaterThanOrEqual(body.projects[1].today_spend);
    expect(body.projects[0].call_count).toBe(3);
    expect(body.projects[1].call_count).toBe(2);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 3: Per-session cost breakdown
// ---------------------------------------------------------------------------
describe("Session endpoint returns per-session cost breakdown", () => {
  it("GET /api/workspaces/:wsId/proxy/sessions returns sessions sorted by cost DESC", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sessions-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const session1 = `session-expensive-${crypto.randomUUID()}`;
    const session2 = `session-cheap-${crypto.randomUUID()}`;

    await seedAgentSession(surreal, session1, { workspaceId });
    await seedAgentSession(surreal, session2, { workspaceId });

    // Session 1: expensive (3 traces x $0.30)
    for (let i = 0; i < 3; i++) {
      await seedLlmTrace(surreal, `trace-s1-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 5000,
        output_tokens: 1000,
        cost_usd: 0.30,
        latency_ms: 3000,
        workspaceId,
        sessionId: session1,
      });
    }

    // Session 2: cheap (1 trace x $0.01)
    await seedLlmTrace(surreal, `trace-s2-${crypto.randomUUID()}`, {
      model: "claude-haiku-3.5",
      input_tokens: 500,
      output_tokens: 100,
      cost_usd: 0.01,
      latency_ms: 500,
      workspaceId,
      sessionId: session2,
    });

    const response = await fetchSessions(baseUrl, workspaceId);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      sessions: Array<{
        session_id: string;
        total_cost: number;
        primary_model: string;
        call_count: number;
        duration_ms: number;
      }>;
    };

    // Sorted by cost DESC
    expect(body.sessions.length).toBe(2);
    expect(body.sessions[0].total_cost).toBeGreaterThan(body.sessions[1].total_cost);
    expect(body.sessions[0].call_count).toBe(3);
    expect(body.sessions[0].primary_model).toBe(TEST_PROXY_MODEL);
    expect(body.sessions[1].call_count).toBe(1);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 4: Anomaly observation for sessions exceeding 2x average call rate
// ---------------------------------------------------------------------------
describe("Anomaly detection for sessions exceeding 2x average call rate", () => {
  it("creates an observation when a session has 2x+ the average call count", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-anomaly-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const normalSession1 = `session-normal1-${crypto.randomUUID()}`;
    const normalSession2 = `session-normal2-${crypto.randomUUID()}`;
    const anomalySession = `session-anomaly-${crypto.randomUUID()}`;

    await seedAgentSession(surreal, normalSession1, { workspaceId });
    await seedAgentSession(surreal, normalSession2, { workspaceId });
    await seedAgentSession(surreal, anomalySession, { workspaceId });

    // Normal sessions: 5 calls each
    for (const sid of [normalSession1, normalSession2]) {
      for (let i = 0; i < 5; i++) {
        await seedLlmTrace(surreal, `trace-normal-${crypto.randomUUID()}`, {
          model: TEST_PROXY_MODEL,
          input_tokens: 2000,
          output_tokens: 500,
          cost_usd: 0.01,
          latency_ms: 1000,
          workspaceId,
          sessionId: sid,
        });
      }
    }

    // Anomaly session: 25 calls (well above 2x average threshold)
    for (let i = 0; i < 25; i++) {
      await seedLlmTrace(surreal, `trace-anomaly-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 2000,
        output_tokens: 500,
        cost_usd: 0.01,
        latency_ms: 1000,
        workspaceId,
        sessionId: anomalySession,
      });
    }

    // Trigger anomaly detection via spend endpoint
    const spendResponse = await fetchSpend(baseUrl, workspaceId);
    expect(spendResponse.status).toBe(200);

    // Wait for async observation creation (anomaly detection runs in background)
    await new Promise(resolve => setTimeout(resolve, 3000));

    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "llm-proxy",
    });
    const anomalyObs = observations.filter(
      (o) => (o as unknown as { data?: { subtype?: string } }).data?.subtype === "proxy_anomaly_call_rate",
    );

    expect(anomalyObs.length).toBeGreaterThanOrEqual(1);
    expect(anomalyObs[0].severity).toBe("warning");
    expect(anomalyObs[0].source_agent).toBe("llm-proxy");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 5: Budget threshold alert at configured percentage
// ---------------------------------------------------------------------------
describe("Budget threshold alert fires at configured percentage", () => {
  it("creates budget alert observation when daily spend reaches 80% of budget", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-threshold-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId, {
      dailyBudget: 10.0,
    });

    // Seed $8.50 of spend (85% of $10 budget, above 80% default threshold)
    for (let i = 0; i < 17; i++) {
      await seedLlmTrace(surreal, `trace-thresh-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 2000,
        output_tokens: 500,
        cost_usd: 0.50,
        latency_ms: 1000,
        workspaceId,
      });
    }

    // Trigger budget check via spend endpoint
    const spendResponse = await fetchSpend(baseUrl, workspaceId);
    expect(spendResponse.status).toBe(200);

    // Wait for async observation creation
    await new Promise(resolve => setTimeout(resolve, 1000));

    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "llm-proxy",
    });
    const budgetObs = observations.filter(
      (o) => (o as unknown as { data?: { subtype?: string } }).data?.subtype === "proxy_budget_threshold",
    );

    expect(budgetObs.length).toBeGreaterThanOrEqual(1);
    expect(budgetObs[0].severity).toBe("warning");
    expect(budgetObs[0].source_agent).toBe("llm-proxy");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 6: Unattributed costs visible as separate category
// ---------------------------------------------------------------------------
describe("Unattributed costs visible as separate category in project breakdown", () => {
  it("shows unattributed costs when traces lack task/project attribution", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-unattr-${crypto.randomUUID()}`;
    const projectId = `proj-attr-${crypto.randomUUID()}`;
    const taskId = `task-attr-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    // Attributed traces
    for (let i = 0; i < 2; i++) {
      await seedLlmTrace(surreal, `trace-attr-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 1000,
        output_tokens: 200,
        cost_usd: 0.05,
        latency_ms: 1500,
        workspaceId,
        taskId,
      });
    }

    // Unattributed traces (no task)
    for (let i = 0; i < 3; i++) {
      await seedLlmTrace(surreal, `trace-unattr-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 500,
        output_tokens: 100,
        cost_usd: 0.03,
        latency_ms: 800,
        workspaceId,
      });
    }

    const response = await fetchSpend(baseUrl, workspaceId);
    expect(response.status).toBe(200);

    const body = await response.json() as {
      total_spend: number;
      projects: Array<{
        project_id: string;
        today_spend: number;
      }>;
    };

    // Total should include both
    expect(body.total_spend).toBeCloseTo(0.05 * 2 + 0.03 * 3, 2);

    // Should have an "unattributed" entry
    const unattributed = body.projects.find(p => p.project_id === "unattributed");
    expect(unattributed).toBeDefined();
    expect(unattributed!.today_spend).toBeCloseTo(0.09, 2);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 7: Spend queries respond within 2 seconds
// ---------------------------------------------------------------------------
describe("All spend queries respond within 2 seconds", () => {
  it("spend endpoint responds in under 2s even with data", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-perf-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Seed some traces
    for (let i = 0; i < 10; i++) {
      await seedLlmTrace(surreal, `trace-perf-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        input_tokens: 1000,
        output_tokens: 200,
        cost_usd: 0.01,
        latency_ms: 500,
        workspaceId,
      });
    }

    const start = performance.now();
    const response = await fetchSpend(baseUrl, workspaceId);
    const elapsed = performance.now() - start;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  }, 15_000);
});
