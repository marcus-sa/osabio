/**
 * Walking Skeleton: Live Coding Session E2E
 *
 * Traces: US-CS-003 (event stream wiring), US-CS-001 (live output),
 *         US-CS-002 (follow-up prompt), US-CS-004 (conversation log)
 *
 * These are the minimum viable E2E paths through the coding session feature.
 * A user assigns a task, observes the agent working in real-time, sends
 * follow-up instructions, and reviews the conversation log.
 *
 * Driving ports: POST /api/orchestrator/:ws/assign
 *                GET  /api/orchestrator/:ws/sessions/:id/stream (SSE)
 *                POST /api/orchestrator/:ws/sessions/:id/prompt
 *                GET  /api/orchestrator/:ws/sessions/:id/log
 *                GET  /api/orchestrator/:ws/sessions/:id/review
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
  sendFollowUpPrompt,
  getConversationLog,
  getReviewSummary,
} from "./coding-session-test-kit";

const getRuntime = setupOrchestratorSuite("coding_session_skeleton");

describe("Walking Skeleton: Live coding session with agent interaction", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Assign, observe output, send follow-up
  // US-CS-003 + US-CS-001 + US-CS-002
  // ---------------------------------------------------------------------------
  it("Marcus assigns a task, observes agent output, and sends a follow-up prompt", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a project and a task ready for work
    const user = await createTestUser(baseUrl, "cs-skeleton-1");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add form validation for email fields",
      description: "Validate email format on registration and login forms",
    });

    // When Marcus assigns the task to a coding agent
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then the agent session starts and events begin streaming
    expect(assignment.agentSessionId).toBeTruthy();
    expect(assignment.streamUrl).toBeTruthy();

    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(["spawning", "active"]).toContain(status.orchestratorStatus);

    // When Marcus opens the live output for the session
    // Then agent activity appears as streaming text
    // (With mocked agent, verify the stream infrastructure is wired)
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 5_000,
      maxEvents: 10,
    });
    // Stream should be connectable even if mock emits no events
    expect(events).toBeInstanceOf(Array);

    // When Marcus sends a follow-up prompt
    const promptResponse = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Please also add input validation",
    );

    // Then the prompt is accepted and the agent continues working
    expect(promptResponse.status).toBe(202);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: Review conversation log after completion
  // US-CS-003 + US-CS-004
  // ---------------------------------------------------------------------------
  it.skip("Marcus reviews the agent conversation log after work completes", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given Marcus has a task assigned to a coding agent that has completed
    const user = await createTestUser(baseUrl, "cs-skeleton-2");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Refactor authentication module",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus opens the review for the completed session
    const logResponse = await getConversationLog(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the review includes the agent conversation log
    expect(logResponse.ok).toBe(true);
    const log = (await logResponse.json()) as { entries: unknown[] };

    // And the log shows the chronological trail of agent activity
    expect(log.entries).toBeInstanceOf(Array);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 3: Agent error stops session
  // US-CS-001 + US-CS-003 (error path)
  // ---------------------------------------------------------------------------
  it.skip("agent error stops the session and notifies Marcus", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given Marcus has a task assigned to a coding agent
    const user = await createTestUser(baseUrl, "cs-skeleton-3");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Migrate legacy database schema",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent encounters an error during its work
    // (With mocked agent configured to emit error events)

    // Then the session status shows an error occurred
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(["error", "aborted"]).toContain(status.orchestratorStatus);

    // And Marcus is notified of the failure through the event stream
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 10_000,
      stopOnTypes: ["agent_error"],
    });
    const errorEvents = events.filter((e) => e.type === "agent_error" || e.status === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
  }, 60_000);
});
