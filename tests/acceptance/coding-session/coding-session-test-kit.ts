/**
 * Coding Session Acceptance Test Kit
 *
 * Extends orchestrator-test-kit with coding-session-specific helpers.
 * Provides helpers for SSE event collection, prompt sending,
 * conversation log retrieval, and session state waiting.
 */
import type {
  OrchestratorTestRuntime,
  TestUser,
  AssignmentResponse,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

// Re-export everything from the orchestrator test kit
export {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
  getSessionStatus,
  acceptAgentWork,
  rejectWithFeedback,
  abortAgentSession,
  getReviewSummary,
  getTaskStatus,
  getAgentSessionsForTask,
  fetchJson,
  fetchRaw,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

export type {
  OrchestratorTestRuntime,
  TestUser,
  TestWorkspace,
  TestTask,
  AssignmentResponse,
  SessionStatusResponse,
  ReviewResponse,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStreamEvent = {
  type: string;
  sessionId?: string;
  token?: string;
  file?: string;
  changeType?: string;
  status?: string;
  error?: string;
  text?: string;
};

export type ConversationLogEntry = {
  entryType: "agent_text" | "file_change" | "user_prompt" | "status_change" | "stall_warning";
  timestamp: string;
  content?: string;
  file?: string;
  changeType?: string;
  status?: string;
};

export type ConversationLogResponse = {
  entries: ConversationLogEntry[];
};

export type PromptResponse = void;

// ---------------------------------------------------------------------------
// SSE Event Collection
// ---------------------------------------------------------------------------

/**
 * Subscribes to an agent session's SSE stream and collects events
 * until a terminal event or timeout.
 */
export async function collectSessionEvents(
  baseUrl: string,
  streamUrl: string,
  options: {
    timeoutMs?: number;
    stopOnTypes?: string[];
    maxEvents?: number;
  } = {},
): Promise<AgentStreamEvent[]> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const stopOnTypes = options.stopOnTypes ?? ["agent_done", "agent_error"];
  const maxEvents = options.maxEvents ?? 1000;

  const response = await fetch(`${baseUrl}${streamUrl}`, {
    headers: { Accept: "text/event-stream" },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to open session event stream (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = "";

  const timeout = setTimeout(() => {
    void reader.cancel();
  }, timeoutMs);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const dataLine = segment
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) continue;

        const event = JSON.parse(
          dataLine.slice("data: ".length),
        ) as AgentStreamEvent;
        events.push(event);

        if (stopOnTypes.includes(event.type) || events.length >= maxEvents) {
          return events;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  return events;
}

// ---------------------------------------------------------------------------
// Follow-Up Prompt
// ---------------------------------------------------------------------------

/**
 * Sends a follow-up prompt to a running agent session.
 * Returns the raw Response for status code assertions.
 */
export async function sendFollowUpPrompt(
  baseUrl: string,
  user: TestUser,
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

// ---------------------------------------------------------------------------
// Conversation Log
// ---------------------------------------------------------------------------

/**
 * Retrieves the conversation log for a session (used in review).
 */
export async function getConversationLog(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/log`,
    { headers: user.headers },
  );
}

// ---------------------------------------------------------------------------
// Session State Helpers
// ---------------------------------------------------------------------------

/**
 * Waits for a session to reach one of the target statuses.
 * Polls the session status endpoint at intervals.
 */
export async function waitForSessionStatus(
  baseUrl: string,
  user: TestUser,
  workspaceId: string,
  sessionId: string,
  targetStatuses: string[],
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const { getSessionStatus } = await import(
    "../coding-agent-orchestrator/orchestrator-test-kit"
  );
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspaceId,
      sessionId,
    );
    if (targetStatuses.includes(status.orchestratorStatus)) {
      return status.orchestratorStatus;
    }
    await Bun.sleep(intervalMs);
  }

  throw new Error(
    `Session ${sessionId} did not reach status [${targetStatuses.join(", ")}] within ${timeoutMs}ms`,
  );
}

/**
 * Creates a full session setup: user, workspace, task, assignment.
 * Convenience for tests that need a running session as precondition.
 */
export async function createActiveSession(
  runtime: OrchestratorTestRuntime,
  suffix: string,
  taskTitle: string,
): Promise<{
  user: TestUser;
  workspaceId: string;
  assignment: AssignmentResponse;
  taskId: string;
}> {
  const {
    createTestUser,
    createTestWorkspace,
    createReadyTask,
    assignTaskToAgent,
  } = await import("../coding-agent-orchestrator/orchestrator-test-kit");

  const user = await createTestUser(runtime.baseUrl, suffix);
  const workspace = await createTestWorkspace(runtime.baseUrl, user);
  const task = await createReadyTask(runtime.surreal, workspace.workspaceId, {
    title: taskTitle,
  });
  const assignment = await assignTaskToAgent(
    runtime.baseUrl,
    user,
    workspace.workspaceId,
    task.taskId,
  );

  return {
    user,
    workspaceId: workspace.workspaceId,
    assignment,
    taskId: task.taskId,
  };
}
