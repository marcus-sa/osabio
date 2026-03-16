/**
 * Acceptance Tests: LLM Proxy Walking Skeletons
 *
 * Three thinnest E2E slices proving observable user value:
 * 1. Passthrough — developer's LLM call works identically through proxy
 * 2. Trace capture — LLM call recorded as trace in knowledge graph
 * 3. Cost attribution — admin sees cost attributed to correct project
 *
 * Each skeleton builds on the previous. Implement in order.
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequest,
  createProxyTestWorkspace,
  createProxyTestProject,
  createProxyTestTask,
  getTracesForWorkspace,
  getTracesForTask,
  getWorkspaceSpend,
  TEST_PROXY_MODEL,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_skeleton");

// ---------------------------------------------------------------------------
// Skeleton 1: Developer makes an LLM call through the proxy and it works
// ---------------------------------------------------------------------------
describe("Skeleton 1: Non-streaming passthrough", () => {
  it("forwards a request and returns the model response identically", async () => {
    const { baseUrl } = getRuntime();

    // Given Priya has configured Claude Code to use Brain's proxy
    // And she has a valid Anthropic API key
    const response = await sendProxyRequest(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Reply with exactly the word 'hello'." }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    });

    // Then she receives the model's response with the original content
    expect(response.status).toBe(200);

    const body = await response.json() as {
      type: string;
      role: string;
      content: Array<{ type: string; text: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    // And the response is indistinguishable from calling Anthropic directly
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content[0].type).toBe("text");
    expect(body.model).toContain("claude");
    expect(body.usage.input_tokens).toBeGreaterThan(0);
    expect(body.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Skeleton 2: LLM call is recorded as a trace in the knowledge graph
// ---------------------------------------------------------------------------
describe("Skeleton 2: Trace capture", () => {
  it("records an LLM call as a trace node with model, tokens, cost, and workspace edge", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-skel2-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given Priya is working in workspace "brain-v1"
    // When she sends a request through the proxy
    const response = await sendProxyRequest(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 20,
      messages: [{ role: "user", content: "Say exactly: test" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the model response is delivered to Priya
    expect(response.status).toBe(200);
    await response.json();

    // Allow async trace capture to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // And a trace appears in the knowledge graph with the configured model
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const trace = traces[0];
    expect(trace.model).toContain("claude");

    // And the trace records the token counts and computed cost
    expect(trace.input_tokens).toBeGreaterThan(0);
    expect(trace.output_tokens).toBeGreaterThan(0);
    expect(trace.cost_usd).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Skeleton 3: Admin sees cost attributed to the correct project
// ---------------------------------------------------------------------------
describe("Skeleton 3: Cost attribution", () => {
  it("attributes LLM call cost to the correct project and task", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-skel3-${crypto.randomUUID()}`;
    const projectId = `proj-skel3-${crypto.randomUUID()}`;
    const taskId = `task-skel3-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    // Given Priya is working on task "implement-oauth" in project "auth-service"
    // And she makes an LLM call through the proxy
    const response = await sendProxyRequest(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 20,
      messages: [{ role: "user", content: "Say exactly: test" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
      taskHeader: taskId,
    });

    expect(response.status).toBe(200);
    await response.json();

    // Allow async trace + cost capture to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // When Marcus queries the spend breakdown for the workspace
    const totalSpend = await getWorkspaceSpend(surreal, workspaceId);
    expect(totalSpend).toBeGreaterThan(0);

    // Then the cost appears attributed to the task
    const taskTraces = await getTracesForTask(surreal, taskId);
    expect(taskTraces.length).toBeGreaterThanOrEqual(1);
    expect(taskTraces[0].cost_usd).toBeGreaterThan(0);
  }, 30_000);
});
