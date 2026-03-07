/**
 * Contextual Review: Diff + Agent Conversation Log
 *
 * Traces: US-CS-004 (contextual review with agent conversation log)
 *
 * Validates that the review page provides the conversation log alongside
 * the code diff, that user prompts appear as distinct entries, that file
 * changes are in the log, and that rejection feedback flows back to the
 * agent.
 *
 * Driving ports: GET  /api/orchestrator/:ws/sessions/:id/review
 *                GET  /api/orchestrator/:ws/sessions/:id/log
 *                POST /api/orchestrator/:ws/sessions/:id/reject
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
  acceptAgentWork,
  abortAgentSession,
  rejectWithFeedback,
  getReviewSummary,
  getConversationLog,
  sendFollowUpPrompt,
  fetchRaw,
  getTaskStatus,
} from "./coding-session-test-kit";
import type { ConversationLogEntry } from "./coding-session-test-kit";

const getRuntime = setupOrchestratorSuite("contextual_review");

describe("Contextual Review: Conversation log in review", () => {
  // ---------------------------------------------------------------------------
  // Happy Path: Review includes conversation log
  // US-CS-004 AC: Agent Log displays full chronological trail
  // ---------------------------------------------------------------------------
  it.skip("review provides the conversation log in chronological order", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task where the agent has completed work
    const user = await createTestUser(baseUrl, "review-log");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement password reset flow",
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

    // Then the review provides the conversation log
    expect(logResponse.ok).toBe(true);
    const log = (await logResponse.json()) as { entries: ConversationLogEntry[] };
    expect(log.entries).toBeInstanceOf(Array);

    // And the log entries are in chronological order
    for (let i = 1; i < log.entries.length; i++) {
      const prev = new Date(log.entries[i - 1].timestamp).getTime();
      const curr = new Date(log.entries[i].timestamp).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Happy Path: User prompts as distinct entries
  // US-CS-004 AC: user prompts visually distinct from agent output
  // ---------------------------------------------------------------------------
  it.skip("agent log shows user prompts as distinct entries", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session where Marcus sent a follow-up prompt
    const user = await createTestUser(baseUrl, "review-prompts");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add two-factor authentication",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Marcus sent a follow-up during the session
    await sendFollowUpPrompt(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Please also handle the TOTP recovery flow",
    );

    // When Marcus views the conversation log
    const logResponse = await getConversationLog(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    const log = (await logResponse.json()) as { entries: ConversationLogEntry[] };

    // Then user prompts appear as a separate entry type from agent output
    const promptEntries = log.entries.filter((e) => e.entryType === "user_prompt");
    expect(promptEntries.length).toBeGreaterThan(0);
    expect(promptEntries[0].content).toBe("Please also handle the TOTP recovery flow");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Happy Path: File changes in the log
  // US-CS-004 AC: file change notifications inline with file names
  // ---------------------------------------------------------------------------
  it.skip("file change notifications appear in the conversation log", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given the agent modified files during its work
    const user = await createTestUser(baseUrl, "review-files");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Create admin dashboard layout",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus views the conversation log
    const logResponse = await getConversationLog(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    const log = (await logResponse.json()) as { entries: ConversationLogEntry[] };

    // Then file change entries appear in the log
    const fileEntries = log.entries.filter((e) => e.entryType === "file_change");

    // And each file change entry identifies the file that was changed
    for (const entry of fileEntries) {
      expect(entry.file).toBeTruthy();
      expect(typeof entry.file).toBe("string");
    }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Session metadata in review
  // US-CS-004 AC: session metadata (duration, files changed) in review header
  // ---------------------------------------------------------------------------
  it.skip("review includes session metadata", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a completed session
    const user = await createTestUser(baseUrl, "review-meta");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement data export to CSV",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus opens the review
    const review = await getReviewSummary(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the review shows when the session started
    expect(review.session.startedAt).toBeTruthy();

    // And the review shows the session's final status
    expect(review.session.orchestratorStatus).toBeTruthy();
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Session without user prompts
  // US-CS-004: review for session with no user intervention
  // ---------------------------------------------------------------------------
  it.skip("log contains only agent output when no user prompts were sent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given the agent completed without any user prompts
    const user = await createTestUser(baseUrl, "review-noprompt");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Fix date formatting bug",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus views the conversation log
    const logResponse = await getConversationLog(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    const log = (await logResponse.json()) as { entries: ConversationLogEntry[] };

    // Then no user prompt entries appear in the log
    const promptEntries = log.entries.filter((e) => e.entryType === "user_prompt");
    expect(promptEntries.length).toBe(0);
  }, 60_000);
});

describe("Contextual Review: Error paths and edge cases", () => {
  // ---------------------------------------------------------------------------
  // Error Path: Log for nonexistent session
  // ---------------------------------------------------------------------------
  it.skip("conversation log for nonexistent session fails", async () => {
    const { baseUrl } = getRuntime();

    // Given a session that does not exist
    const user = await createTestUser(baseUrl, "review-noexist");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When Marcus requests the log
    const response = await getConversationLog(
      baseUrl,
      user,
      workspace.workspaceId,
      "nonexistent-session-id",
    );

    // Then the request fails because the session was not found
    expect(response.status).toBe(404);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Edge Case: Log for aborted session
  // ---------------------------------------------------------------------------
  it.skip("conversation log available for aborted session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session that was aborted before completion
    const user = await createTestUser(baseUrl, "review-aborted");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Migrate to new ORM",
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

    // When Marcus views the conversation log
    const logResponse = await getConversationLog(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the log shows activity up to the point of abort
    expect(logResponse.ok).toBe(true);
    const log = (await logResponse.json()) as { entries: ConversationLogEntry[] };
    expect(log.entries).toBeInstanceOf(Array);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Happy Path: Reject with feedback informed by log
  // US-CS-004 AC: reject includes feedback textarea
  // ---------------------------------------------------------------------------
  it.skip("reject feedback is delivered to the agent and session resumes", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a completed session Marcus is reviewing
    const user = await createTestUser(baseUrl, "review-reject");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build user notification preferences",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When Marcus rejects the work with feedback
    const result = await rejectWithFeedback(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Missing error handling in auth module",
    );

    // Then the rejection is accepted
    expect(result.rejected).toBe(true);

    // And the feedback is delivered to the agent
    expect(result.continuing).toBe(true);

    // And the session resumes with the agent working
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(status.orchestratorStatus).toBe("active");
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Edge Case: Log updates after rejection
  // US-CS-004: reject then view updated log
  // ---------------------------------------------------------------------------
  it.skip("conversation log includes rejection feedback as user prompt", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given Marcus rejected the work with feedback
    const user = await createTestUser(baseUrl, "review-rejectlog");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement rate limiting",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    await rejectWithFeedback(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Add input validation",
    );

    // When Marcus views the updated conversation log
    const logResponse = await getConversationLog(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    const log = (await logResponse.json()) as { entries: ConversationLogEntry[] };

    // Then the log includes the rejection feedback as a user prompt entry
    const feedbackEntries = log.entries.filter(
      (e) => e.entryType === "user_prompt" && e.content === "Add input validation",
    );
    expect(feedbackEntries.length).toBe(1);
  }, 60_000);
});
