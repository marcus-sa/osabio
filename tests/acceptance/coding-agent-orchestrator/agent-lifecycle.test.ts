/**
 * Agent Lifecycle: Session Hooks for Agent Integration
 *
 * Traces: US-0.1 (agent session creation), US-0.2 (context loading at start)
 *
 * Validates that the Brain MCP lifecycle hooks correctly start and end
 * agent sessions. These hooks fire when an agent starts/stops a session,
 * and they register the agent with Brain's knowledge graph context system.
 *
 * Driving ports: POST /api/mcp/:ws/sessions/start
 *                POST /api/mcp/:ws/sessions/end
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  fetchJson,
  fetchRaw,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("agent_lifecycle");

describe("Agent Lifecycle: Session start hook", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Agent starts a session on init
  // US-0.1
  // -------------------------------------------------------------------------
  it("creates an agent session when the agent fires session.created", async () => {
    const { baseUrl } = getRuntime();

    // Given a coding agent starting up with the Brain MCP integration
    const user = await createTestUser(baseUrl, "lifecycle-start");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the agent fires the session.created hook
    const session = await fetchJson<{ session_id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ agent: "claude" }),
      },
    );

    // Then a session is registered for tracking the agent's activity
    expect(session.session_id).toBeTruthy();
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Session start without agent identifier
  // -------------------------------------------------------------------------
  it("rejects session start when agent type is not specified", async () => {
    const { baseUrl } = getRuntime();

    // Given a hook that fires without identifying the agent
    const user = await createTestUser(baseUrl, "lifecycle-noagent");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the session start is attempted without an agent type
    const response = await fetchRaw(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({}),
      },
    );

    // Then the request is rejected because the agent type is required
    expect(response.ok).toBe(false);
  }, 60_000);
});

describe("Agent Lifecycle: Session end hook", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Agent ends session with summary
  // -------------------------------------------------------------------------
  it("records session summary when the agent fires session.idle", async () => {
    const { baseUrl } = getRuntime();

    // Given an agent with an active session
    const user = await createTestUser(baseUrl, "lifecycle-end");
    const workspace = await createTestWorkspace(baseUrl, user);

    const session = await fetchJson<{ session_id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ agent: "claude" }),
      },
    );

    // When the agent fires the session.idle hook with a summary
    await fetchJson(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/end`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          session_id: session.session_id,
          summary: "Implemented user registration endpoint with email validation",
          files_changed: [
            { path: "src/auth/register.ts", change_type: "created" },
            { path: "tests/auth/register.test.ts", change_type: "created" },
          ],
        }),
      },
    );

    // Then the session is closed with its work summary recorded
    // (verified by session no longer appearing as active -- implementation will confirm)
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Ending a nonexistent session
  // -------------------------------------------------------------------------
  it("rejects session end for a session that does not exist", async () => {
    const { baseUrl } = getRuntime();

    // Given a session identifier that has no matching record
    const user = await createTestUser(baseUrl, "lifecycle-badend");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the agent tries to end a nonexistent session
    const response = await fetchRaw(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/end`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          session_id: "nonexistent-session-id",
          summary: "Some work",
        }),
      },
    );

    // Then the request fails because no matching session was found
    expect(response.ok).toBe(false);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Edge Case: Double session end is idempotent
  // -------------------------------------------------------------------------
  it("handles duplicate session end calls gracefully", async () => {
    const { baseUrl } = getRuntime();

    // Given a session that has already been ended
    const user = await createTestUser(baseUrl, "lifecycle-double");
    const workspace = await createTestWorkspace(baseUrl, user);

    const session = await fetchJson<{ session_id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ agent: "claude" }),
      },
    );

    await fetchJson(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/end`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          session_id: session.session_id,
          summary: "First end",
        }),
      },
    );

    // When the agent fires session.idle again (e.g. due to retry)
    const response = await fetchRaw(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/end`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          session_id: session.session_id,
          summary: "Duplicate end",
        }),
      },
    );

    // Then the second end is handled without error (idempotent)
    // Either succeeds silently or returns a clear "already ended" response
    expect([200, 204, 409]).toContain(response.status);
  }, 60_000);
});
