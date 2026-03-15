/**
 * Acceptance Tests: Session ID Resolution (ADR-049)
 *
 * Traces: Intelligence Capability — Session ID Resolution
 * Driving port: POST /proxy/llm/anthropic/v1/messages + SurrealDB graph queries
 *
 * Validates that the proxy extracts session IDs from incoming request metadata
 * or headers and links traces to existing agent_session records. The proxy does
 * NOT manage session lifecycle — it only reads session IDs from requests.
 *
 * Implementation sequence:
 * 1. Walking skeleton: trace linked to existing agent session via X-Brain-Session header
 * 2. Claude Code metadata.user_id session extraction
 * 3. Unknown client — trace linked to workspace only
 * 4. Nonexistent session ID — trace linked to workspace only
 * 5. Session activity timestamp updated on proxy request
 *
 * All tests use it.skip() — capabilities not yet implemented.
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequest,
  sendProxyRequestWithIntelligence,
  createProxyTestWorkspace,
  seedAgentSession,
  getTracesForWorkspace,
  getTraceEdges,
  getSessionById,
  buildClaudeCodeUserId,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_session_resolution");

// ---------------------------------------------------------------------------
// Walking Skeleton: Trace linked to agent session via X-Brain-Session header
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Trace linked to agent session", () => {
  it.skip("links the trace to the existing agent session when X-Brain-Session header is present", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-skel-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given an agent session exists (created by the CLI during brain init)
    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
      source: "cli",
      externalSessionId: sessionId,
    });

    // When the developer sends a request with the X-Brain-Session header
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
      sessionHeader: sessionId,
    });

    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then the trace is linked to the agent session
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const traceId = traces[0].id.id as string;
    const edges = await getTraceEdges(surreal, traceId);

    expect(edges.sessions.length).toBeGreaterThanOrEqual(1);
    expect(edges.workspaces.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Claude Code metadata.user_id session extraction", () => {
  it.skip("links the trace to the agent session resolved from Claude Code metadata", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-cc-${crypto.randomUUID()}`;
    const ccSessionId = crypto.randomUUID();
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given an agent session was created by the CLI with Claude Code's session ID
    await seedAgentSession(surreal, crypto.randomUUID(), {
      workspaceId,
      agent: "coding-agent",
      source: "proxy",
      externalSessionId: ccSessionId,
    });

    // When Claude Code sends a request with session ID embedded in metadata.user_id
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
      metadata: {
        user_id: buildClaudeCodeUserId("a1b2c3", "acct-123", ccSessionId),
      },
    });

    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then the trace is linked to the agent session
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const traceId = traces[0].id.id as string;
    const edges = await getTraceEdges(surreal, traceId);
    expect(edges.sessions.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("Unknown client — trace linked to workspace only", () => {
  it.skip("creates a trace with workspace edge but no session edge for unidentified clients", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-unknown-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given no session ID is provided in the request (no header, no metadata)
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
      // No metadata, no session header
    });

    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then the trace has a workspace edge but no session edge
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const traceId = traces[0].id.id as string;
    const edges = await getTraceEdges(surreal, traceId);
    expect(edges.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(edges.sessions).toHaveLength(0);
  }, 30_000);
});

describe("Nonexistent session ID — trace linked to workspace only", () => {
  it.skip("creates a trace without session edge when the session ID does not match any record", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-bogus-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a session ID that does not exist in the database
    const bogusSessionId = crypto.randomUUID();

    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
      sessionHeader: bogusSessionId,
    });

    // Then the response still succeeds (session resolution failure is non-blocking)
    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // And the trace has workspace edge but no session edge
    const traces = await getTracesForWorkspace(surreal, workspaceId);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const traceId = traces[0].id.id as string;
    const edges = await getTraceEdges(surreal, traceId);
    expect(edges.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(edges.sessions).toHaveLength(0);
  }, 30_000);
});

describe("Session activity timestamp updated on proxy request", () => {
  it.skip("updates last_activity_at on the agent session when a proxy request is received", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-sess-activity-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();
    const oldActivity = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

    await createProxyTestWorkspace(surreal, workspaceId);
    await seedAgentSession(surreal, sessionId, {
      workspaceId,
      agent: "coding-agent",
      source: "cli",
      externalSessionId: sessionId,
      lastActivityAt: oldActivity,
    });

    // When a proxy request is sent in this session
    const response = await sendProxyRequestWithIntelligence(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Hello" }],
      apiKey: process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      workspaceHeader: workspaceId,
      sessionHeader: sessionId,
    });

    expect(response.status).toBe(200);
    await response.json();

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Then the session's last_activity_at is updated to a recent time
    const session = await getSessionById(surreal, sessionId);
    expect(session).toBeDefined();
    if (session?.last_activity_at) {
      const activityTime = new Date(session.last_activity_at).getTime();
      // Should be within the last 30 seconds (generous bound)
      expect(activityTime).toBeGreaterThan(Date.now() - 30_000);
    }
  }, 30_000);
});
