/**
 * Acceptance Tests: Observer Per-Trace Analysis (ADR-047, ADR-051)
 *
 * Traces: Intelligence Capability -- Observer Trace Response Analyzer
 * Driving port: POST /api/observe/trace/:id (Observer webhook)
 *
 * Validates that the Observer analyzes individual LLM call traces for:
 * - Contradictions with confirmed workspace decisions
 * - Unrecorded decisions (decision-shaped statements with no matching record)
 *
 * Tests call the observer route directly (same path the SurrealDB EVENT fires).
 * This avoids flaky EVENT timing while testing the full pipeline.
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyIntelligenceConfig,
  seedConfirmedDecision,
  seedLlmTraceWithContent,
  getObservationsForWorkspace,
  fetchRaw,
} from "./llm-proxy-test-kit";
import { testAI } from "../acceptance-test-kit";
import { createEmbeddingVector } from "../../../app/src/server/graph/embeddings";

const getRuntime = setupAcceptanceSuite("llm_proxy_observer_trace");

// ---------------------------------------------------------------------------
// Helper: call the observer trace route directly
// ---------------------------------------------------------------------------

async function triggerTraceObserver(
  baseUrl: string,
  traceId: string,
  traceBody: Record<string, unknown>,
): Promise<Response> {
  return fetchRaw(`${baseUrl}/api/observe/trace/${traceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(traceBody),
  });
}

// ---------------------------------------------------------------------------
// Helper: seed a decision with embedding for KNN search
// ---------------------------------------------------------------------------

async function seedDecisionWithEmbedding(
  surreal: ReturnType<typeof getRuntime>["surreal"],
  decisionId: string,
  workspaceId: string,
  summary: string,
  rationale?: string,
): Promise<string> {
  // Generate embedding for the decision summary
  const embedding = await createEmbeddingVector(
    testAI.embeddingModel,
    summary + (rationale ? ` ${rationale}` : ""),
    testAI.embeddingDimension,
  );

  return seedConfirmedDecision(surreal, decisionId, {
    workspaceId,
    summary,
    rationale,
    embedding: embedding ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Walking Skeleton: Contradiction detected between trace and confirmed decision
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Observer detects contradiction in LLM response", () => {
  it("creates a contradiction observation when trace content conflicts with a confirmed decision", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contradictionDetectionEnabled: true,
      contradictionTier1Threshold: 0.15,
    });

    // Given the workspace has a confirmed decision to use tRPC for internal APIs
    await seedDecisionWithEmbedding(
      surreal,
      `dec-trpc-${crypto.randomUUID()}`,
      workspaceId,
      "All internal API endpoints must use tRPC with Zod validation, REST endpoints are not allowed",
      "Type-safe contracts via tRPC, consistent patterns across all services, no Express or REST",
    );

    // When a trace is created where the agent implemented a REST endpoint instead of tRPC
    const traceId = `trace-contra-${crypto.randomUUID()}`;
    const responseText = "I'll create this internal API endpoint as a REST route using Express with manual JSON parsing instead of tRPC. Here's the Express route handler for the billing invoices endpoint.";

    await seedLlmTraceWithContent(surreal, traceId, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText,
      stopReason: "end_turn",
    });

    // Trigger observer directly (same path as SurrealDB EVENT)
    const traceBody = {
      type: "llm_call",
      stop_reason: "end_turn",
      output: { content: [{ type: "text", text: responseText }], stop_reason: "end_turn" },
      workspace: { id: workspaceId },
    };

    const response = await triggerTraceObserver(baseUrl, traceId, traceBody);
    expect(response.status).toBe(200);

    // Then the Observer creates a contradiction observation
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].severity).toBe("conflict");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Tool-use stop reason -- trace analysis skipped", () => {
  it("does not analyze traces with tool_use stop reason (intermediate loop steps)", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    const traceId = `trace-tooluse-${crypto.randomUUID()}`;

    await seedLlmTraceWithContent(surreal, traceId, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText: "Let me implement this REST endpoint...",
      stopReason: "tool_use",
    });

    // Trigger observer with tool_use stop_reason
    const traceBody = {
      type: "llm_call",
      stop_reason: "tool_use",
      output: {
        content: [{ type: "text", text: "Let me implement this REST endpoint..." }],
        stop_reason: "tool_use",
      },
      workspace: { id: workspaceId },
    };

    const response = await triggerTraceObserver(baseUrl, traceId, traceBody);
    expect(response.status).toBe(200);

    // Then no observations are created (tool_use traces are skipped)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 30_000);
});

describe("Observer analysis failure -- trace still exists, no observation created", () => {
  it("preserves the trace record when Observer analysis encounters an error (fail-skip)", async () => {
    const { surreal, baseUrl } = getRuntime();
    const { RecordId } = await import("surrealdb");

    const workspaceId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);
    // No intelligence config -- simulates config loading (disabled)

    const traceId = `trace-fail-${crypto.randomUUID()}`;

    await seedLlmTraceWithContent(surreal, traceId, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText: "Some response content that might contradict something",
      stopReason: "end_turn",
    });

    const traceBody = {
      type: "llm_call",
      stop_reason: "end_turn",
      output: { content: [{ type: "text", text: "Some response content" }], stop_reason: "end_turn" },
      workspace: { id: workspaceId },
    };

    // Observer should return 200 even when analysis is skipped/failed
    const response = await triggerTraceObserver(baseUrl, traceId, traceBody);
    expect(response.status).toBe(200);

    // Trace still exists in the graph
    const results = await surreal.query(
      `SELECT * FROM $trace;`,
      { trace: new RecordId("trace", traceId) },
    );
    const traces = (results[0] ?? []) as Array<{ id: unknown }>;
    expect(traces.length).toBe(1);

    // No observations created (analysis was skipped)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 30_000);
});

describe("Webhook handler returns 200 on analysis errors, 400 on malformed body", () => {
  it("returns 200 when observer processing fails gracefully", async () => {
    const { baseUrl } = getRuntime();

    // Call with a valid trace ID but a workspace that doesn't exist
    // The handler should catch the error and return 200
    const response = await triggerTraceObserver(
      baseUrl,
      `trace-nonexistent-${crypto.randomUUID()}`,
      { type: "llm_call", stop_reason: "end_turn", workspace: { id: "nonexistent" } },
    );
    expect(response.status).toBe(200);
  }, 15_000);
});

describe("Observations created with sourceAgent='observer_agent'", () => {
  it("sets source_agent to observer_agent on all created observations", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contradictionDetectionEnabled: true,
      contradictionTier1Threshold: 0.15,
    });

    await seedDecisionWithEmbedding(
      surreal,
      `dec-src-${crypto.randomUUID()}`,
      workspaceId,
      "All internal API endpoints must use tRPC with Zod validation, REST endpoints are not allowed",
      "Enforce type safety via tRPC across the entire system, no Express or REST",
    );

    const traceId = `trace-src-${crypto.randomUUID()}`;
    const responseText = "I created this internal API endpoint as a REST route using Express with manual JSON parsing instead of tRPC for the billing service.";

    await seedLlmTraceWithContent(surreal, traceId, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText,
      stopReason: "end_turn",
    });

    const traceBody = {
      type: "llm_call",
      stop_reason: "end_turn",
      output: { content: [{ type: "text", text: responseText }], stop_reason: "end_turn" },
      workspace: { id: workspaceId },
    };

    await triggerTraceObserver(baseUrl, traceId, traceBody);

    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });

    // Every observation must have source_agent = observer_agent
    for (const obs of observations) {
      expect(obs.source_agent).toBe("observer_agent");
    }
  }, 60_000);
});

describe("No contradiction when response aligns with decisions", () => {
  it("creates no contradiction observations when trace content is consistent with confirmed decisions", async () => {
    const { surreal, baseUrl } = getRuntime();

    const workspaceId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contradictionDetectionEnabled: true,
      contradictionTier1Threshold: 0.15,
    });

    await seedDecisionWithEmbedding(
      surreal,
      `dec-align-${crypto.randomUUID()}`,
      workspaceId,
      "All internal API endpoints must use tRPC with Zod validation, REST endpoints are not allowed",
      "Type-safe contracts via tRPC, consistent patterns across all services",
    );

    const traceId = `trace-align-${crypto.randomUUID()}`;
    const responseText = "I'll create the internal API endpoint using tRPC with createTRPCRouter and Zod input validation as required by the team's standards.";

    await seedLlmTraceWithContent(surreal, traceId, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText,
      stopReason: "end_turn",
    });

    const traceBody = {
      type: "llm_call",
      stop_reason: "end_turn",
      output: { content: [{ type: "text", text: responseText }], stop_reason: "end_turn" },
      workspace: { id: workspaceId },
    };

    const response = await triggerTraceObserver(baseUrl, traceId, traceBody);
    expect(response.status).toBe(200);

    // No contradiction observations
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 60_000);
});
