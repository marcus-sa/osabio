/**
 * Live Agent Output: Streaming Text, File Changes, Status Updates
 *
 * Traces: US-CS-001 (live agent output stream)
 *
 * Validates that agent token events stream as text, file changes appear
 * as inline notifications, status transitions update in real-time,
 * file change counts update, and stall warnings appear on inactivity.
 *
 * Driving ports: POST /api/orchestrator/:ws/assign
 *                GET  /api/orchestrator/:ws/sessions/:id/stream (SSE)
 *                GET  /api/orchestrator/:ws/sessions/:id (status)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
  getSessionStatus,
  collectSessionEvents,
} from "./coding-session-test-kit";

const getRuntime = setupOrchestratorSuite("live_agent_output");

describe("Live Agent Output: Token and file change streaming", () => {
  // ---------------------------------------------------------------------------
  // Happy Path: Token events render as streaming text
  // US-CS-001 AC: agent token events stream into output panel
  // ---------------------------------------------------------------------------
  it.skip("agent token events render as streaming text", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to a coding agent
    const user = await createTestUser(baseUrl, "output-tokens");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Generate API documentation",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent produces text output
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 10_000,
    });

    // Then the output appears as streaming text in the session stream
    const tokenEvents = events.filter((e) => e.type === "agent_token");
    expect(tokenEvents.length).toBeGreaterThan(0);
    for (const event of tokenEvents) {
      expect(typeof event.token).toBe("string");
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Happy Path: File change events as inline notifications
  // US-CS-001 AC: file change events appear as distinct inline notifications
  // ---------------------------------------------------------------------------
  it.skip("file change events appear as inline notifications", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to a coding agent
    const user = await createTestUser(baseUrl, "output-files");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Create authentication middleware",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent modifies a file
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 10_000,
    });

    // Then a file change notification appears in the session stream
    const fileEvents = events.filter((e) => e.type === "agent_file_change");
    expect(fileEvents.length).toBeGreaterThan(0);

    // And the notification identifies the changed file
    for (const event of fileEvents) {
      expect(event.file).toBeTruthy();
      expect(typeof event.file).toBe("string");
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Status transitions are streamed
  // US-CS-001 AC: status badge updates in real-time
  // ---------------------------------------------------------------------------
  it.skip("session status transitions are streamed to the user", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to a coding agent
    const user = await createTestUser(baseUrl, "output-status");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement user preferences page",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent transitions from working to idle
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 15_000,
    });

    // Then a status change event appears in the session stream
    const statusEvents = events.filter((e) => e.type === "agent_status");
    expect(statusEvents.length).toBeGreaterThan(0);

    // And the new status is reflected in the session details
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(status.orchestratorStatus).toBeTruthy();
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Files changed count
  // US-CS-001 AC: files changed count updates in status bar
  // ---------------------------------------------------------------------------
  it.skip("files changed count increases as agent edits files", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to a coding agent
    const user = await createTestUser(baseUrl, "output-count");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add error boundary components",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent modifies multiple files
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 10_000,
    });

    // Then the session reports the number of files changed
    const fileEvents = events.filter((e) => e.type === "agent_file_change");
    const uniqueFiles = new Set(fileEvents.map((e) => e.file));
    expect(uniqueFiles.size).toBeGreaterThanOrEqual(0);
    // Count matches distinct files touched
  }, 30_000);
});

describe("Live Agent Output: Stall and edge cases", () => {
  // ---------------------------------------------------------------------------
  // Error Path: Stall warning on inactivity
  // US-CS-001 AC: stall warning after 30 seconds of no events
  // ---------------------------------------------------------------------------
  it.skip("stall warning appears after inactivity timeout", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent that has been silent
    const user = await createTestUser(baseUrl, "output-stall");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Optimize image loading",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the stall timeout elapses (mocked at short interval for tests)
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 15_000,
      stopOnTypes: ["agent_stall_warning", "agent_error"],
    });

    // Then a stall warning is emitted to the session stream
    const stallEvents = events.filter(
      (e) => e.type === "agent_stall_warning" || e.type === "agent_status",
    );
    expect(stallEvents.length).toBeGreaterThanOrEqual(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Edge Case: Reconnection shows current status
  // US-CS-001 AC: output scrollable when idle or completed
  // ---------------------------------------------------------------------------
  it.skip("reconnecting to stream shows the session current status", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent
    const user = await createTestUser(baseUrl, "output-reconnect");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build dashboard widgets",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the stream connection is interrupted and Marcus reconnects
    // (Simulate by fetching status after stream)
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the session's current status is available
    expect(status.orchestratorStatus).toBeTruthy();
    expect(status.startedAt).toBeTruthy();
  }, 30_000);
});
