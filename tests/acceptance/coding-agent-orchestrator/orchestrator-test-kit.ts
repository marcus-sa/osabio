/**
 * Orchestrator Acceptance Test Kit
 *
 * Extends the shared acceptance-test-kit with orchestrator-specific domain helpers.
 * Boots an in-process Brain server with agent mocking enabled.
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  type AcceptanceTestRuntime,
  type TestUser as BaseTestUser,
  fetchJson as baseFetchJson,
  fetchRaw as baseFetchRaw,
  getOAuthToken,
} from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Re-exports from shared kit
// ---------------------------------------------------------------------------

export {
  setupAcceptanceSuite,
  collectSseEvents,
  createTestUser,
  createTestUserWithMcp,
  getOAuthToken,
  testAI,
  smokeAI,
  type TestUserWithMcp,
  type AcceptanceTestRuntime,
  type SmokeTestRuntime,
} from "../acceptance-test-kit";

export const fetchJson = baseFetchJson;
export const fetchRaw = baseFetchRaw;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestratorTestRuntime = AcceptanceTestRuntime;

export type TestUser = BaseTestUser;

export type TestWorkspace = {
  workspaceId: string;
  conversationId: string;
};

export type TestTask = {
  taskId: string;
  taskRecord: RecordId<"task">;
};

export type TestProject = {
  projectId: string;
  projectRecord: RecordId<"project">;
};

export type AssignmentResponse = {
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

export type ReviewResponse = {
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

export type TestUserWithToken = BaseTestUser & {
  bearerHeaders: Record<string, string>;
  accessToken: string;
};

// ---------------------------------------------------------------------------
// Suite Setup (delegates to shared kit with mock agent env)
// ---------------------------------------------------------------------------

export function setupOrchestratorSuite(
  suiteName: string,
): () => OrchestratorTestRuntime {
  return setupAcceptanceSuite(suiteName, {
    env: { ORCHESTRATOR_MOCK_AGENT: "true" },
  });
}

// ---------------------------------------------------------------------------
// Domain Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

/**
 * Creates a workspace for testing.
 */
export async function createTestWorkspace(
  baseUrl: string,
  user: BaseTestUser,
  name?: string,
  options?: { repoPath?: string | false },
): Promise<TestWorkspace> {
  // Default to process.cwd() (a valid git repo) unless explicitly disabled
  const repoPath = options?.repoPath === false
    ? undefined
    : (options?.repoPath ?? process.cwd());

  const workspace = await baseFetchJson<TestWorkspace>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: name ?? `Orchestrator Test ${Date.now()}`,
        ...(repoPath ? { repoPath } : {}),
      }),
    },
  );
  return workspace;
}

/**
 * Creates a task in assignable status via direct DB insertion.
 */
export async function createReadyTask(
  surreal: Surreal,
  workspaceId: string,
  options: {
    title: string;
    description?: string;
    status?: string;
    projectId?: string;
  },
): Promise<TestTask> {
  const taskId = `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const taskRecord = new RecordId("task", taskId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    title: options.title,
    description: options.description ?? "Test task for orchestrator acceptance tests",
    status: options.status ?? "ready",
    created_at: new Date(),
    updated_at: new Date(),
    workspace: workspaceRecord,
  };

  if (options.projectId) {
    const projectRecord = new RecordId("project", options.projectId);
    await surreal.query(
      `CREATE $task CONTENT $content;
       RELATE $task->belongs_to->$project SET added_at = time::now();`,
      { task: taskRecord, content: { ...content }, project: projectRecord },
    );
  } else {
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content,
    });
  }

  return { taskId, taskRecord };
}

/**
 * Creates a project for grouping tasks.
 */
export async function createTestProject(
  surreal: Surreal,
  workspaceId: string,
  name: string,
): Promise<TestProject> {
  const projectId = `proj-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const projectRecord = new RecordId("project", projectId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `CREATE $project CONTENT $content;
     RELATE $ws->has_project->$project SET added_at = time::now();`,
    {
      project: projectRecord,
      ws: workspaceRecord,
      content: {
        name,
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
        workspace: workspaceRecord,
      },
    },
  );

  return { projectId, projectRecord };
}

/**
 * Assigns a task to a coding agent via the orchestrator endpoint.
 */
