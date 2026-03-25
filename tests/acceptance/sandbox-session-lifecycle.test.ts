/**
 * Acceptance Tests: Sandbox Agent Session Lifecycle (R1)
 *
 * Exercises the full SandboxAgent integration through Brain's HTTP endpoints
 * against a real SandboxAgent Server process.
 *
 * Traces: US-01 (spawn), US-02 (persistence), US-03 (events),
 *         US-04 (multi-turn), US-05 (restoration)
 *
 * Driving ports:
 *   POST /api/orchestrator/:ws/sessions/assign   (session spawn)
 *   POST /api/orchestrator/:ws/sessions/:id/prompt (multi-turn prompt)
 *   GET  /api/orchestrator/:ws/sessions/:id        (session status)
 *   POST /api/orchestrator/:ws/sessions/:id/accept  (accept work)
 *   POST /api/orchestrator/:ws/sessions/:id/abort   (abort session)
 *   SSE  /api/orchestrator/:ws/sessions/:id/stream   (event stream)
 *
 * Prerequisites:
 *   - SandboxAgent Server binary available and running
 *   - SurrealDB running (standard acceptance test requirement)
 *   - Required env vars: OPENROUTER_API_KEY, CHAT_AGENT_MODEL, etc.
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUser,
  type AcceptanceTestRuntime,
} from "./acceptance-test-kit";

// ── Suite Setup ──

const getRuntime = setupAcceptanceSuite("sandbox_session_lifecycle", {
  // Config overrides for sandbox agent tests will go here
  // e.g., sandboxAgentServerUrl, worktreeManagerEnabled, etc.
});

// ── Test Helpers (will be extracted to a sandbox-test-kit.ts as patterns emerge) ──

async function createTestWorkspace(
  baseUrl: string,
  user: { headers: Record<string, string> },
  surreal: AcceptanceTestRuntime["surreal"],
): Promise<{ workspaceId: string }> {
  const response = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify({ name: `Sandbox Test ${crypto.randomUUID()}` }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create workspace: ${response.status}`);
  }
  const body = (await response.json()) as { workspaceId: string };

  // Set repo_path so the orchestrator can create worktrees
  const workspaceRecord = new RecordId("workspace", body.workspaceId);
  await surreal.query(
    `UPDATE $ws SET repo_path = $path;`,
    { ws: workspaceRecord, path: "/tmp/brain-test-repo" },
  );

  return { workspaceId: body.workspaceId };
}

async function createReadyTask(
  surreal: AcceptanceTestRuntime["surreal"],
  workspaceId: string,
  task: { title: string; description: string },
): Promise<{ taskId: string }> {
  const taskId = crypto.randomUUID();
  const taskRecord = new RecordId("task", taskId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $task CONTENT $content;`, {
    task: taskRecord,
    content: {
      title: task.title,
      description: task.description,
      status: "ready",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return { taskId };
}

async function assignTaskToSandboxAgent(
  baseUrl: string,
  user: { headers: Record<string, string> },
  workspaceId: string,
  taskId: string,
): Promise<{ agentSessionId: string; streamUrl: string }> {
  const response = await fetch(
    `${baseUrl}/api/orchestrator/${workspaceId}/assign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ taskId }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to assign task: ${response.status} ${body}`);
  }
  return (await response.json()) as { agentSessionId: string; streamUrl: string };
}

async function sendPrompt(
  baseUrl: string,
  user: { headers: Record<string, string> },
  workspaceId: string,
  sessionId: string,
  text: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ text }),
    },
  );
}

async function getSessionStatus(
  baseUrl: string,
  user: { headers: Record<string, string> },
  workspaceId: string,
  sessionId: string,
): Promise<{ orchestratorStatus: string; sessionType?: string }> {
  const response = await fetch(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}`,
    { headers: user.headers },
  );
  if (!response.ok) {
    throw new Error(`Failed to get session status: ${response.status}`);
  }
  return (await response.json()) as { orchestratorStatus: string; sessionType?: string };
}

async function querySessionFromDb(
  surreal: AcceptanceTestRuntime["surreal"],
  sessionId: string,
): Promise<Record<string, unknown> | undefined> {
  const [rows] = await surreal.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM $record;`,
    { record: new RecordId("agent_session", sessionId) },
  );
  return rows[0];
}

// =============================================================================
// Walking Skeletons
// =============================================================================

describe("Walking Skeleton: Sandbox Agent Session Lifecycle", () => {
  // ─── WS-1: Developer spawns a session, sends a prompt, and receives events ───
  // US-01, US-03, US-04
  it.skip("developer spawns a sandbox session, sends a prompt, and sees agent events", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a developer with a workspace containing a task ready for work
    const user = await createTestUser(baseUrl, `ws1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement rate limiting",
      description: "Add sliding window rate limiter to the API gateway",
    });

    // When the developer requests a coding session for the task
    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then a sandbox agent session is created with a stream URL
    expect(assignment.agentSessionId).toBeTruthy();
    expect(assignment.streamUrl).toBeTruthy();

    // And the session record in SurrealDB has session_type "sandbox_agent"
    const dbSession = await querySessionFromDb(surreal, assignment.agentSessionId);
    expect(dbSession).toBeDefined();
    expect(dbSession!.session_type).toBe("sandbox_agent");

    // When the developer sends their first prompt
    const promptResponse = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Implement a sliding window rate limiter with 100 requests per minute",
    );

    // Then the prompt is accepted
    expect(promptResponse.ok).toBe(true);

    // And the session status is active
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(["running", "active", "idle"]).toContain(status.orchestratorStatus);
  }, 30_000);

  // ─── WS-2: Developer sends follow-up prompts ───
  // US-04
  it.skip("developer sends multiple follow-up prompts to the same session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a developer with an active coding session
    const user = await createTestUser(baseUrl, `ws2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build authentication service",
      description: "Create JWT-based auth with refresh tokens",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the developer sends the first prompt
    const firstPrompt = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Create the basic JWT token generation",
    );
    expect(firstPrompt.ok).toBe(true);

    // And sends a follow-up to refine the implementation
    const secondPrompt = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Add refresh token rotation with SurrealDB storage",
    );

    // Then the follow-up is accepted (not 409 Conflict)
    expect(secondPrompt.ok).toBe(true);
    expect(secondPrompt.status).not.toBe(409);

    // When the developer sends a third prompt
    const thirdPrompt = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Add rate limiting to the token endpoint",
    );

    // Then the third prompt is also accepted
    expect(thirdPrompt.ok).toBe(true);
  }, 60_000);

  // ─── WS-3: Session persists in SurrealDB ───
  // US-01, US-02
  it.skip("session record in SurrealDB has correct sandbox fields", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a developer spawns a sandbox coding session
    const user = await createTestUser(baseUrl, `ws3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add logging middleware",
      description: "Structured logging with request tracing",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the session record is queried from SurrealDB
    const dbSession = await querySessionFromDb(surreal, assignment.agentSessionId);

    // Then the record has session_type "sandbox_agent"
    expect(dbSession).toBeDefined();
    expect(dbSession!.session_type).toBe("sandbox_agent");

    // And has a provider field
    expect(dbSession!.provider).toBeDefined();

    // And has an external_session_id linking to the SandboxAgent runtime
    expect(dbSession!.external_session_id).toBeTruthy();

    // And has the correct workspace reference
    expect(dbSession!.workspace).toBeDefined();
  }, 30_000);
});

// =============================================================================
// Happy Path Scenarios
// =============================================================================

describe("Happy Path: Sandbox Session Operations", () => {
  // ─── HP-1: Session spawns and returns session ID ───
  // US-01
  it("session spawns and returns a valid session ID and stream URL", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a developer with a ready task
    const user = await createTestUser(baseUrl, `hp1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Refactor database queries",
      description: "Optimize N+1 queries in entity search",
    });

    // When the developer assigns the task to a sandbox agent
    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then a session ID and stream URL are returned
    expect(assignment.agentSessionId).toBeTruthy();
    expect(typeof assignment.agentSessionId).toBe("string");
    expect(assignment.streamUrl).toBeTruthy();
    expect(assignment.streamUrl).toContain("stream");
  }, 30_000);

  // ─── HP-5: Session status shows active after spawn ───
  // US-01
  it("session status is active or running after spawn", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a freshly spawned sandbox session
    const user = await createTestUser(baseUrl, `hp5-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add input validation",
      description: "Validate all API endpoint inputs with Zod",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the developer checks the session status
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the status is active or running
    expect(["spawning", "running", "active", "idle"]).toContain(status.orchestratorStatus);
  }, 30_000);

  // ─── HP-2: Prompt delivery via adapter (not 409) ───
  // US-04
  it("prompt is delivered via adapter instead of returning 409", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a spawned sandbox session
    const user = await createTestUser(baseUrl, `hp2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement caching layer",
      description: "Add Redis caching to entity queries",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the developer sends a prompt to the session
    const promptResponse = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Implement the caching layer with TTL support",
    );

    // Then the prompt is accepted (not 409 Conflict)
    expect(promptResponse.status).not.toBe(409);
    expect(promptResponse.ok).toBe(true);
  }, 30_000);

  // ─── HP-3: Session record has sandbox fields ───
  // US-02
  it("session record has session_type and external_session_id after spawn", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a spawned sandbox session
    const user = await createTestUser(baseUrl, `hp3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add API documentation",
      description: "Generate OpenAPI spec from route handlers",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the session record is queried from SurrealDB
    const dbSession = await querySessionFromDb(surreal, assignment.agentSessionId);

    // Then it has session_type "sandbox_agent"
    expect(dbSession).toBeDefined();
    expect(dbSession!.session_type).toBe("sandbox_agent");

    // And has an external_session_id from the adapter
    expect(dbSession!.external_session_id).toBeTruthy();

    // And has a provider field
    expect(dbSession!.provider).toBe("local");
  }, 30_000);

  // ─── HP-6: Session marked completed after accept ───
  // US-01
  it("session is marked completed after developer accepts the work", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a sandbox session that has been working
    const user = await createTestUser(baseUrl, `hp6-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Write unit tests",
      description: "Add tests for the rate limiter module",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Simulate session reaching idle state for accept
    await surreal.query(
      `UPDATE $record SET orchestrator_status = "idle";`,
      { record: new RecordId("agent_session", assignment.agentSessionId) },
    );

    // When the developer accepts the completed work
    const acceptResponse = await fetch(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${assignment.agentSessionId}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
      },
    );

    // Then the work is accepted
    expect(acceptResponse.ok).toBe(true);

    // And the session is marked as completed in SurrealDB
    const dbSession = await querySessionFromDb(surreal, assignment.agentSessionId);
    expect(dbSession!.orchestrator_status).toBe("completed");
  }, 30_000);
});

// =============================================================================
// Error Path Scenarios
// =============================================================================

describe("Error Paths: Sandbox Session Failures", () => {
  // ─── EP-1: Spawn fails when SandboxAgent server is unavailable ───
  // US-01
  it.skip("spawn returns error when SandboxAgent server is unavailable", async () => {
    // This test requires a configuration override to point at a non-existent server
    const { baseUrl, surreal } = getRuntime();

    // Given the SandboxAgent server is not running
    // (configured to connect to unreachable address)
    const user = await createTestUser(baseUrl, `ep1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "This task should fail to assign",
      description: "Testing error handling when server is down",
    });

    // When the developer attempts to assign the task
    const response = await fetch(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId }),
      },
    );

    // Then the response indicates the server is unavailable
    expect(response.ok).toBe(false);
    const body = await response.json();
    expect((body as { error?: string }).error).toContain("unavailable");
  }, 15_000);

  // ─── EP-2: No partial session record after failed spawn ───
  // US-01
  it.skip("no orphaned session records exist in SurrealDB after a failed spawn", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a spawn that fails due to server unavailability
    const user = await createTestUser(baseUrl, `ep2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Orphan check task",
      description: "Verifying no partial records on failure",
    });

    // When the spawn fails
    await fetch(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId }),
      },
    );

    // Then no orphaned session records exist for this task
    const [sessions] = await surreal.query<[Array<Record<string, unknown>>]>(
      `SELECT * FROM agent_session WHERE workspace = $ws AND session_type = "sandbox_agent";`,
      { ws: new RecordId("workspace", workspace.workspaceId) },
    );

    // No sessions should exist (spawn was cleaned up)
    const orphaned = sessions.filter(
      (s) => s.orchestrator_status === "spawning",
    );
    expect(orphaned.length).toBe(0);
  }, 15_000);

  // ─── EP-3: Prompt to concluded session returns 404 ───
  // US-04
  it.skip("prompt to a completed session returns 404", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session that has been completed
    const user = await createTestUser(baseUrl, `ep3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Completed task",
      description: "Session already done",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Mark session as completed
    await surreal.query(
      `UPDATE $record SET orchestrator_status = "completed", ended_at = time::now();`,
      { record: new RecordId("agent_session", assignment.agentSessionId) },
    );

    // When the developer sends a prompt to the completed session
    const response = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "This should fail",
    );

    // Then the response is 404
    expect(response.status).toBe(404);
  }, 15_000);

  // ─── EP-4: Prompt to non-existent session returns 404 ───
  // US-04
  it.skip("prompt to a non-existent session returns 404", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session ID that does not exist
    const user = await createTestUser(baseUrl, `ep4-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const nonExistentSessionId = crypto.randomUUID();

    // When a prompt is sent to the non-existent session
    const response = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      nonExistentSessionId,
      "This session does not exist",
    );

    // Then the response is 404
    expect(response.status).toBe(404);
  }, 15_000);

  // ─── EP-5: Spawn with invalid workspace returns error ───
  // US-01
  it.skip("spawn with non-existent workspace returns authorization error", async () => {
    const { baseUrl } = getRuntime();

    // Given a workspace ID that does not exist
    const user = await createTestUser(baseUrl, `ep5-${crypto.randomUUID()}`);
    const fakeWorkspaceId = crypto.randomUUID();

    // When the developer attempts to assign a task in the invalid workspace
    const response = await fetch(
      `${baseUrl}/api/orchestrator/${fakeWorkspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: crypto.randomUUID() }),
      },
    );

    // Then the response indicates an authorization or not-found error
    expect(response.ok).toBe(false);
    expect([401, 403, 404]).toContain(response.status);
  }, 15_000);
});

// =============================================================================
// Edge Case Scenarios
// =============================================================================

describe("Edge Cases: Sandbox Session Boundaries", () => {
  // ─── EC-1: Concurrent prompt during active processing ───
  // US-04
  it.skip("concurrent prompt during processing returns 202 Accepted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active session currently processing a prompt
    const user = await createTestUser(baseUrl, `ec1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user, surreal);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Long-running implementation",
      description: "A task that takes time to process",
    });

    const assignment = await assignTaskToSandboxAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Send first prompt (agent is now processing)
    await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Start implementing the feature",
    );

    // When a second prompt is sent while the first is still processing
    const concurrentResponse = await sendPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Also add error handling",
    );

    // Then the response is 202 Accepted (queued, not rejected)
    expect([200, 202]).toContain(concurrentResponse.status);
    expect(concurrentResponse.status).not.toBe(409);
  }, 30_000);

  // ─── EC-2: Session restoration after server restart ───
  // US-05
  it.skip("active sessions are discoverable from SurrealDB after server restart", async () => {
    const { surreal } = getRuntime();

    // Given an active sandbox session record in SurrealDB
    const sessionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const workspaceRecord = new RecordId("workspace", workspaceId);

    // Create workspace for the session
    await surreal.query(`CREATE $ws CONTENT $content;`, {
      ws: workspaceRecord,
      content: {
        name: "Restoration Test Workspace",
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: new Date(),
        created_at: new Date(),
      },
    });

    // Create agent_session record as if it was running before restart
    await surreal.query(`CREATE $record CONTENT $content;`, {
      record: new RecordId("agent_session", sessionId),
      content: {
        workspace: workspaceRecord,
        agent: "claude",
        session_type: "sandbox_agent",
        provider: "local",
        orchestrator_status: "running",
        external_session_id: "runtime-abc-123",
        created_at: new Date(),
        started_at: new Date(),
      },
    });

    // When active sandbox sessions are queried (as server startup would do)
    const [sessions] = await surreal.query<[Array<Record<string, unknown>>]>(
      `SELECT * FROM agent_session WHERE session_type = "sandbox_agent" AND orchestrator_status IN ["running", "idle"];`,
    );

    // Then the session is found for restoration
    const found = sessions.find((s) => {
      const id = s.id as { id: string };
      return id.id === sessionId;
    });
    expect(found).toBeDefined();
    expect(found!.external_session_id).toBe("runtime-abc-123");
    expect(found!.provider).toBe("local");
  }, 15_000);
});
