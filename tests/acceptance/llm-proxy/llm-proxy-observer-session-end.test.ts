/**
 * Acceptance Tests: Observer Session-End Analysis (ADR-048)
 *
 * Traces: Intelligence Capability — Observer Session Trace Analyzer
 * Driving port: SurrealDB EVENT on agent_session ended_at transition -> Observer webhook
 *
 * Validates that when an agent session ends, the Observer analyzes all traces
 * from that session for cross-trace patterns invisible to per-trace analysis
 * (approach drift, accumulated contradictions, decision evolution).
 *
 * Implementation sequence:
 * 1. Walking skeleton: approach drift detected across session traces
 * 2. Session with consistent traces — no observations created
 * 3. Session with single trace — no cross-trace patterns possible
 * 4. Session-end analysis failure — session still ends normally
 * 5. Accumulated contradiction across multiple traces
 *
 * All tests use it.skip() — capabilities not yet implemented.
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
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_observer_session_end");

// ---------------------------------------------------------------------------
// Walking Skeleton: Approach drift detected across session traces
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Observer detects approach drift across session traces", () => {
  it.skip("creates a cross-trace observation when early traces use one approach and later traces switch to another", async () => {
    const { surreal } = getRuntime();

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
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "I'll set up the tRPC router for the billing service following our standard patterns.",
      stopReason: "end_turn",
    });

    // Trace 2: Agent starts drifting (mentions REST as alternative)
    await seedLlmTraceWithContent(surreal, `trace-drift2-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "Actually, tRPC is causing complexity with the webhook handler. Let me consider a simpler REST approach for this endpoint.",
      stopReason: "end_turn",
    });

    // Trace 3: Agent has fully switched to REST (contradicts decision)
    await seedLlmTraceWithContent(surreal, `trace-drift3-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "I've implemented the billing webhook as a REST endpoint with Express. The route handler accepts POST /api/billing/webhooks.",
      stopReason: "end_turn",
    });

    // When the session ends
    await endAgentSession(surreal, sessionId);

    // Allow Observer session-end EVENT processing
    await new Promise(resolve => setTimeout(resolve, 10_000));

    // Then the Observer creates a cross-trace pattern observation
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });

    // Should have at least one cross-trace observation (approach drift)
    // Note: per-trace analysis may also create observations, but the session-end
    // analysis should detect the drift pattern specifically
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations.some(o => o.severity === "conflict")).toBe(true);
  }, 45_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Session with consistent traces — no cross-trace observations", () => {
  it.skip("creates no observations when all session traces follow confirmed decisions consistently", async () => {
    const { surreal } = getRuntime();

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
        model: "claude-sonnet-4-20250514",
        workspaceId,
        sessionId,
        responseText: `Implementing tRPC router ${i} with Zod validation following established patterns.`,
        stopReason: "end_turn",
      });
    }

    // When the session ends
    await endAgentSession(surreal, sessionId);

    await new Promise(resolve => setTimeout(resolve, 10_000));

    // Then no cross-trace contradiction observations are created
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 45_000);
});

describe("Session with single trace — no cross-trace patterns possible", () => {
  it.skip("does not run cross-trace analysis when session contains only one trace", async () => {
    const { surreal } = getRuntime();

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
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "Implemented a REST endpoint for the billing webhook.",
      stopReason: "end_turn",
    });

    // When the session ends
    await endAgentSession(surreal, sessionId);

    await new Promise(resolve => setTimeout(resolve, 10_000));

    // Then no cross-trace observations are created
    // (per-trace analysis may still create observations, but session-end
    // cross-trace analysis should not fire for single-trace sessions)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    // Filter for session-scoped observations specifically
    // Per-trace observations would be separate
    expect(observations.filter(o => o.text.includes("Cross-trace")).length).toBe(0);
  }, 45_000);
});

describe("Session-end analysis failure — session still ends normally", () => {
  it.skip("preserves the ended session state when Observer analysis encounters an error", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-sessend-fail-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();

    await createProxyTestWorkspace(surreal, workspaceId);
    // No intelligence config — may cause Observer analysis to encounter errors

    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // When the session ends (Observer analysis may fail but should not affect session state)
    await endAgentSession(surreal, sessionId);

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then the session is still properly ended
    const session = await getSessionById(surreal, sessionId);
    expect(session).toBeDefined();
    expect(session?.ended_at).toBeDefined();
  }, 30_000);
});

describe("Accumulated contradiction across multiple traces", () => {
  it.skip("detects contradictions that emerge from combined effect of individually-acceptable traces", async () => {
    const { surreal } = getRuntime();

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
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "For this quick fix, I'll add a small SQL query directly in the handler to check the user count. Just a one-off read.",
      stopReason: "end_turn",
    });

    await seedLlmTraceWithContent(surreal, `trace-accum2-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "The analytics endpoint needs a custom join that doesn't fit our repository pattern, so I'll write the SQL inline.",
      stopReason: "end_turn",
    });

    await seedLlmTraceWithContent(surreal, `trace-accum3-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "Added another direct query for the dashboard stats. The repository is too rigid for these aggregation queries.",
      stopReason: "end_turn",
    });

    // When the session ends
    await endAgentSession(surreal, sessionId);

    await new Promise(resolve => setTimeout(resolve, 10_000));

    // Then the Observer detects the accumulated pattern of bypassing the repository layer
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations.some(o => o.severity === "conflict")).toBe(true);
  }, 45_000);
});
