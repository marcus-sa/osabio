/**
 * Orchestrator HTTP route handlers.
 *
 * Pure request->response mappings that delegate to session-lifecycle functions
 * injected via OrchestratorRouteDeps. No direct DB or IO access.
 */
import { jsonError, jsonResponse } from "../http/response";
import { withRequestLogging, type RouteHandler } from "../http/request-logging";
import type {
  OrchestratorSessionResult,
  SessionStatusResult,
  AbortSessionResult,
  AcceptSessionResult,
  ReviewResult,
  RejectSessionResult,
  PromptSessionResult,
} from "./session-lifecycle";
import type { SseRegistry } from "../streaming/sse-registry";

// ---------------------------------------------------------------------------
// Port: Dependencies as function signatures
// ---------------------------------------------------------------------------

export type OrchestratorRouteDeps = {
  createSession: (
    workspaceId: string,
    taskId: string,
    authToken: string,
  ) => Promise<OrchestratorSessionResult>;
  getSessionStatus: (sessionId: string) => Promise<SessionStatusResult>;
  abortSession: (sessionId: string) => Promise<AbortSessionResult>;
  acceptSession: (
    sessionId: string,
    summary: string,
  ) => Promise<AcceptSessionResult>;
  getReview: (sessionId: string) => Promise<ReviewResult>;
  rejectSession: (
    sessionId: string,
    feedback: string,
  ) => Promise<RejectSessionResult>;
  sendPrompt: (
    sessionId: string,
    text: string,
  ) => Promise<PromptSessionResult>;
};

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

type AssignBody = { taskId?: string };
type AcceptBody = { summary?: string };
type RejectBody = { feedback?: string };
type PromptBody = { text?: string };

async function parseJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
}

function extractAuthToken(request: Request): string {
  return request.headers.get("Cookie") ?? "";
}

// ---------------------------------------------------------------------------
// Response builders (pure)
// ---------------------------------------------------------------------------

function assignResponse(
  workspaceId: string,
  value: { agentSessionId: string; streamId: string; worktreeBranch: string },
): Response {
  return jsonResponse(
    {
      agentSessionId: value.agentSessionId,
      streamId: value.streamId,
      streamUrl: `/api/orchestrator/${workspaceId}/sessions/${value.agentSessionId}/stream`,
    },
    200,
  );
}

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

function statusResponse(
  sessionId: string,
  value: {
    orchestratorStatus: string;
    worktreeBranch?: string;
    worktreePath?: string;
    startedAt?: string;
    lastEventAt?: string;
    error?: string;
  },
): Response {
  return jsonResponse(
    {
      agentSessionId: sessionId,
      orchestratorStatus: value.orchestratorStatus,
      ...pickDefined({
        worktreeBranch: value.worktreeBranch,
        worktreePath: value.worktreePath,
        startedAt: value.startedAt,
        lastEventAt: value.lastEventAt,
        error: value.error,
      }),
    },
    200,
  );
}

function acceptResponse(): Response {
  return jsonResponse({ accepted: true, taskStatus: "done" }, 200);
}

function abortResponse(): Response {
  return jsonResponse({ aborted: true, taskStatus: "ready" }, 200);
}

function reviewResponse(value: {
  taskTitle: string;
  diff: unknown;
  session: unknown;
}): Response {
  return jsonResponse(value, 200);
}

function rejectResponse(): Response {
  return jsonResponse({ rejected: true, continuing: true }, 200);
}

function promptResponse(): Response {
  return jsonResponse({ delivered: true }, 202);
}

