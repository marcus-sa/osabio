/**
 * Acceptance Tests: Observer Session-End Analysis (ADR-048)
 *
 * Traces: Intelligence Capability -- Observer Session Trace Analyzer
 * Driving port: POST /api/observe/agent_session/:id (Observer webhook)
 *
 * Validates that when an agent session ends, the Observer analyzes all traces
 * from that session for cross-trace patterns invisible to per-trace analysis
 * (approach drift, accumulated contradictions, decision evolution).
 *
 * Tests call the observer route directly (same path the SurrealDB EVENT fires)
 * to avoid flaky EVENT timing while testing the full pipeline.
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyIntelligenceConfig,
  seedConfirmedDecision,
  seedAgentSession,
  seedLlmTraceWithContent,
  endAgentSession,
  getObservationsForWorkspace,
  getSessionById,
  fetchRaw,
  TEST_PROXY_MODEL,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_observer_session_end");

// ---------------------------------------------------------------------------
// Helper: call the observer agent_session route directly
// ---------------------------------------------------------------------------

async function triggerSessionEndObserver(
  baseUrl: string,
  sessionId: string,
  sessionBody: Record<string, unknown>,
): Promise<Response> {
  return fetchRaw(`${baseUrl}/api/observe/agent_session/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionBody),
  });
}

// ---------------------------------------------------------------------------
// Walking Skeleton: Approach drift detected across session traces
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Observer detects approach drift across session traces", () => {
  it("creates a cross-trace observation when early traces use one approach and later traces switch to another", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = `ws-sessend-skel-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    // Given a confirmed decision to use tRPC
    await seedConfirmedDecision(surreal, `dec-drift-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Standardize on tRPC for all internal APIs",
    });

    // And an agent session with multiple traces showing approach drift
    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // Trace 1: Agent starts with tRPC (aligned)
    await seedLlmTraceWithContent(surreal, `trace-drift1-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      workspaceId,
      sessionId,
      responseText: "I'll set up the tRPC router for the billing service following our standard patterns.",
      stopReason: "end_turn",
    });

    // Trace 2: Agent starts drifting (mentions REST as alternative)
    await seedLlmTraceWithContent(surreal, `trace-drift2-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      workspaceId,
      sessionId,
      responseText: "Actually, tRPC is causing complexity with the webhook handler. Let me consider a simpler REST approach for this endpoint.",
      stopReason: "end_turn",
    });

    // Trace 3: Agent has fully switched to REST (contradicts decision)
    await seedLlmTraceWithContent(surreal, `trace-drift3-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      workspaceId,
      sessionId,
      responseText: "I've implemented the billing webhook as a REST endpoint with Express. The route handler accepts POST /api/billing/webhooks.",
      stopReason: "end_turn",
    });

    // When the session ends and observer is triggered
    await endAgentSession(surreal, sessionId);

    const response = await triggerSessionEndObserver(baseUrl, sessionId, {
      ended_at: new Date().toISOString(),
      workspace: { id: workspaceId },
    });
    expect(response.status).toBe(200);

    // Then the Observer creates a cross-trace pattern observation
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });

    // Should have at least one cross-trace observation (approach drift)
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations.some(o => o.severity === "conflict")).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Session with consistent traces -- no cross-trace observations", () => {
  it("creates no observations when all session traces follow confirmed decisions consistently", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = `ws-sessend-consistent-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    await seedConfirmedDecision(surreal, `dec-consistent-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Use tRPC for all internal APIs",
    });

    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // All traces consistently use tRPC
    for (let i = 0; i < 3; i++) {
      await seedLlmTraceWithContent(surreal, `trace-consistent-${crypto.randomUUID()}`, {
        model: TEST_PROXY_MODEL,
        workspaceId,
        sessionId,
        responseText: `Implementing tRPC router ${i} with Zod validation following established patterns.`,
        stopReason: "end_turn",
      });
    }

    // When the session ends and observer is triggered
    await endAgentSession(surreal, sessionId);

    const response = await triggerSessionEndObserver(baseUrl, sessionId, {
      ended_at: new Date().toISOString(),
      workspace: { id: workspaceId },
    });
    expect(response.status).toBe(200);

    // Then no cross-trace contradiction observations are created
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 60_000);
});

describe("Session with single trace -- no cross-trace patterns possible", () => {
  it("does not run cross-trace analysis when session contains only one trace", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = `ws-sessend-single-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // Only one trace in the session
    await seedLlmTraceWithContent(surreal, `trace-single-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      workspaceId,
      sessionId,
      responseText: "Implemented a REST endpoint for the billing webhook.",
      stopReason: "end_turn",
    });

    // When the session ends and observer is triggered
    await endAgentSession(surreal, sessionId);

    const response = await triggerSessionEndObserver(baseUrl, sessionId, {
      ended_at: new Date().toISOString(),
      workspace: { id: workspaceId },
    });
    expect(response.status).toBe(200);

    // Then no cross-trace observations are created
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 60_000);
});

describe("Session-end analysis failure -- session still ends normally", () => {
  it("preserves the ended session state when Observer analysis encounters an error", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = `ws-sessend-fail-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();

    await createProxyTestWorkspace(surreal, workspaceId);
    // No intelligence config -- may cause Observer analysis to encounter errors

    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // When the session ends
    await endAgentSession(surreal, sessionId);

    // Observer should return 200 even when analysis errors (fail-skip)
    const response = await triggerSessionEndObserver(baseUrl, sessionId, {
      ended_at: new Date().toISOString(),
      workspace: { id: workspaceId },
    });
    expect(response.status).toBe(200);

    // Then the session is still properly ended
    const session = await getSessionById(surreal, sessionId);
    expect(session).toBeDefined();
    expect(session?.ended_at).toBeDefined();
  }, 30_000);
});

describe("Accumulated contradiction across multiple traces", () => {
  it("detects contradictions that emerge from combined effect of individually-acceptable traces", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = `ws-sessend-accum-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    // Given a decision about data access patterns
    await seedConfirmedDecision(surreal, `dec-accum-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "All database access must go through the repository layer, no direct SQL queries in route handlers",
    });

    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // Individual traces look acceptable in isolation but combined they show
    // a pattern of bypassing the repository layer
    await seedLlmTraceWithContent(surreal, `trace-accum1-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      workspaceId,
      sessionId,
      responseText: "For this quick fix, I'll add a small SQL query directly in the handler to check the user count. Just a one-off read.",
      stopReason: "end_turn",
    });

    await seedLlmTraceWithContent(surreal, `trace-accum2-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      workspaceId,
      sessionId,
      responseText: "The analytics endpoint needs a custom join that doesn't fit our repository pattern, so I'll write the SQL inline.",
      stopReason: "end_turn",
    });

    await seedLlmTraceWithContent(surreal, `trace-accum3-${crypto.randomUUID()}`, {
      model: TEST_PROXY_MODEL,
      workspaceId,
      sessionId,
      responseText: "Added another direct query for the dashboard stats. The repository is too rigid for these aggregation queries.",
      stopReason: "end_turn",
    });

    // When the session ends and observer is triggered
    await endAgentSession(surreal, sessionId);

    const response = await triggerSessionEndObserver(baseUrl, sessionId, {
      ended_at: new Date().toISOString(),
      workspace: { id: workspaceId },
    });
    expect(response.status).toBe(200);

    // Then the Observer detects the accumulated pattern
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations.some(o => o.severity === "conflict")).toBe(true);
  }, 60_000);
});
