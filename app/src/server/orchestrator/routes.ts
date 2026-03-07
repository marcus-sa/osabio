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
};

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

type AssignBody = { taskId?: string };
type AcceptBody = { summary?: string };

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
      ...(value.worktreeBranch ? { worktreeBranch: value.worktreeBranch } : {}),
      ...(value.worktreePath ? { worktreePath: value.worktreePath } : {}),
      ...(value.startedAt ? { startedAt: value.startedAt } : {}),
      ...(value.lastEventAt ? { lastEventAt: value.lastEventAt } : {}),
      ...(value.error ? { error: value.error } : {}),
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

  return { assign, status, accept, abort };
}

// ---------------------------------------------------------------------------
// SSE stream route handler factory
// ---------------------------------------------------------------------------

export type StreamRouteDeps = {
  sseRegistry: SseRegistry;
};

export function createStreamRouteHandler(deps: StreamRouteDeps) {
  const stream: RouteHandler = async (request) => {
    const streamId = request.params.streamId;

    if (!streamId) {
      return jsonError("streamId is required", 400);
    }

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
  repoRoot: string;
  brainBaseUrl: string;
  sseRegistry?: SseRegistry;
};

export function wireOrchestratorRoutes(
  wiringDeps: OrchestratorWiringDeps,
): {
  assign: RouteHandler;
  status: RouteHandler;
  accept: RouteHandler;
  abort: RouteHandler;
  stream?: RouteHandler;
} {
  // Lazy imports to keep module boundary clean
  const lifecycleImport = import("./session-lifecycle");
  const queriesImport = import("../mcp/mcp-queries");
  const guardImport = import("./assignment-guard");

  // Mock OpenCode spawning when env var is set (for acceptance tests)
  const mockOpenCode = process.env.ORCHESTRATOR_MOCK_OPENCODE === "true";
  const mockSpawnOpenCode = mockOpenCode
    ? async () => ({
        sessionId: crypto.randomUUID(),
        abort: () => {},
      })
    : undefined;

  const routeDeps: OrchestratorRouteDeps = {
    createSession: async (workspaceId, taskId, authToken) => {
      const [lifecycle, queries, guard] = await Promise.all([
        lifecycleImport,
        queriesImport,
        guardImport,
      ]);
      return lifecycle.createOrchestratorSession({
        surreal: wiringDeps.surreal,
        shellExec: wiringDeps.shellExec,
        repoRoot: wiringDeps.repoRoot,
        brainBaseUrl: wiringDeps.brainBaseUrl,
        workspaceId,
        taskId,
        authToken,
        validateAssignment: guard.validateAssignment,
        createAgentSession: queries.createAgentSession,
        ...(mockSpawnOpenCode ? { spawnOpenCode: mockSpawnOpenCode } : {}),
      });
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
        repoRoot: wiringDeps.repoRoot,
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
  };

  const handlers = createOrchestratorRouteHandlers(routeDeps);

  const streamHandler = wiringDeps.sseRegistry
    ? createStreamRouteHandler({ sseRegistry: wiringDeps.sseRegistry })
    : undefined;

  return {
    assign: withRequestLogging("orchestrator.assign", "POST", handlers.assign),
    status: withRequestLogging("orchestrator.status", "GET", handlers.status),
    accept: withRequestLogging("orchestrator.accept", "POST", handlers.accept),
    abort: withRequestLogging("orchestrator.abort", "POST", handlers.abort),
    ...(streamHandler
      ? { stream: withRequestLogging("orchestrator.stream", "GET", streamHandler.stream) }
      : {}),
  };
}
