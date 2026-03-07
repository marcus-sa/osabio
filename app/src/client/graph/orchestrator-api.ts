/**
 * Typed fetch wrappers for orchestrator endpoints.
 *
 * Follows the same error-handling pattern as graph/actions.ts:
 * throw on non-OK responses with status and message.
 */

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export type AssignAgentResponse = {
  agentSessionId: string;
  streamId: string;
  streamUrl: string;
};

export type SessionStatusResponse = {
  agentSessionId: string;
  orchestratorStatus: string;
  worktreeBranch?: string;
  startedAt: string;
  lastEventAt?: string;
};

export type SessionReviewResponse = {
  taskTitle: string;
  diff: {
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      additions: number;
      deletions: number;
    }>;
    rawDiff: string;
    stats: {
      filesChanged: number;
      insertions: number;
      deletions: number;
    };
  };
  session: {
    orchestratorStatus: string;
    worktreeBranch?: string;
    startedAt?: string;
    lastEventAt?: string;
    toolCallCount?: number;
    filesEdited?: number;
  };
};

export type AcceptSessionResponse = {
  accepted: boolean;
  taskStatus: string;
};

export type RejectSessionResponse = {
  rejected: boolean;
  continuing: boolean;
};

export type AbortSessionResponse = {
  aborted: boolean;
  taskStatus: string;
};

export type SendPromptResponse = {
  delivered: boolean;
};

// ---------------------------------------------------------------------------
// Structured Error
// ---------------------------------------------------------------------------

export type OrchestratorErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_ERROR"
  | "TASK_NOT_FOUND"
  | "TASK_NOT_ASSIGNABLE"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "UNKNOWN_ERROR";

export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;
  readonly httpStatus: number;

  constructor(code: OrchestratorErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function mapHttpStatusToErrorCode(httpStatus: number): OrchestratorErrorCode {
  switch (httpStatus) {
    case 400: return "BAD_REQUEST";
    case 404: return "SESSION_NOT_FOUND";
    case 409: return "SESSION_ERROR";
    default: return httpStatus >= 500 ? "SERVER_ERROR" : "UNKNOWN_ERROR";
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function buildOrchestratorUrl(workspaceId: string, ...segments: string[]): string {
  const base = `/api/orchestrator/${encodeURIComponent(workspaceId)}`;
  if (segments.length === 0) return base;
  return `${base}/${segments.map(encodeURIComponent).join("/")}`;
}

async function orchestratorFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    const code = mapHttpStatusToErrorCode(response.status);
    throw new OrchestratorError(code, text, response.status);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

export function assignAgent(
  workspaceId: string,
  taskId: string,
): Promise<AssignAgentResponse> {
  return orchestratorFetch<AssignAgentResponse>(
    buildOrchestratorUrl(workspaceId, "assign"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    },
  );
}

export function getSessionStatus(
  workspaceId: string,
  sessionId: string,
): Promise<SessionStatusResponse> {
  return orchestratorFetch<SessionStatusResponse>(
    buildOrchestratorUrl(workspaceId, "sessions", sessionId),
  );
}

export function getSessionReview(
  workspaceId: string,
  sessionId: string,
): Promise<SessionReviewResponse> {
  return orchestratorFetch<SessionReviewResponse>(
    buildOrchestratorUrl(workspaceId, "sessions", sessionId, "review"),
  );
}

export function acceptSession(
  workspaceId: string,
  sessionId: string,
  summary?: string,
): Promise<AcceptSessionResponse> {
  return orchestratorFetch<AcceptSessionResponse>(
    buildOrchestratorUrl(workspaceId, "sessions", sessionId, "accept"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summary !== undefined ? { summary } : {}),
    },
  );
}

export function rejectSession(
  workspaceId: string,
  sessionId: string,
  feedback: string,
): Promise<RejectSessionResponse> {
  return orchestratorFetch<RejectSessionResponse>(
    buildOrchestratorUrl(workspaceId, "sessions", sessionId, "reject"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    },
  );
}

export function abortSession(
  workspaceId: string,
  sessionId: string,
): Promise<AbortSessionResponse> {
  return orchestratorFetch<AbortSessionResponse>(
    buildOrchestratorUrl(workspaceId, "sessions", sessionId, "abort"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function sendPrompt(
  workspaceId: string,
  sessionId: string,
  text: string,
): Promise<SendPromptResponse> {
  return orchestratorFetch<SendPromptResponse>(
    buildOrchestratorUrl(workspaceId, "sessions", sessionId, "prompt"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
}
