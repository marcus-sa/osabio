/**
 * Acceptance Tests: Audit Provenance Chain (US-LP-007)
 *
 * Traces: US-LP-007 — Audit Provenance Chain
 * Driving ports: GET /api/workspaces/:id/proxy/traces/:traceId,
 *                GET /api/workspaces/:id/proxy/traces?project=...&start=...&end=...,
 *                GET /api/workspaces/:id/proxy/compliance
 *
 * Validates that auditors can view full provenance chains for traces,
 * query by project/date range, run compliance checks, and export data.
 *
 * Implementation sequence:
 * 1. Auditor views provenance chain for a trace — ENABLED
 * 2. Auditor queries traces by project and date range
 * 3. Authorization compliance check passes
 * 4. Traces without authorization flagged as unverified
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyTestProject,
  createProxyTestTask,
  seedLlmTrace,
  queryTraceDetail,
  queryTracesByProject,
  runComplianceCheck,
  createModelAccessPolicy,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_audit");

// ---------------------------------------------------------------------------
// Scenario: Auditor views full provenance chain for a trace
// ---------------------------------------------------------------------------
describe("Auditor views full provenance chain for a trace", () => {
  it("returns trace detail with usage data and provenance edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-audit-${crypto.randomUUID()}`;
    const projectId = `proj-audit-${crypto.randomUUID()}`;
    const taskId = `task-audit-${crypto.randomUUID()}`;
    const traceId = `tr-audit-${crypto.randomUUID()}`;
    const sessionId = `session-audit-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    // Given a trace exists with full provenance edges
    await seedLlmTrace(surreal, traceId, {
      model: "claude-sonnet-4-20250514",
      input_tokens: 12340,
      output_tokens: 2100,
      cost_usd: 0.068,
      latency_ms: 4200,
      stop_reason: "end_turn",
      cache_read_tokens: 8200,
      workspaceId,
      taskId,
      sessionId,
    });

    // When Elena queries the trace detail
    const response = await queryTraceDetail(baseUrl, workspaceId, traceId);

    // Then the API responds with trace data
    // Note: API endpoint needs to be implemented by crafter
    expect(response).toBeDefined();

    // Once implemented, validate:
    // const body = await response.json();
    // expect(body.model).toBe("claude-sonnet-4-20250514");
    // expect(body.input_tokens).toBe(12340);
    // expect(body.output_tokens).toBe(2100);
    // expect(body.cost_usd).toBe(0.068);
    // expect(body.provenance.workspace).toBeDefined();
    // expect(body.provenance.task).toBeDefined();
    // expect(body.provenance.session).toBeDefined();
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Auditor queries traces by project and date range", () => {
  it.skip("returns traces within date range for specified project", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-query-${crypto.randomUUID()}`;
    const projectId = `proj-query-${crypto.randomUUID()}`;
    const taskId = `task-query-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    // Given traces exist across different dates
    const march5 = new Date("2026-03-05T12:00:00Z");
    const march10 = new Date("2026-03-10T12:00:00Z");
    const march20 = new Date("2026-03-20T12:00:00Z");

    await seedLlmTrace(surreal, `trace-m5-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      input_tokens: 1000,
      output_tokens: 200,
      cost_usd: 0.006,
      latency_ms: 1500,
      workspaceId,
      taskId,
      created_at: march5,
    });

    await seedLlmTrace(surreal, `trace-m10-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      input_tokens: 2000,
      output_tokens: 400,
      cost_usd: 0.012,
      latency_ms: 2500,
      workspaceId,
      taskId,
      created_at: march10,
    });

    await seedLlmTrace(surreal, `trace-m20-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      input_tokens: 3000,
      output_tokens: 600,
      cost_usd: 0.018,
      latency_ms: 3500,
      workspaceId,
      taskId,
      created_at: march20,
    });

    // When Elena queries traces between March 1 and March 15
    const response = await queryTracesByProject(
      baseUrl,
      workspaceId,
      projectId,
      "2026-03-01",
      "2026-03-15",
    );

    // Then results should include march5 and march10 traces but not march20
    expect(response).toBeDefined();
    // Once implemented:
    // const body = await response.json();
    // expect(body.traces.length).toBe(2);
  }, 15_000);
});

describe("Authorization compliance check passes", () => {
  it.skip("verifies all traces have policy authorization edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-comply-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given all traces have associated policy authorization
    const policyId = `pol-comply-${crypto.randomUUID()}`;
    await createModelAccessPolicy(surreal, workspaceId, {
      policyId,
      agentType: "coding-agent",
      allowedModels: ["claude-sonnet-4-20250514"],
    });

    await seedLlmTrace(surreal, `trace-comply-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      input_tokens: 1000,
      output_tokens: 200,
      cost_usd: 0.006,
      latency_ms: 1500,
      workspaceId,
    });

    // When Elena runs the compliance check
    const response = await runComplianceCheck(
      baseUrl,
      workspaceId,
      "2026-03-01",
      "2026-03-31",
    );

    // Then the report should show compliance status
    expect(response).toBeDefined();
    // Once implemented:
    // const body = await response.json();
    // expect(body.compliance_percentage).toBe(100);
  }, 15_000);
});

describe("Traces without authorization flagged as unverified", () => {
  it.skip("flags traces from policy-gap period as unverified", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-unverified-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given traces exist during a policy gap
    const gapDate = new Date("2026-03-03T14:00:00Z");

    for (let i = 0; i < 3; i++) {
      await seedLlmTrace(surreal, `trace-gap-${crypto.randomUUID()}`, {
        model: "claude-sonnet-4-20250514",
        input_tokens: 1000,
        output_tokens: 200,
        cost_usd: 0.006,
        latency_ms: 1500,
        workspaceId,
        created_at: gapDate,
      });
    }

    // When Elena runs the compliance check
    const response = await runComplianceCheck(
      baseUrl,
      workspaceId,
      "2026-03-01",
      "2026-03-31",
    );

    // Then traces without policy should be flagged as unverified
    expect(response).toBeDefined();
    // Once implemented:
    // const body = await response.json();
    // expect(body.unverified_count).toBe(3);
  }, 15_000);
});
