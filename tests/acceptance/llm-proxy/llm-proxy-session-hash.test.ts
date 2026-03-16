/**
 * Acceptance Tests: Session Hash Correlation
 *
 * Traces: Intelligence Capability — Session Hash Correlation
 * Driving port: POST /proxy/llm/anthropic/v1/messages + SurrealDB graph queries
 *
 * Validates that the proxy derives a deterministic agent_session identity from
 * request content (system prompt + first user message) using UUIDv5, enabling
 * trace grouping via invoked edges when no explicit session signal is present.
 *
 * Implementation sequence:
 * 1. Walking skeleton: same content produces same agent_session record
 * 2. Different content produces different agent_session records
 * 3. Agent session has correct workspace and source
 * 4. Missing system prompt — trace created without session link
 * 5. Missing first user message — trace created without session link
 * 6. Multiple turns in same session share the same agent_session ID
 * 7. Explicit session header takes precedence over content hash
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequestWithIntelligence,
  createProxyTestWorkspace,
  getTracesForWorkspace,
  getSessionsForWorkspace,
  getTraceEdges,
  seedAgentSession,
  TEST_PROXY_MODEL,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_session_hash");

// ---------------------------------------------------------------------------
// Walking Skeleton: Same content links to same agent_session record
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Identical requests grouped into same agent_session", () => {
  it("creates a single agent_session record when two requests share the same system prompt and first user message", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-skel-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const systemPrompt = "You are a TypeScript expert.";
    const firstUserMessage = "How do I implement dependency injection?";

    // Given two requests with the same system prompt and first user message
    const response1 = await sendProxyRequestWithIntelligence(baseUrl, {
      model: TEST_PROXY_MODEL,
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
      model: TEST_PROXY_MODEL,
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

    // Then both traces link to the same agent_session record via invoked edges
    const sessions = await getSessionsForWorkspace(surreal, workspaceId, { source: "proxy_hash" });
    expect(sessions.length).toBe(1);

    // And the session has the expected workspace
    expect((sessions[0].workspace.id as string)).toBe(workspaceId);
    expect(sessions[0].agent).toBe("proxy");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Different content produces different agent_session records", () => {
  it("creates separate agent_session records for requests with different system prompts", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-diff-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with one system prompt
    const response1 = await sendProxyRequestWithIntelligence(baseUrl, {
      model: TEST_PROXY_MODEL,
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
      model: TEST_PROXY_MODEL,
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

    // Then two separate agent_session records exist
    const sessions = await getSessionsForWorkspace(surreal, workspaceId, { source: "proxy_hash" });
    expect(sessions.length).toBe(2);
  }, 60_000);
});

describe("Agent session has correct source marker", () => {
  it("sets source to proxy_hash for content-derived sessions", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-src-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "How do I implement OAuth 2.1 with DPoP?" }],
      systemPrompt: "You are a security expert.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
    });
    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    const sessions = await getSessionsForWorkspace(surreal, workspaceId, { source: "proxy_hash" });
    expect(sessions.length).toBe(1);
    expect(sessions[0].source).toBe("proxy_hash");
  }, 30_000);
});

describe("Missing system prompt — trace created without session hash fallback", () => {
  it("creates a trace but skips session hash when no system prompt is provided", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-nosys-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with no system prompt
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: TEST_PROXY_MODEL,
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

    // Then a trace exists but no proxy_hash session was created
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const sessions = await getSessionsForWorkspace(surreal, workspaceId, { source: "proxy_hash" });
    expect(sessions.length).toBe(0);
  }, 30_000);
});

describe("Multiple turns preserve same session identity", () => {
  it("links all traces in a multi-turn session to the same agent_session record", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-multi-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const systemPrompt = "You are an architect.";
    const firstMessage = "Design a microservices architecture";

    // Given three turns in the same session (same system + first user message)
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
        model: TEST_PROXY_MODEL,
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

    // Then all three traces link to the same single session
    const sessions = await getSessionsForWorkspace(surreal, workspaceId, { source: "proxy_hash" });
    expect(sessions.length).toBe(1);

    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBe(3);
  }, 90_000);
});

describe("Explicit session header takes precedence over content hash", () => {
  it("uses the header session instead of deriving from content", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-hdr-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Seed an explicit agent session
    const explicitSessionId = crypto.randomUUID();
    await seedAgentSession(surreal, explicitSessionId, {
      workspaceId,
      agent: "coding-agent",
      source: "cli",
    });

    // Send request WITH explicit session header
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: TEST_PROXY_MODEL,
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      systemPrompt: "You are a helpful assistant.",
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
      sessionHeader: explicitSessionId,
    });
    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then no proxy_hash session was created (header took precedence)
    const hashSessions = await getSessionsForWorkspace(surreal, workspaceId, { source: "proxy_hash" });
    expect(hashSessions.length).toBe(0);

    // And the trace is linked to the explicit session via invoked edge
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const edges = await getTraceEdges(surreal, traces[0].id.id as string);
    expect(edges.sessions.length).toBe(1);
    expect((edges.sessions[0].id as string)).toBe(explicitSessionId);
  }, 30_000);
});