export async function assignTaskToAgent(
  baseUrl: string,
  user: BaseTestUser,
  workspaceId: string,
  taskId: string,
): Promise<AssignmentResponse> {
  return baseFetchJson<AssignmentResponse>(
    `${baseUrl}/api/orchestrator/${workspaceId}/assign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ taskId }),
    },
  );
}

/**
 * Gets the current status of an agent session.
 */
export async function getSessionStatus(
  baseUrl: string,
  user: BaseTestUser,
  workspaceId: string,
  sessionId: string,
): Promise<SessionStatusResponse> {
  return baseFetchJson<SessionStatusResponse>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}`,
    { headers: user.headers },
  );
}

/**
 * Lists active agent sessions for a workspace.
 */
export async function listActiveSessions(
  baseUrl: string,
  user: BaseTestUser,
  workspaceId: string,
): Promise<SessionStatusResponse[]> {
  return baseFetchJson<SessionStatusResponse[]>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions`,
    { headers: user.headers },
  );
}

/**
 * Accepts completed agent work, merging changes.
 */
export async function acceptAgentWork(
  baseUrl: string,
  user: BaseTestUser,
  workspaceId: string,
  sessionId: string,
): Promise<{ accepted: boolean }> {
  return baseFetchJson<{ accepted: boolean }>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
    },
  );
}

/**
 * Rejects agent work with feedback for the agent to incorporate.
 */
export async function rejectWithFeedback(
  baseUrl: string,
  user: BaseTestUser,
  workspaceId: string,
  sessionId: string,
  feedback: string,
): Promise<{ rejected: boolean; continuing: boolean }> {
  return baseFetchJson<{ rejected: boolean; continuing: boolean }>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ feedback }),
    },
  );
}

/**
 * Aborts an active agent session and cleans up resources.
 */
export async function abortAgentSession(
  baseUrl: string,
  user: BaseTestUser,
  workspaceId: string,
  sessionId: string,
): Promise<{ aborted: boolean }> {
  return baseFetchJson<{ aborted: boolean }>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/abort`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
    },
  );
}

/**
 * Gets the review summary (diff, session trace) for completed agent work.
 */
export async function getReviewSummary(
  baseUrl: string,
  user: BaseTestUser,
  workspaceId: string,
  sessionId: string,
): Promise<ReviewResponse> {
  return baseFetchJson<ReviewResponse>(
    `${baseUrl}/api/orchestrator/${workspaceId}/sessions/${sessionId}/review`,
    { headers: user.headers },
  );
}

/**
 * Queries task status directly from the database.
 */
export async function getTaskStatus(
  surreal: Surreal,
  taskId: string,
): Promise<string> {
  const taskRecord = new RecordId("task", taskId);
  const rows = (await surreal.query(
    `SELECT status FROM $task;`,
    { task: taskRecord },
  )) as Array<Array<{ status: string }>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error(`Task ${taskId} not found`);
  }
  return result.status;
}

/**
 * Queries agent session records for a task.
 */
export async function getAgentSessionsForTask(
  surreal: Surreal,
  taskId: string,
): Promise<
  Array<{
    id: RecordId;
    orchestrator_status: string;
    agent: string;
  }>
> {
  const taskRecord = new RecordId("task", taskId);
  const rows = (await surreal.query(
    `SELECT id, orchestrator_status, agent FROM agent_session WHERE task_id = $task;`,
    { task: taskRecord },
  )) as Array<
    Array<{ id: RecordId; orchestrator_status: string; agent: string }>
  >;
  return rows[0] ?? [];
}

/**
 * Transitions an agent session to a given status via direct DB update.
 */
export async function simulateSessionStatus(
  surreal: Surreal,
  sessionId: string,
  status: string,
): Promise<void> {
  const sessionRecord = new RecordId("agent_session", sessionId);
  await surreal.update(sessionRecord).merge({
    orchestrator_status: status,
  });
}

// ---------------------------------------------------------------------------
// OAuth / JWT Token Helpers (for MCP endpoint tests)
// ---------------------------------------------------------------------------

const MCP_SCOPES = "graph:read graph:reason decision:write task:write observation:write question:write session:write offline_access";

/**
 * Obtains a JWT Bearer token for a test user via the full OAuth 2.1 flow.
 */
export async function getTestUserBearerToken(
  baseUrl: string,
  surreal: Surreal,
  user: BaseTestUser,
  scopes?: string,
): Promise<TestUserWithToken> {
  const accessToken = await getOAuthToken(
    baseUrl,
    surreal,
    user.headers,
    scopes ?? MCP_SCOPES,
  );

  return {
    ...user,
    accessToken,
    bearerHeaders: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
}
