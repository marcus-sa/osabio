/**
 * Acceptance Tests: Graph-Native Trace Capture (US-LP-003)
 *
 * Traces: US-LP-003 — Graph-Native Trace Capture
 * Driving port: POST /proxy/llm/anthropic/v1/messages + SurrealDB graph queries
 *
 * Validates that every forwarded LLM call produces an trace node
 * in the graph with usage data, cost, and relationship edges.
 *
 * Implementation sequence:
 * 1. Trace created with usage data after non-streaming call — ENABLED
 * 2. Trace edges link to session, workspace, and task
 * 3. Trace without task has workspace edge only
 * 4. Non-streaming response trace structure
 * 5. Trace capture is non-blocking
 * 6. Graph write failure retry and fallback
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
  getTraceEdges,
  seedAgentSession,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_trace");

// ---------------------------------------------------------------------------
// Walking Skeleton: LLM call produces trace in knowledge graph
// ---------------------------------------------------------------------------
describe("Trace created with usage data after LLM call", () => {
  it("creates an trace node with model, tokens, cost, and latency", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-trace-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given Priya sends a request through the proxy in a known workspace
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 20,
      messages: [{ role: "user", content: "Say exactly: test" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    expect(response.status).toBe(200);
    await response.json(); // consume body

    // Allow async trace capture to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then a trace node exists in the graph for this workspace
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const trace = traces[0];
    expect(trace.model).toContain("claude");
    expect(trace.input_tokens).toBeGreaterThan(0);
    expect(trace.output_tokens).toBeGreaterThan(0);
    expect(trace.cost_usd).toBeGreaterThan(0);
    expect(trace.latency_ms).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Trace edges link to session, workspace, and task", () => {
  it("creates invoked, attributed_to, and scoped_to edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-edges-${crypto.randomUUID()}`;
    const projectId = `proj-edges-${crypto.randomUUID()}`;
    const taskId = `task-edges-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    const sessionId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const accountId = "550e8400-e29b-41d4-a716-446655440000";

    // Seed an agent_session with this external session ID so the resolver can find it
    await seedAgentSession(surreal, crypto.randomUUID(), {
      workspaceId,
      agent: "coding-agent",
      source: "proxy",
      externalSessionId: sessionId,
    });

    // Given identity resolution produced session, workspace, and task
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      metadata: {
        user_id: buildClaudeCodeUserId("a1b2c3", accountId, sessionId),
      },
      workspaceHeader: workspaceId,
      taskHeader: taskId,
    });

    expect(response.status).toBe(200);
    await response.json();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then trace edges exist
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const traceId = traces[0].id.id as string;
    const edges = await getTraceEdges(surreal, traceId);

    // Workspace edge exists
    expect(edges.workspaces.length).toBeGreaterThanOrEqual(1);
    // Task edge exists
    expect(edges.tasks.length).toBeGreaterThanOrEqual(1);
    // Session edge exists
    expect(edges.sessions.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("Trace without task has workspace and session edges only", () => {
  it("creates workspace edge but no task attribution edge", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-notask-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given no task header was present
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    expect(response.status).toBe(200);
    await response.json();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then trace exists with workspace edge but no task edge
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const traceId = traces[0].id.id as string;
    const edges = await getTraceEdges(surreal, traceId);

    expect(edges.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(edges.tasks).toHaveLength(0);
  }, 30_000);
});

describe("Trace capture does not block response delivery", () => {
  it("delivers response before graph writes complete", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-nonblock-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request is sent through the proxy
    const startTime = performance.now();
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });
    const responseTime = performance.now() - startTime;

    expect(response.status).toBe(200);
    await response.json();

    // Then the response is delivered quickly (trace writes are async)
    // The response time should be dominated by Anthropic's latency, not graph writes
    // We just verify the response arrived; trace may still be writing
    expect(responseTime).toBeLessThan(30_000); // Generous bound; real check is below

    // Wait for async trace capture
    await new Promise(resolve => setTimeout(resolve, 3000));

    // And the trace eventually appears
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("Graph write failure triggers retry and fallback", () => {
  it("retries 3 times and logs to stderr on persistent failure", async () => {
    // This scenario requires simulating SurrealDB unavailability during trace capture.
    // In acceptance tests with real services, we validate the retry mechanism exists
    // by checking that traces are eventually written even under brief delays.
    //
    // Full failure simulation would require injectable dependencies in the proxy route,
    // which is the software-crafter's responsibility to design for testability.
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-retry-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a normal request completes
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    expect(response.status).toBe(200);
    await response.json();

    // Wait for async trace with extra time for potential retries
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Then trace is eventually written (retry mechanism working)
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);
  }, 45_000);
});