function sessionErrorResponse(error: {
  message: string;
  httpStatus: number;
}): Response {
  return jsonError(error.message, error.httpStatus);
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createOrchestratorRouteHandlers(deps: OrchestratorRouteDeps) {
  const assign: RouteHandler = async (request) => {
    const workspaceId = request.params.workspaceId;
    const body = await parseJsonBody<AssignBody>(request);

    if (!body?.taskId) {
      return jsonError("taskId is required", 400);
    }

    const authToken = extractAuthToken(request);
    const result = await deps.createSession(workspaceId, body.taskId, authToken);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return assignResponse(workspaceId, result.value);
  };

  const status: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const result = await deps.getSessionStatus(sessionId);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return statusResponse(sessionId, result.value);
  };

  const accept: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const body = await parseJsonBody<AcceptBody>(request);
    const summary = body?.summary ?? "";

    const result = await deps.acceptSession(sessionId, summary);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return acceptResponse();
  };

  const abort: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const result = await deps.abortSession(sessionId);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return abortResponse();
  };

  const review: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const result = await deps.getReview(sessionId);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return reviewResponse(result.value);
  };

  const reject: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const body = await parseJsonBody<RejectBody>(request);

    if (!body?.feedback || body.feedback.trim() === "") {
      return jsonError("feedback is required", 400);
    }

    const result = await deps.rejectSession(sessionId, body.feedback);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return rejectResponse();
  };

  const prompt: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const body = await parseJsonBody<PromptBody>(request);

    if (!body?.text || body.text.trim() === "") {
      return jsonError("text is required", 400);
    }

    const result = await deps.sendPrompt(sessionId, body.text);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return promptResponse();
  };

  return { assign, status, accept, abort, review, reject, prompt };
}

// ---------------------------------------------------------------------------
// SSE stream route handler factory
// ---------------------------------------------------------------------------

export type StreamRouteDeps = {
  sseRegistry: SseRegistry;
};

export function createStreamRouteHandler(deps: StreamRouteDeps) {
  const stream: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;

    if (!sessionId) {
      return jsonError("sessionId is required", 400);
    }

    const streamId = `stream-${sessionId}`;
    return deps.sseRegistry.handleStreamRequest(streamId);
  };

  return { stream };
}

// ---------------------------------------------------------------------------
// Wiring factory: creates OrchestratorRouteDeps from server dependencies
// ---------------------------------------------------------------------------

export type OrchestratorWiringDeps = {
  surreal: import("surrealdb").Surreal;
  shellExec: import("./worktree-manager").ShellExec;
  brainBaseUrl: string;
  sseRegistry?: SseRegistry;
  queryFn: import("./spawn-agent").QueryFn;
  auth: { api: { getSession: (opts: { headers: Headers }) => Promise<{ user?: { id?: string } } | null> } };
};

