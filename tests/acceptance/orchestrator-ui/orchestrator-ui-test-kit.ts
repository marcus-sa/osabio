/**
 * Orchestrator UI Acceptance Test Kit
 *
 * Extends the orchestrator-test-kit with UI-surface-specific helpers.
 * Tests invoke through the same HTTP driving ports as backend tests,
 * but assert UI-observable outcomes (feed items, review data, session status).
 *
 * Driving ports used:
 *   - POST /api/orchestrator/:ws/assign (assign task to agent)
 *   - GET  /api/orchestrator/:ws/sessions/:id (session status)
 *   - GET  /api/orchestrator/:ws/sessions/:id/review (review data)
 *   - POST /api/orchestrator/:ws/sessions/:id/accept (accept work)
 *   - POST /api/orchestrator/:ws/sessions/:id/reject (reject with feedback)
 *   - POST /api/orchestrator/:ws/sessions/:id/abort (abort session)
 *   - GET  /api/workspaces/:ws/feed (governance feed)
 *   - GET  /api/entities/:entityId (entity detail for task popup)
 */

import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestProject,
  assignTaskToAgent,
  getSessionStatus,
  acceptAgentWork,
  rejectWithFeedback,
  abortAgentSession,
  getReviewSummary,
  getTaskStatus,
  fetchJson,
  fetchRaw,
  type OrchestratorTestRuntime,
  type TestUser,
  type TestWorkspace,
  type TestTask,
  type TestProject,
  type AssignmentResponse,
  type SessionStatusResponse,
  type ReviewResponse,
} from "../coding-agent-orchestrator/orchestrator-test-kit";
import type {
  GovernanceFeedResponse,
  GovernanceFeedItem,
  EntityDetailResponse,
} from "../../../app/src/shared/contracts";

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestProject,
  assignTaskToAgent,
  getSessionStatus,
  acceptAgentWork,
  rejectWithFeedback,
  abortAgentSession,
  getReviewSummary,
  getTaskStatus,
  fetchJson,
  fetchRaw,
};

export type {
  OrchestratorTestRuntime,
  TestUser,
  TestWorkspace,
  TestTask,
  TestProject,
  AssignmentResponse,
  SessionStatusResponse,
  ReviewResponse,
};

// ---------------------------------------------------------------------------
// Surface 1: Task Popup Helpers
// ---------------------------------------------------------------------------

/**
 * Fetches entity detail for a task (simulates opening the task popup).
 * This is the driving port for Surface 1.
 */
