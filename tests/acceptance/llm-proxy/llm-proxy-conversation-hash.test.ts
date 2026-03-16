/**
 * Acceptance Tests: Conversation Hash Correlation (ADR-050)
 *
 * Traces: Intelligence Capability — Conversation Hash Correlation
 * Driving port: POST /proxy/llm/anthropic/v1/messages + SurrealDB graph queries
 *
 * Validates that the proxy derives a deterministic conversation identity from
 * request content (system prompt + first user message) using UUIDv5, enabling
 * trace grouping without requiring Brain integration or session lifecycle.
 *
 * Implementation sequence:
 * 1. Walking skeleton: same conversation content produces same conversation record
 * 2. Different content produces different conversation record
 * 3. Conversation record has correct workspace and title
 * 4. Missing system prompt — trace created without conversation link
 * 5. Missing first user message — trace created without conversation link
 * 6. Multiple turns in same conversation share the same conversation ID
 *
 * Tests enabled — implementing conversation hash correlation.
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequestWithIntelligence,
  createProxyTestWorkspace,
  getTracesForWorkspace,
  getConversationsForWorkspace,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_conversation_hash");

// ---------------------------------------------------------------------------
// Walking Skeleton: Same conversation content links to same conversation record
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Identical requests grouped into same conversation", () => {
  it("creates a single conversation record when two requests share the same system prompt and first user message", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-conv-skel-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const systemPrompt = "You are a TypeScript expert.";
    const firstUserMessage = "How do I implement dependency injection?";

    // Given two requests with the same system prompt and first user message
    const response1 = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: firstUserMessage }],
      systemPrompt,
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });
    expect(response1.status).toBe(200);
    await response1.json();

    const response2 = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [
        { role: "user", content: firstUserMessage },
        { role: "assistant", content: "Here is how..." },
        { role: "user", content: "Can you show an example?" },
      ],
      systemPrompt,
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });
    expect(response2.status).toBe(200);
    await response2.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then both traces link to the same conversation record
    const conversations = await getConversationsForWorkspace(surreal, workspaceId, { source: "proxy" });
    expect(conversations.length).toBe(1);

    // And the conversation has the expected workspace
    expect((conversations[0].workspace.id as string)).toBe(workspaceId);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Different content produces different conversation record", () => {
  it("creates separate conversation records for requests with different system prompts", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-conv-diff-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with one system prompt
    const response1 = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Help me write code" }],
      systemPrompt: "You are a Python developer.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });
    expect(response1.status).toBe(200);
    await response1.json();

    // And a request with a different system prompt
    const response2 = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Help me write code" }],
      systemPrompt: "You are a Rust developer.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });
    expect(response2.status).toBe(200);
    await response2.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then two separate conversation records exist
    const conversations = await getConversationsForWorkspace(surreal, workspaceId, { source: "proxy" });
    expect(conversations.length).toBe(2);
  }, 60_000);
});

describe("Conversation record has correct title derived from first user message", () => {
  it("sets the conversation title from the first user message content", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-conv-title-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const firstMessage = "How do I implement OAuth 2.1 with DPoP?";

    // When a request is sent with a specific first user message
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: firstMessage }],
      systemPrompt: "You are a security expert.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });
    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then the conversation title is derived from the first user message
    const conversations = await getConversationsForWorkspace(surreal, workspaceId, { source: "proxy" });
    expect(conversations.length).toBe(1);
    expect(conversations[0].title).toContain("OAuth");
  }, 30_000);
});

describe("Missing system prompt — trace created without conversation link", () => {
  it("creates a trace but skips conversation hash when no system prompt is provided", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-conv-nosys-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with no system prompt
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      // No systemPrompt
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then a trace exists but no conversation record was created
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const conversations = await getConversationsForWorkspace(surreal, workspaceId, { source: "proxy" });
    expect(conversations.length).toBe(0);
  }, 30_000);
});

describe("Missing first user message — trace created without conversation link", () => {
  it("creates a trace but skips conversation hash when messages array is empty", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-conv-nomsg-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with system prompt but no user messages
    // (This is technically an invalid Anthropic request that will fail upstream,
    // but the proxy should still attempt trace creation without conversation link)
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [], // Empty messages
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });

    // The upstream may reject this, but we verify the proxy's behavior
    // regardless of upstream response
    await response.text(); // consume body

    // No conversation should be created for missing first user message
    const conversations = await getConversationsForWorkspace(surreal, workspaceId, { source: "proxy" });
    expect(conversations.length).toBe(0);
  }, 30_000);
});

describe("Multiple turns preserve same conversation identity", () => {
  it("links all traces in a multi-turn conversation to the same conversation record", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-conv-multi-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const systemPrompt = "You are an architect.";
    const firstMessage = "Design a microservices architecture";

    // Given three turns in the same conversation (same system + first user message)
    for (let turn = 0; turn < 3; turn++) {
      const messages = [
        { role: "user", content: firstMessage },
      ];
      // Add previous turns for subsequent requests
      for (let i = 0; i < turn; i++) {
        messages.push({ role: "assistant", content: `Response ${i}` });
        messages.push({ role: "user", content: `Follow-up ${i}` });
      }

      const response = await sendProxyRequestWithIntelligence(baseUrl, {
        model: "claude-sonnet-4-20250514",
        stream: false,
        maxTokens: 30,
        messages,
        systemPrompt,
        apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
        workspaceHeader: workspaceId,
      });
      expect(response.status).toBe(200);
      await response.json();
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Then all three traces link to the same single conversation
    const conversations = await getConversationsForWorkspace(surreal, workspaceId, { source: "proxy" });
    expect(conversations.length).toBe(1);

    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBe(3);
  }, 90_000);
});