export function wireOrchestratorRoutes(
  wiringDeps: OrchestratorWiringDeps,
): {
  assign: RouteHandler;
  status: RouteHandler;
  accept: RouteHandler;
  abort: RouteHandler;
  review: RouteHandler;
  reject: RouteHandler;
  prompt: RouteHandler;
  stream?: RouteHandler;
} {
  // Workspace access guard — resolves user from session cookie, checks membership
  const validateWorkspaceAccess = async (request: Request, workspaceId: string): Promise<Response | undefined> => {
    const session = await wiringDeps.auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) {
      return jsonError("authentication required", 401);
    }
    const { RecordId } = await import("surrealdb");
    const personRecord = new RecordId("person", session.user.id);
    const workspaceRecord = new RecordId("workspace", workspaceId);
    // member_of is identity->workspace; resolve person->identity via identity_person subquery
    const [memberRows] = await wiringDeps.surreal.query<[Array<{ role: string }>]>(
      `SELECT role FROM member_of WHERE in IN (SELECT VALUE in FROM identity_person WHERE out = $person) AND out = $ws LIMIT 1;`,
      { person: personRecord, ws: workspaceRecord },
    );
    if (!memberRows || memberRows.length === 0) {
      return jsonError("not a member of this workspace", 403);
    }
    return undefined;
  };

  // Lazy imports to keep module boundary clean
  const lifecycleImport = import("./session-lifecycle");
  const queriesImport = import("../mcp/mcp-queries");
  const guardImport = import("./assignment-guard");
  const stallDetectorImport = import("./stall-detector");

  // Helper: resolve repo_path from workspace record
  const resolveRepoRoot = async (workspaceRecord: import("surrealdb").RecordId<"workspace", string>): Promise<string> => {
    const [rows] = await wiringDeps.surreal.query<[Array<{ repo_path?: string }>]>(
      `SELECT repo_path FROM $ws;`,
      { ws: workspaceRecord },
    );
    const repoPath = rows[0]?.repo_path;
    if (!repoPath) {
      throw new Error(`Workspace ${workspaceRecord.id} has no repo_path configured`);
    }
    return repoPath;
  };

  // Use mock spawn for acceptance tests, production spawn otherwise
  const spawnAgentImport = process.env.ORCHESTRATOR_MOCK_AGENT === "true"
    ? Promise.resolve({
        createSpawnAgent: (_qfn: import("./spawn-agent").QueryFn): import("./spawn-agent").SpawnAgentFn =>
          () => ({
            messages: (async function* () {})(),
            abort: () => {},
          }),
      })
    : import("./spawn-agent");

  const routeDeps: OrchestratorRouteDeps = {
    createSession: async (workspaceId, taskId, authToken) => {
      const [lifecycle, queries, guard, { createSpawnAgent }, stallDetector] = await Promise.all([
        lifecycleImport,
        queriesImport,
        guardImport,
        spawnAgentImport,
        stallDetectorImport,
      ]);
      const spawnAgent = createSpawnAgent(wiringDeps.queryFn);
      const result = await lifecycle.createOrchestratorSession({
        surreal: wiringDeps.surreal,
        shellExec: wiringDeps.shellExec,
        brainBaseUrl: wiringDeps.brainBaseUrl,
        workspaceId,
        taskId,
        authToken,
        validateAssignment: guard.validateAssignment,
        createAgentSession: queries.createAgentSession,
        spawnAgent,
      });

      // Wire SSE stream + event iteration on success
      if (result.ok && wiringDeps.sseRegistry) {
        const { agentSessionId, streamId } = result.value;
        wiringDeps.sseRegistry.registerMessage(streamId);

        const handle = lifecycle.getHandle(agentSessionId);
        if (handle) {
          const { RecordId } = await import("surrealdb");
          lifecycle.startEventIteration(
            {
              emitEvent: wiringDeps.sseRegistry.emitEvent,
              updateSessionStatus: async (sid, status, error) => {
                const rec = new RecordId("agent_session", sid);
                await wiringDeps.surreal.update(rec).merge({
                  orchestrator_status: status,
                  ...(error !== undefined ? { error } : {}),
                });
              },
              updateLastEventAt: async (sid) => {
                const rec = new RecordId("agent_session", sid);
                await wiringDeps.surreal.update(rec).merge({
                  last_event_at: new Date(),
                });
              },
              getSessionStatus: async (sid) => {
                const rec = new RecordId("agent_session", sid);
                const row = await wiringDeps.surreal.select(rec) as { orchestrator_status?: string } | undefined;
                return (row?.orchestrator_status ?? "error") as import("./types").OrchestratorStatus;
              },
              startStallDetector: (sid, stId) =>
                stallDetector.startStallDetector(
                  {
                    abortSession: async (abortSid) => {
                      const abortResult = await lifecycle.abortOrchestratorSession({
                        surreal: wiringDeps.surreal,
                        shellExec: wiringDeps.shellExec,
                        resolveRepoRoot,
                        sessionId: abortSid,
                        endAgentSession: queries.endAgentSession,
                      });
                      return abortResult;
                    },
                    createObservation: async () => {},
                    emitEvent: wiringDeps.sseRegistry!.emitEvent,
                  },
                  stallDetector.DEFAULT_STALL_CONFIG,
                  sid,
                  stId,
                ),
            },
            handle.messages,
            streamId,
            agentSessionId,
          );
        }
      }

      return result;
    },

    getSessionStatus: async (sessionId) => {
      const lifecycle = await lifecycleImport;
      return lifecycle.getOrchestratorSessionStatus({
        surreal: wiringDeps.surreal,
        sessionId,
      });
    },

    abortSession: async (sessionId) => {
      const [lifecycle, queries] = await Promise.all([
        lifecycleImport,
        queriesImport,
      ]);
      return lifecycle.abortOrchestratorSession({
        surreal: wiringDeps.surreal,
        shellExec: wiringDeps.shellExec,
        resolveRepoRoot,
        sessionId,
        endAgentSession: queries.endAgentSession,
      });
    },

    acceptSession: async (sessionId, summary) => {
      const [lifecycle, queries] = await Promise.all([
        lifecycleImport,
        queriesImport,
      ]);
      return lifecycle.acceptOrchestratorSession({
        surreal: wiringDeps.surreal,
        sessionId,
        summary,
        endAgentSession: queries.endAgentSession,
      });
    },

    getReview: async (sessionId) => {
      const [lifecycle, worktreeManager] = await Promise.all([
        lifecycleImport,
        import("./worktree-manager"),
      ]);
      return lifecycle.getOrchestratorReview({
        surreal: wiringDeps.surreal,
        sessionId,
        resolveRepoRoot,
        getDiff: (repoRoot: string, branchName: string) =>
          worktreeManager.getDiff(wiringDeps.shellExec, repoRoot, branchName),
        getTaskTitle: async (taskId: string) => {
          const { RecordId } = await import("surrealdb");
          const taskRecord = new RecordId("task", taskId);
          const rows = (await wiringDeps.surreal.query(
            `SELECT title FROM $task;`,
            { task: taskRecord },
          )) as Array<Array<{ title: string }>>;
          return rows[0]?.[0]?.title ?? "";
        },
      });
    },

    rejectSession: async (sessionId, feedback) => {
      const lifecycle = await lifecycleImport;
      return lifecycle.rejectOrchestratorSession({
        surreal: wiringDeps.surreal,
        sessionId,
        feedback,
      });
    },

    sendPrompt: async (sessionId, text) => {
      const lifecycle = await lifecycleImport;
      return lifecycle.sendSessionPrompt({
        surreal: wiringDeps.surreal,
        sessionId,
        text,
      });
    },
  };

  const handlers = createOrchestratorRouteHandlers(routeDeps);

  // Wrap handler with workspace access check
  const withWorkspaceAccess = (handler: RouteHandler): RouteHandler => async (request) => {
    const workspaceId = request.params.workspaceId;
    if (workspaceId) {
      const accessError = await validateWorkspaceAccess(request, workspaceId);
      if (accessError) return accessError;
    }
    return handler(request);
  };

  const streamHandler = wiringDeps.sseRegistry
    ? createStreamRouteHandler({ sseRegistry: wiringDeps.sseRegistry })
    : undefined;

  return {
    assign: withRequestLogging("orchestrator.assign", "POST", withWorkspaceAccess(handlers.assign)),
    status: withRequestLogging("orchestrator.status", "GET", withWorkspaceAccess(handlers.status)),
    accept: withRequestLogging("orchestrator.accept", "POST", withWorkspaceAccess(handlers.accept)),
    abort: withRequestLogging("orchestrator.abort", "POST", withWorkspaceAccess(handlers.abort)),
    review: withRequestLogging("orchestrator.review", "GET", withWorkspaceAccess(handlers.review)),
    reject: withRequestLogging("orchestrator.reject", "POST", withWorkspaceAccess(handlers.reject)),
    prompt: withRequestLogging("orchestrator.prompt", "POST", withWorkspaceAccess(handlers.prompt)),
    ...(streamHandler
      ? { stream: withRequestLogging("orchestrator.stream", "GET", withWorkspaceAccess(streamHandler.stream)) }
      : {}),
  };
}
