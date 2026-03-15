/**
 * Acceptance Tests: Identity Resolution (US-LP-002)
 *
 * Traces: US-LP-002 — Identity Resolution from Agent Metadata
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 *
 * Validates that the proxy extracts identity from Claude Code metadata
 * and custom headers, resolves workspace/session/task, and gracefully
 * degrades when identity signals are partial.
 *
 * Implementation sequence:
 * 1. Full identity resolution — ENABLED
 * 2. Graceful degradation without task
 * 3. Graceful degradation without metadata
 * 4. Invalid workspace warning
 * 5. Malformed metadata parsing
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  sendProxyRequest,
  createProxyTestWorkspace,
  createProxyTestTask,
  createProxyTestProject,
  buildClaudeCodeUserId,
  getTracesForWorkspace,
} from "./llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("llm_proxy_identity");

// ---------------------------------------------------------------------------
// Scenario: Full identity resolution from Claude Code metadata and headers
// ---------------------------------------------------------------------------
describe("Full identity resolved from Claude Code metadata and headers", () => {
  it("resolves session, account, workspace, and task from request", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-ident-${crypto.randomUUID()}`;
    const projectId = `proj-ident-${crypto.randomUUID()}`;
    const taskId = `task-ident-${crypto.randomUUID()}`;

    // Given a workspace with a project and task exists
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestProject(surreal, projectId, workspaceId);
    await createProxyTestTask(surreal, taskId, projectId, workspaceId);

    const sessionId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const accountId = "550e8400-e29b-41d4-a716-446655440000";

    // When a request includes full Claude Code metadata and headers
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      metadata: {
        user_id: buildClaudeCodeUserId("a1b2c3", accountId, sessionId),
      },
      workspaceHeader: workspaceId,
      taskHeader: taskId,
    });

    // Then the request is forwarded successfully
    expect(response.status).toBe(200);

    // And identity fields are available for trace capture
    // (Full trace edge validation is in US-LP-003 tests;
    //  here we verify the proxy accepts and processes identity headers)
    const body = await response.json() as { type: string };
    expect(body.type).toBe("message");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------

describe("Graceful degradation without task header", () => {
  it.skip("resolves workspace and session, creates trace without task attribution", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-notask-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    const sessionId = "7ca8c921-0ead-22e2-91c5-11d15fe541d9";
    const accountId = "661f9511-f30c-52e5-b827-557766551111";

    // Given a request with metadata but no task header
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      metadata: {
        user_id: buildClaudeCodeUserId("b2c3d4", accountId, sessionId),
      },
      workspaceHeader: workspaceId,
      // No taskHeader — graceful degradation
    });

    // Then the request is forwarded normally
    expect(response.status).toBe(200);
  }, 30_000);
});

describe("Graceful degradation without any metadata", () => {
  it.skip("resolves workspace from header only when no metadata.user_id present", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-nometa-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with workspace header but no metadata.user_id
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: workspaceId,
      // No metadata — third-party agent scenario
    });

    // Then the request is forwarded normally
    expect(response.status).toBe(200);
  }, 30_000);
});

describe("Invalid workspace produces warning but does not block", () => {
  it.skip("forwards request and creates warning observation for unresolved workspace", async () => {
    const { baseUrl } = getRuntime();

    // Given a request with a non-existent workspace
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      workspaceHeader: "nonexistent-workspace-" + crypto.randomUUID(),
    });

    // Then the request is still forwarded (client's API key authenticates with Anthropic)
    expect(response.status).toBe(200);

    // And a warning observation should be created (verified after trace capture is implemented)
  }, 30_000);
});

describe("Malformed metadata.user_id parsed as opaque identifier", () => {
  it.skip("accepts non-standard metadata format without breaking the request", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-malform-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with non-standard metadata.user_id format
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENROUTER_API_KEY,
      metadata: { user_id: "some-random-string-not-matching-pattern" },
      workspaceHeader: workspaceId,
    });

    // Then the request is forwarded normally
    expect(response.status).toBe(200);
  }, 30_000);
});
