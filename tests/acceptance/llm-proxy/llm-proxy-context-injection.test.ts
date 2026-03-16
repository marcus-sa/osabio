/**
 * Acceptance Tests: Context Injection (Step 03-02)
 *
 * Traces: Intelligence Capability -- Context Injection
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 *
 * Validates that the proxy enriches LLM requests with relevant workspace
 * knowledge (decisions, learnings, observations) before forwarding to the
 * upstream provider, without modifying the developer's original system prompt.
 *
 * These tests verify context injection via trace metadata (input FLEXIBLE field)
 * rather than intercepting the upstream request body. The trace records whether
 * injection occurred and how many items were injected.
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequestWithIntelligence,
  createProxyTestWorkspace,
  createProxyIntelligenceConfig,
  seedConfirmedDecision,
  seedActiveLearning,
  seedOpenObservation,
  getTracesForWorkspace,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_context_injection");

// ---------------------------------------------------------------------------
// Walking Skeleton: Workspace knowledge enriches agent's LLM request
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Workspace decisions and learnings injected into request", () => {
  it("appends a brain-context block with relevant decisions and learnings to the forwarded request", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-skel-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contextInjectionEnabled: true,
      contextInjectionTokenBudget: 2000,
    });

    // Given the workspace has confirmed decisions and active learnings
    await seedConfirmedDecision(surreal, `dec-ci-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Standardize on tRPC for all internal APIs",
      rationale: "Consistency across services, type-safe contracts",
    });
    await seedActiveLearning(surreal, `lrn-ci-${crypto.randomUUID()}`, {
      workspaceId,
      text: "All new endpoints must include DPoP authentication",
    });

    // When the developer sends a request through the proxy for this workspace
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 100,
      messages: [{ role: "user", content: "How should I implement the billing API?" }],
      systemPrompt: "You are a helpful coding assistant.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the request succeeds
    expect(response.status).toBe(200);
    await response.json();

    // And the trace records that context was injected
    await new Promise(resolve => setTimeout(resolve, 2000));
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    // The trace input metadata shows context injection occurred
    const trace = traces[0] as any;
    expect(trace.input?.brain_context_injected).toBe(true);
    expect(trace.input?.brain_context_decisions).toBeGreaterThanOrEqual(1);
    expect(trace.input?.brain_context_learnings).toBeGreaterThanOrEqual(1);
    expect(trace.input?.brain_context_tokens_est).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Context injection disabled -- request forwarded without modification", () => {
  it("forwards the request unmodified when context injection is disabled", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-disabled-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given context injection is disabled for this workspace
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contextInjectionEnabled: false,
    });
    await seedConfirmedDecision(surreal, `dec-disabled-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "This decision should NOT appear in the request",
    });

    // When a request is sent through the proxy
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response succeeds
    expect(response.status).toBe(200);

    // And the trace metadata shows no context was injected
    await new Promise(resolve => setTimeout(resolve, 2000));
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);
    const trace = traces[0] as any;
    // brain_context_injected should be false or absent
    expect(trace.input?.brain_context_injected).toBeFalsy();
  }, 30_000);
});

describe("Empty workspace -- no context block appended", () => {
  it("forwards request without brain-context when workspace has no decisions or learnings", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-empty-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);

    // Given the workspace has no decisions, learnings, or observations

    // When a request is sent
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response succeeds without any brain-context block
    expect(response.status).toBe(200);

    // And the trace shows no context was injected (empty pool)
    await new Promise(resolve => setTimeout(resolve, 2000));
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);
    const trace = traces[0] as any;
    expect(trace.input?.brain_context_injected).toBeFalsy();
  }, 30_000);
});

describe("Context injection failure -- request forwarded without modification (fail-open)", () => {
  it("forwards the original request when context injection encounters an error", async () => {
    const { baseUrl } = getRuntime();

    // Given no intelligence config exists (simulating a config/query error)
    const workspaceId = `ws-ci-failopen-${crypto.randomUUID()}`;
    // Deliberately not creating workspace or config

    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response still succeeds (fail-open behavior)
    expect(response.status).toBe(200);
  }, 30_000);
});

describe("Trace output captures response content", () => {
  it("stores response content_blocks, stop_reason, and usage in trace output field", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-trace-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contextInjectionEnabled: true,
      contextInjectionTokenBudget: 2000,
    });

    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Say hello in one word." }],
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    expect(response.status).toBe(200);

    await new Promise(resolve => setTimeout(resolve, 2000));
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const trace = traces[0] as any;
    // Output field captures response content
    expect(trace.output?.content_blocks).toBeDefined();
    expect(Array.isArray(trace.output.content_blocks)).toBe(true);
    expect(trace.output?.stop_reason).toBeDefined();
    expect(trace.output?.usage).toBeDefined();
    expect(trace.output.usage.input_tokens).toBeGreaterThan(0);
    expect(trace.output.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);
});
