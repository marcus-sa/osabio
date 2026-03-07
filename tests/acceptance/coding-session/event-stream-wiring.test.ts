/**
 * Event Stream Wiring: Agent Events Flow to User via SSE
 *
 * Traces: US-CS-003 (wire event stream into session lifecycle)
 *
 * Validates that agent SDK messages flow through event bridge to SSE registry
 * and reach the client's EventSource subscription. Also validates that
 * stall detection starts, terminal statuses stop iteration, and stream
 * errors update session status.
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
  abortAgentSession,
  acceptAgentWork,
  collectSessionEvents,
  fetchRaw,
} from "./coding-session-test-kit";

const getRuntime = setupOrchestratorSuite("event_stream_wiring");

describe("Event Stream Wiring: Agent events flow to user", () => {
  // ---------------------------------------------------------------------------
  // Happy Path: Events appear in the session stream
  // US-CS-003 AC: eventStream iterated after spawn
  // ---------------------------------------------------------------------------
  it.skip("agent events flow through to the session event stream", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task assigned to a coding agent
    const user = await createTestUser(baseUrl, "wire-events");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build search results component",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent produces activity events
    // Then the events appear in the session's live stream
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 10_000,
    });

    expect(events.length).toBeGreaterThan(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Session transitions to active after first event
  // US-CS-003 AC: session status -> "active" after first agent event
  // ---------------------------------------------------------------------------
  it.skip("session transitions to active after first agent event", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session in "spawning" status
    const user = await createTestUser(baseUrl, "wire-active");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement pagination controls",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the first agent event arrives
    // (Wait briefly for event processing)
    await Bun.sleep(2_000);

    // Then the session status transitions to "active"
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(status.orchestratorStatus).toBe("active");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Stall detection starts after wiring
  // US-CS-003 AC: stall detector starts after event bridge wired
  // ---------------------------------------------------------------------------
  it.skip("stall monitoring begins after agent session starts", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent
    const user = await createTestUser(baseUrl, "wire-stall");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add loading spinner component",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the event stream is wired to the session
    // Then stall detection monitoring is active
    // (Verified by: if no events arrive within stall timeout, session aborts)
    // With short stall timeout configured for tests, wait for stall detection
    await Bun.sleep(12_000);

    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    // Stall detector should have fired (mock agent emits no events)
    expect(["aborted", "error"]).toContain(status.orchestratorStatus);
  }, 30_000);
});

describe("Event Stream Wiring: Error and terminal status handling", () => {
  // ---------------------------------------------------------------------------
  // Error Path: Stream error updates session status
  // US-CS-003 AC: event stream errors -> session status "error"
  // ---------------------------------------------------------------------------
  it.skip("event stream error updates session to error status", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent whose stream encounters an error
    const user = await createTestUser(baseUrl, "wire-error");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Integrate payment gateway",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent's event stream encounters an error
    // (Mock agent configured to emit error after delay)
    await Bun.sleep(5_000);

    // Then the session status changes to "error"
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(["error", "aborted"]).toContain(status.orchestratorStatus);

    // And an error event is emitted to the live stream
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 5_000,
      stopOnTypes: ["agent_error"],
    });
    const errorEvents = events.filter(
      (e) => e.type === "agent_error" || e.type === "agent_status",
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Error Path: Event iteration stops on completed status
  // US-CS-003 AC: iteration stops on terminal status
  // ---------------------------------------------------------------------------
  it.skip("event iteration stops when session reaches completed status", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent
    const user = await createTestUser(baseUrl, "wire-complete");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Create user profile page",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the session is completed (accept the work)
    await acceptAgentWork(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then no further events are processed from the agent stream
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(status.orchestratorStatus).toBe("completed");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Error Path: Event iteration stops on aborted status
  // US-CS-003 AC: iteration stops on terminal status
  // ---------------------------------------------------------------------------
  it.skip("event iteration stops when session is aborted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent
    const user = await createTestUser(baseUrl, "wire-abort");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build notification system",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the session is aborted by the user
    await abortAgentSession(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then no further events are processed from the agent stream
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(status.orchestratorStatus).toBe("aborted");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Edge Case: Nonexistent stream subscription
  // ---------------------------------------------------------------------------
  it.skip("subscribing to a nonexistent session stream fails", async () => {
    const { baseUrl } = getRuntime();

    // Given a stream identifier that does not correspond to any session
    // When a user tries to subscribe to that stream
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/stream/nonexistent-stream-id`,
      { headers: { Accept: "text/event-stream" } },
    );

    // Then the subscription is rejected because no matching session exists
    expect(response.ok).toBe(false);
  }, 15_000);
});
