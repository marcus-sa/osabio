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
  agentSessionId: string;
  taskId: string;
  taskTitle: string;
  summary?: string;
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
    startedAt: string;
    lastEventAt?: string;
    decisionsCount: number;
    questionsCount: number;
    observationsCount: number;
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
// Internal Helpers
// ---------------------------------------------------------------------------

function orchestratorUrl(workspaceId: string, ...segments: string[]): string {
  const base = `/api/orchestrator/${encodeURIComponent(workspaceId)}`;
  if (segments.length === 0) return base;
  return `${base}/${segments.map(encodeURIComponent).join("/")}`;
}

async function orchestratorFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Orchestrator request failed (${response.status}): ${text}`);
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
    orchestratorUrl(workspaceId, "assign"),
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
    orchestratorUrl(workspaceId, "sessions", sessionId),
  );
}

export function getSessionReview(
  workspaceId: string,
  sessionId: string,
): Promise<SessionReviewResponse> {
  return orchestratorFetch<SessionReviewResponse>(
    orchestratorUrl(workspaceId, "sessions", sessionId, "review"),
  );
}

export function acceptSession(
  workspaceId: string,
  sessionId: string,
  summary?: string,
): Promise<AcceptSessionResponse> {
  return orchestratorFetch<AcceptSessionResponse>(
    orchestratorUrl(workspaceId, "sessions", sessionId, "accept"),
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
    orchestratorUrl(workspaceId, "sessions", sessionId, "reject"),
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
    orchestratorUrl(workspaceId, "sessions", sessionId, "abort"),
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
    orchestratorUrl(workspaceId, "sessions", sessionId, "prompt"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
}
