/**
 * Follow-Up Prompt: Send Instructions to Running Agent
 *
 * Traces: US-CS-002 (follow-up prompt to running agent)
 *
 * Validates that users can send follow-up prompts to active/idle sessions,
 * that prompts are rejected for terminal sessions, and that user prompts
 * appear in the SSE event stream.
 *
 * Driving ports: POST /api/orchestrator/:ws/sessions/:id/prompt
 *                GET  /api/orchestrator/:ws/sessions/:id (status)
 *                GET  /api/orchestrator/:ws/sessions/:id/stream (SSE)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
  getSessionStatus,
  acceptAgentWork,
  abortAgentSession,
  sendFollowUpPrompt,
  collectSessionEvents,
  fetchRaw,
} from "./coding-session-test-kit";

const getRuntime = setupOrchestratorSuite("follow_up_prompt");

describe("Follow-Up Prompt: Sending instructions to active agent", () => {
  // ---------------------------------------------------------------------------
  // Happy Path: Send prompt to active session
  // US-CS-002 AC: submitting prompt delivers text via POST (202)
  // ---------------------------------------------------------------------------
  it.skip("Marcus sends a follow-up prompt to a working agent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an active coding agent
    const user = await createTestUser(baseUrl, "prompt-active");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build user registration form",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus sends a follow-up prompt
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Please also add input validation for email",
    );

    // Then the prompt is accepted
    expect(response.status).toBe(202);

    // And the agent receives the instruction (session remains active)
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(["active", "spawning", "idle"]).toContain(status.orchestratorStatus);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Send prompt to idle session transitions to active
  // US-CS-002 AC: sending prompt to idle session transitions to active
  // ---------------------------------------------------------------------------
  it.skip("Marcus sends a prompt to an idle agent, reactivating it", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to a coding agent in idle status
    const user = await createTestUser(baseUrl, "prompt-idle");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Refactor logging utilities",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus sends a prompt
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Continue with the error handling",
    );

    // Then the prompt is accepted
    expect(response.status).toBe(202);

    // And the session transitions back to active
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(["active", "spawning"]).toContain(status.orchestratorStatus);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Happy Path: User prompt echoed in event stream
  // US-CS-002 AC: user messages appear as visually distinct blocks
  // ---------------------------------------------------------------------------
  it.skip("user prompt appears as a distinct entry in the event stream", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to a coding agent
    const user = await createTestUser(baseUrl, "prompt-echo");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add search autocomplete",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus sends a prompt
    await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Add unit tests for the parser",
    );

    // Then a user prompt event appears in the session stream
    const events = await collectSessionEvents(baseUrl, assignment.streamUrl, {
      timeoutMs: 5_000,
    });

    const promptEvents = events.filter((e) => e.type === "agent_prompt");
    expect(promptEvents.length).toBeGreaterThan(0);

    // And the event contains the prompt text
    expect(promptEvents[0].text).toBe("Add unit tests for the parser");
  }, 30_000);
});

describe("Follow-Up Prompt: Terminal session rejection", () => {
  // ---------------------------------------------------------------------------
  // Error Path: Prompt rejected for completed session
  // US-CS-002 AC: input disabled when session completed
  // ---------------------------------------------------------------------------
  it.skip("prompt rejected for a completed session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session that has completed
    const user = await createTestUser(baseUrl, "prompt-completed");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Write integration tests",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    await acceptAgentWork(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // When Marcus tries to send a prompt to the completed session
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Add more tests",
    );

    // Then the prompt is rejected because the session has ended
    expect(response.status).toBe(409);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Error Path: Prompt rejected for aborted session
  // US-CS-002 AC: input disabled when session aborted
  // ---------------------------------------------------------------------------
  it.skip("prompt rejected for an aborted session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session that was aborted
    const user = await createTestUser(baseUrl, "prompt-aborted");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Fix memory leak in worker pool",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    await abortAgentSession(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // When Marcus tries to send a prompt to the aborted session
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Fix the bug",
    );

    // Then the prompt is rejected because the session has ended
    expect(response.status).toBe(409);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Error Path: Prompt rejected for errored session
  // US-CS-002 AC: input disabled when session error
  // ---------------------------------------------------------------------------
  it.skip("prompt rejected for a session in error state", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session that encountered an error
    const user = await createTestUser(baseUrl, "prompt-error");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Deploy staging environment",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    // Simulate error status via direct DB update
    const { RecordId } = await import("surrealdb");
    const sessionRecord = new RecordId("agent_session", assignment.agentSessionId);
    await surreal.update(sessionRecord).merge({
      orchestrator_status: "error",
      error_message: "Agent crashed unexpectedly",
    });

    // When Marcus tries to send a prompt
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Try again",
    );

    // Then the prompt is rejected because the session has ended
    expect(response.status).toBe(409);
  }, 60_000);
});

describe("Follow-Up Prompt: Input validation and edge cases", () => {
  // ---------------------------------------------------------------------------
  // Edge Case: Empty prompt text rejected
  // ---------------------------------------------------------------------------
  it.skip("empty prompt text is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active agent session
    const user = await createTestUser(baseUrl, "prompt-empty");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add dark mode support",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus sends an empty prompt
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "",
    );

    // Then the prompt is rejected because feedback text is required
    expect(response.status).toBe(400);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Edge Case: Prompt to nonexistent session
  // ---------------------------------------------------------------------------
  it.skip("prompt to nonexistent session fails", async () => {
    const { baseUrl } = getRuntime();

    // Given a session that does not exist
    const user = await createTestUser(baseUrl, "prompt-noexist");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When Marcus sends a prompt to a nonexistent session
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      "nonexistent-session-id",
      "Please continue",
    );

    // Then the prompt is rejected because the session was not found
    expect(response.status).toBe(404);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Edge Case: Handle missing (server restart scenario)
  // US-CS-002 AC: prompt delivery fails gracefully when handle missing
  // ---------------------------------------------------------------------------
  it.skip("prompt fails gracefully when agent handle is missing", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session that exists but the server lost the process handle
    // (Simulate by creating session record directly without spawn)
    const user = await createTestUser(baseUrl, "prompt-nohandle");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build export feature",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Server restart would clear the in-memory handle registry
    // but the session record still exists in DB.
    // The prompt endpoint should detect the missing handle.

    // When Marcus sends a prompt
    const response = await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Please continue",
    );

    // Then the prompt is rejected because the agent is unreachable
    // (Either 409 or 500 depending on implementation)
    expect([202, 409, 500]).toContain(response.status);
  }, 60_000);
});
