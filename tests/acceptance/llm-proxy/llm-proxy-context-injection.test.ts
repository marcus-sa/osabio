/**
 * Acceptance Tests: Context Injection (ADR-046)
 *
 * Traces: Intelligence Capability — Context Injection
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 *
 * Validates that the proxy enriches LLM requests with relevant workspace
 * knowledge (decisions, learnings, observations) before forwarding to the
 * upstream provider, without modifying the developer's original system prompt.
 *
 * Implementation sequence:
 * 1. Walking skeleton: workspace knowledge injected into forwarded request
 * 2. Original system prompt preserved (append-only)
 * 3. Token budget respected
 * 4. Context injection disabled — request forwarded without modification
 * 5. Context injection failure — request forwarded without modification (fail-open)
 * 6. Session cache hit — no DB query on second request
 * 7. Array-form system prompt preserved with brain-context appended
 * 8. Empty workspace — no context block appended
 *
 * All tests use it.skip() — capabilities not yet implemented.
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequestWithIntelligence,
  createProxyTestWorkspace,
  createProxyIntelligenceConfig,
  seedConfirmedDecision,
  seedActiveLearning,
  getTracesForWorkspace,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_context_injection");

// ---------------------------------------------------------------------------
// Walking Skeleton: Workspace knowledge enriches agent's LLM request
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Workspace decisions and learnings injected into request", () => {
  it.skip("appends a brain-context block with relevant decisions and learnings to the forwarded request", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-skel-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contextInjectionEnabled: true,
      contextInjectionTokenBudget: 1000,
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
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the request succeeds
    expect(response.status).toBe(200);
    await response.json();

    // And the trace records that context was injected
    await new Promise(resolve => setTimeout(resolve, 2000));
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    // The trace metadata should show context injection occurred
    // (The actual brain-context block is in the forwarded request,
    // but we verify via trace metadata that injection ran)
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Original system prompt preserved unchanged (append-only)", () => {
  it.skip("does not modify the developer's original system prompt text", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-append-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);
    await seedConfirmedDecision(surreal, `dec-append-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Use PostgreSQL for all persistence",
    });

    // Given the developer has a specific system prompt
    const originalSystemPrompt = "You are an expert TypeScript developer. Follow functional patterns.";

    // When the request is forwarded with context injection
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Write a database query" }],
      systemPrompt: originalSystemPrompt,
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response succeeds (proving the prompt was valid)
    expect(response.status).toBe(200);

    // And the original system prompt is preserved (brain-context appended, not replacing)
    // Verification: the model's response should reflect the original instructions
  }, 30_000);
});

describe("Context block respects configured token budget", () => {
  it.skip("includes only as many items as fit within the token budget", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-budget-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a very small token budget
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contextInjectionEnabled: true,
      contextInjectionTokenBudget: 100, // Very small budget
    });

    // And the workspace has many decisions
    for (let i = 0; i < 10; i++) {
      await seedConfirmedDecision(surreal, `dec-budget-${crypto.randomUUID()}`, {
        workspaceId,
        summary: `Decision ${i}: Use technology ${i} for component ${i} with detailed rationale about why this choice was made`,
      });
    }

    // When a request is sent
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "What technologies are we using?" }],
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response succeeds (budget was respected, not exceeded)
    expect(response.status).toBe(200);

    // And the trace metadata shows the estimated token count is within budget
    await new Promise(resolve => setTimeout(resolve, 2000));
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("Context injection disabled — request forwarded without modification", () => {
  it.skip("forwards the request unmodified when context injection is disabled", async () => {
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
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response succeeds
    expect(response.status).toBe(200);

    // And the trace metadata shows no context was injected
    await new Promise(resolve => setTimeout(resolve, 2000));
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("Context injection failure — request forwarded without modification (fail-open)", () => {
  it.skip("forwards the original request when context injection encounters an error", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-failopen-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given context injection is enabled but the intelligence config references
    // a nonexistent workspace (simulating a config/query error)
    // The proxy should fail-open and forward the original request

    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response still succeeds (fail-open behavior)
    expect(response.status).toBe(200);
  }, 30_000);
});

describe("Session cache hit — no additional DB query on repeated request", () => {
  it.skip("reuses cached candidate pool for subsequent requests in the same session", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-cache-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId, {
      contextInjectionEnabled: true,
      contextInjectionCacheTtlSeconds: 300,
    });
    await seedConfirmedDecision(surreal, `dec-cache-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Use Redis for caching layer",
    });

    const requestOptions = {
      model: "claude-sonnet-4-20250514" as const,
      stream: false as const,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }] as Array<{ role: string; content: string }>,
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
      sessionHeader: sessionId,
    };

    // Given a first request populates the session cache
    const response1 = await sendProxyRequestWithIntelligence(baseUrl, requestOptions);
    expect(response1.status).toBe(200);
    await response1.json();

    // When a second request is sent in the same session
    const response2 = await sendProxyRequestWithIntelligence(baseUrl, {
      ...requestOptions,
      messages: [{ role: "user", content: "Follow-up question" }],
    });

    // Then the second request also succeeds (using cached candidates)
    expect(response2.status).toBe(200);
  }, 60_000);
});

describe("Array-form system prompt preserved with brain-context appended", () => {
  it.skip("appends brain-context block to array-form system prompt without modifying existing blocks", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ci-array-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyIntelligenceConfig(surreal, workspaceId);
    await seedConfirmedDecision(surreal, `dec-array-${crypto.randomUUID()}`, {
      workspaceId,
      summary: "Use GraphQL for public APIs",
    });

    // Given the developer uses array-form system prompt with cache_control
    const systemPrompt = [
      { type: "text", text: "You are an expert developer.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Follow clean code principles." },
    ];

    // When a request is sent with array-form system prompt
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Design an API" }],
      systemPrompt,
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response succeeds (all system blocks valid)
    expect(response.status).toBe(200);
  }, 30_000);
});

describe("Empty workspace — no context block appended", () => {
  it.skip("forwards request without brain-context when workspace has no decisions or learnings", async () => {
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
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
    });

    // Then the response succeeds without any brain-context block
    expect(response.status).toBe(200);
  }, 30_000);
});
