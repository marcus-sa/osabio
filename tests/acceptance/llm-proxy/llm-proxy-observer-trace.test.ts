/**
 * Acceptance Tests: Observer Per-Trace Analysis (ADR-047, ADR-051)
 *
 * Traces: Intelligence Capability — Observer Trace Response Analyzer
 * Driving port: SurrealDB EVENT on trace creation -> Observer webhook
 *
 * Validates that the Observer analyzes individual LLM call traces for:
 * - Contradictions with confirmed workspace decisions
 * - Unrecorded decisions (decision-shaped statements with no matching record)
 *
 * The proxy creates traces; the Observer analyzes them via SurrealDB EVENT triggers.
 * These tests seed traces directly and verify Observer behavior.
 *
 * Implementation sequence:
 * 1. Walking skeleton: contradiction detected between trace response and confirmed decision
 * 2. Missing decision detected from trace containing unrecorded approach choice
 * 3. Tool-use stop reason — trace analysis skipped
 * 4. No contradiction when response aligns with decisions
 * 5. Observer analysis failure — trace still exists, no observation created
 * 6. Multiple contradictions detected in single trace
 * 7. Low-confidence contradiction discarded by Tier 2 verification
 *
 * All tests use it.skip() — capabilities not yet implemented.
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyIntelligenceConfig,
  seedConfirmedDecision,
  seedLlmTraceWithContent,
  seedAgentSession,
  getObservationsForWorkspace,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_observer_trace");

// ---------------------------------------------------------------------------
// Walking Skeleton: Contradiction detected between trace and confirmed decision
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Observer detects contradiction in LLM response", () => {
  it.skip("creates a contradiction observation when trace content conflicts with a confirmed decision", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-obs-skel-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contradictionDetectionEnabled: true,
    });

    // Given the workspace has a confirmed decision to use tRPC
    await seedConfirmedDecision(surreal, `dec-trpc-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Standardize on tRPC for all internal APIs",
      rationale: "Type-safe contracts, consistent patterns across services",
    });

    // And a session exists for the agent
    const sessionId = crypto.randomUUID();
    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // When a trace is created where the agent implemented a REST endpoint
    // (contradicting the tRPC decision)
    await seedLlmTraceWithContent(surreal, `trace-contra-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "I'll implement this as a REST endpoint using Express. Here's the route handler with GET /api/billing/invoices that returns JSON.",
      stopReason: "end_turn",
    });

    // Allow Observer EVENT processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then the Observer creates a contradiction observation
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].severity).toBe("conflict");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Missing decision detected from unrecorded approach choice", () => {
  it.skip("creates an unrecorded-decision observation when trace contains a decision-shaped statement with no matching record", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-obs-missing-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    // Given the workspace has NO decisions about caching strategy
    // (no decisions at all in this workspace)

    const sessionId = crypto.randomUUID();
    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
    });

    // When a trace contains an architectural decision about using Redis
    await seedLlmTraceWithContent(surreal, `trace-missing-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      sessionId,
      responseText: "I've decided to use Redis for the caching layer instead of Memcached because Redis supports data structures we need for session management. This is the right approach for our use case.",
      stopReason: "end_turn",
    });

    // Allow Observer EVENT processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then the Observer creates a missing-decision observation
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "validation",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].severity).toBe("info");
    expect(observations[0].text).toContain("Redis");
  }, 30_000);
});

describe("Tool-use stop reason — trace analysis skipped", () => {
  it.skip("does not analyze traces with tool_use stop reason (intermediate loop steps)", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-obs-tooluse-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    await seedConfirmedDecision(surreal, `dec-tooluse-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Use tRPC for all internal APIs",
    });

    // When a trace has tool_use stop reason (agent is mid-loop, calling a tool)
    await seedLlmTraceWithContent(surreal, `trace-tooluse-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText: "Let me implement this REST endpoint...",
      stopReason: "tool_use", // Intermediate step — should be skipped
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then no observations are created (tool_use traces are skipped)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 30_000);
});

describe("No contradiction when response aligns with decisions", () => {
  it.skip("creates no observations when trace content is consistent with confirmed decisions", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-obs-align-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    // Given a decision to use tRPC
    await seedConfirmedDecision(surreal, `dec-align-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Standardize on tRPC for all internal APIs",
    });

    // When the trace content follows the decision (uses tRPC)
    await seedLlmTraceWithContent(surreal, `trace-align-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText: "I'll create the tRPC router for this endpoint. Here's the implementation using the createTRPCRouter pattern with input validation via Zod.",
      stopReason: "end_turn",
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then no contradiction observations are created
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 30_000);
});

describe("Observer analysis failure — trace still exists, no observation created", () => {
  it.skip("preserves the trace record when Observer analysis encounters an error (fail-skip)", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-obs-fail-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    // No intelligence config — simulates a config loading error scenario

    const traceId = `trace-fail-${crypto.randomUUID()}`;

    // When a trace is created (Observer may fail to analyze due to missing config)
    await seedLlmTraceWithContent(surreal, traceId, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText: "Some response content that might contradict something",
      stopReason: "end_turn",
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then the trace still exists in the graph
    const { RecordId } = await import("surrealdb");
    const results = await surreal.query(
      `SELECT * FROM $trace;`,
      { trace: new RecordId("trace", traceId) },
    );
    const traces = (results[0] ?? []) as Array<{ id: unknown }>;
    expect(traces.length).toBe(1);

    // And no observations were created (analysis was skipped, not errored)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 30_000);
});

describe("Multiple contradictions detected in single trace", () => {
  it.skip("creates separate observations for each contradicted decision found in a trace", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-obs-multi-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    // Given multiple confirmed decisions
    await seedConfirmedDecision(surreal, `dec-multi1-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Standardize on tRPC for all internal APIs",
    });
    await seedConfirmedDecision(surreal, `dec-multi2-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Use PostgreSQL for all data persistence, no other databases",
    });

    // When a trace contradicts both decisions
    await seedLlmTraceWithContent(surreal, `trace-multi-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText: "I'll create a REST API endpoint using Express that stores data in MongoDB. The REST approach is simpler for this use case and MongoDB's document model fits our data shape.",
      stopReason: "end_turn",
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then separate contradiction observations exist for each violated decision
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});

describe("Low-confidence contradiction discarded by Tier 2 verification", () => {
  it.skip("does not create observations when Tier 2 LLM verification returns low confidence", async () => {
    const { surreal } = getRuntime();

    const workspaceId = `ws-obs-lowconf-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contradictionTier2ConfidenceMin: 0.9, // Very high threshold
    });

    // Given a decision about API standards
    await seedConfirmedDecision(surreal, `dec-lowconf-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Standardize on tRPC for all internal APIs",
    });

    // When a trace mentions REST but in a context that is ambiguous
    // (discussing external third-party APIs, not internal ones)
    await seedLlmTraceWithContent(surreal, `trace-lowconf-${crypto.randomUUID()}`, {
      model: "claude-sonnet-4-20250514",
      workspaceId,
      responseText: "The Stripe API uses REST webhooks, so we'll need to handle their REST callbacks in our webhook handler. Our internal services will continue using our standard patterns.",
      stopReason: "end_turn",
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then no contradiction is created (Tier 2 should determine this is not a violation)
    const observations = await getObservationsForWorkspace(surreal, workspaceId, {
      observationType: "contradiction",
      sourceAgent: "observer_agent",
    });
    expect(observations.length).toBe(0);
  }, 30_000);
});