export async function openTaskPopup(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  taskId: string,
): Promise<EntityDetailResponse> {
  const entityId = `task:${taskId}`;
  return fetchJson<EntityDetailResponse>(
    `${baseUrl}/api/entities/${encodeURIComponent(entityId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers: user.headers },
  );
}

/**
 * Checks whether the task popup would show an assign button.
 * Business rule: assign button visible when task status is "open", "ready", or "todo"
 * and no active agent session exists.
 */
export function isAssignButtonVisible(
  detail: EntityDetailResponse,
): boolean {
  const status = detail.entity.data.status as string | undefined;
  const hasActiveSession = detail.agentSession !== undefined;
  return (
    detail.entity.kind === "task" &&
    (status === "open" || status === "ready" || status === "todo") &&
    !hasActiveSession
  );
}

/**
 * Checks whether the task popup would show a review button.
 * Business rule: review button visible when agent session is idle.
 */
export function isReviewButtonVisible(
  detail: EntityDetailResponse,
): boolean {
  return detail.agentSession?.orchestratorStatus === "idle";
}

/**
 * Extracts the agent status badge text from entity detail.
 */
export function getAgentBadgeText(
  detail: EntityDetailResponse,
): string | undefined {
  const session = detail.agentSession;
  if (!session) return undefined;

  const statusMap: Record<string, string> = {
    spawning: "Starting agent...",
    active: "Agent working",
    idle: "Review ready",
    completed: "Agent done",
    error: "Agent error",
    aborted: "Aborted",
  };
  return statusMap[session.orchestratorStatus];
}

/**
 * Extracts file change count from entity detail agent session data.
 */
export function getFileChangeCount(
  detail: EntityDetailResponse,
): number {
  return detail.agentSession?.filesChangedCount ?? 0;
}

// ---------------------------------------------------------------------------
// Surface 2: Governance Feed Helpers
// ---------------------------------------------------------------------------

/**
 * Fetches the governance feed (simulates viewing the feed panel).
 * This is the driving port for Surface 2.
 */
export async function getGovernanceFeed(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
): Promise<GovernanceFeedResponse> {
  return fetchJson<GovernanceFeedResponse>(
    `${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/feed`,
    { headers: user.headers },
  );
}

/**
 * Finds a feed item matching a task name across all tiers.
 */
export function findFeedItemForTask(
  feed: GovernanceFeedResponse,
  taskName: string,
): { item: GovernanceFeedItem; tier: string } | undefined {
  for (const [tier, items] of Object.entries(feed)) {
    if (tier === "updatedAt") continue;
    for (const item of items as GovernanceFeedItem[]) {
      if (item.entityName === taskName || item.reason.includes(taskName)) {
        return { item, tier };
      }
    }
  }
  return undefined;
}

/**
 * Checks that a feed item has the expected actions.
 */
export function feedItemHasActions(
  item: GovernanceFeedItem,
  expectedActions: string[],
): boolean {
  const actionLabels = item.actions.map((a) => a.label);
  return expectedActions.every((ea) => actionLabels.includes(ea));
}

/**
 * Extracts the agent session ID from a feed item (for navigation to review view).
 */
export function getSessionIdFromFeedItem(
  item: GovernanceFeedItem,
): string | undefined {
  // The agentSessionId will be added as metadata on agent-related feed items
  return (item as GovernanceFeedItem & { agentSessionId?: string })
    .agentSessionId;
}

// ---------------------------------------------------------------------------
// Surface 3: Agent Review View Helpers
// ---------------------------------------------------------------------------

/**
 * Opens the review view by fetching review data (simulates navigating
 * to /workspace/:ws/review/:sessionId).
 * This is the driving port for Surface 3.
 */
export async function openReviewView(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
): Promise<ReviewResponse> {
  return getReviewSummary(baseUrl, user, workspaceId, sessionId);
}

/**
 * Asserts review data contains expected content for a task.
 */
export function reviewShowsTaskContent(
  review: ReviewResponse,
  expectedTitle: string,
): boolean {
  return review.taskTitle === expectedTitle;
}

/**
 * Checks that review diff data is present and non-empty.
 */
export function reviewHasDiffContent(review: ReviewResponse): boolean {
  return (
    review.diff !== undefined &&
    review.diff.files.length > 0 &&
    review.diff.stats.filesChanged > 0
  );
}

/**
 * Checks that review session metadata is present.
 */
export function reviewHasSessionMetadata(review: ReviewResponse): boolean {
  return (
    review.session !== undefined &&
    review.session.startedAt !== undefined
  );
}

// ---------------------------------------------------------------------------
// Cross-Surface Helpers
// ---------------------------------------------------------------------------

/**
 * Waits for a condition to become true by polling.
 * Used for SSE-driven state changes that need time to propagate.
 */
export async function waitForCondition(
  check: () => Promise<boolean>,
  timeoutMs = 10_000,
  pollIntervalMs = 500,
  label = "condition",
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await Bun.sleep(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for ${label} (${timeoutMs}ms)`);
}

/**
 * Transitions an agent session to idle state by updating the DB directly.
 * Used in test setup to simulate agent completing work without a real agent.
 */
export async function simulateAgentCompletion(
  runtime: OrchestratorTestRuntime,
  sessionId: string,
): Promise<void> {
  const { RecordId } = await import("surrealdb");
  const sessionRecord = new RecordId("agent_session", sessionId);
  await runtime.surreal.query(
    `UPDATE $rec SET orchestrator_status = "idle", last_event_at = time::now();`,
    { rec: sessionRecord },
  );
}

/**
 * Transitions an agent session to error state by updating the DB directly.
 * Used in test setup to simulate agent encountering an error.
 */
export async function simulateAgentError(
  runtime: OrchestratorTestRuntime,
  sessionId: string,
  errorMessage: string,
): Promise<void> {
  const { RecordId } = await import("surrealdb");
  const sessionRecord = new RecordId("agent_session", sessionId);
  await runtime.surreal.query(
    `UPDATE $rec SET orchestrator_status = "error", error_message = $error, last_event_at = time::now();`,
    { rec: sessionRecord, error: errorMessage },
  );
}

/**
 * Transitions an agent session to active state (simulates agent starting work).
 */
export async function simulateAgentActive(
  runtime: OrchestratorTestRuntime,
  sessionId: string,
): Promise<void> {
  const { RecordId } = await import("surrealdb");
  const sessionRecord = new RecordId("agent_session", sessionId);
  await runtime.surreal.query(
    `UPDATE $rec SET orchestrator_status = "active", last_event_at = time::now();`,
    { rec: sessionRecord },
  );
}

/**
 * Transitions an agent session to active state (simulates agent resuming after reject).
 */
export async function simulateAgentResumed(
  runtime: OrchestratorTestRuntime,
  sessionId: string,
): Promise<void> {
  const { RecordId } = await import("surrealdb");
  const sessionRecord = new RecordId("agent_session", sessionId);
  await runtime.surreal.query(
    `UPDATE $rec SET orchestrator_status = "active", last_event_at = time::now();`,
    { rec: sessionRecord },
  );
}
