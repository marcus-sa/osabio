/**
 * Unit tests for orchestrator route handlers.
 *
 * Tests the HTTP boundary: request parsing, response shaping, delegation to
 * session-lifecycle functions, and error mapping.
 *
 * All session-lifecycle dependencies are pure function stubs -- no DB, no IO.
 */
import { describe, expect, it } from "bun:test";
import {
  createOrchestratorRouteHandlers,
  type OrchestratorRouteDeps,
} from "../../../app/src/server/orchestrator/routes";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function stubDeps(overrides: Partial<OrchestratorRouteDeps> = {}): OrchestratorRouteDeps {
  return {
    createSession: async () => ({
      ok: true as const,
      value: {
        agentSessionId: "sess-123",
        streamId: "stream-sess-123",
        worktreeBranch: "agent/test-task",
      },
    }),
    getSessionStatus: async () => ({
      ok: true as const,
      value: {
        orchestratorStatus: "spawning" as const,
        worktreeBranch: "agent/test-task",
        startedAt: "2026-03-07T00:00:00Z",
      },
    }),
    abortSession: async () => ({
      ok: true as const,
      value: { aborted: true, sessionId: "sess-123" },
    }),
    acceptSession: async () => ({
      ok: true as const,
      value: { accepted: true, sessionId: "sess-123" },
    }),
    ...overrides,
  };
}

function makeRequest(
  method: string,
  path: string,
  params: Record<string, string>,
  body?: object,
): Request & { params: Record<string, string> } {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) {
    init.body = JSON.stringify(body);
  }
  const req = new Request(`http://localhost${path}`, init) as Request & {
    params: Record<string, string>;
  };
  req.params = params;
  return req;
}

// ---------------------------------------------------------------------------
// assign route
// ---------------------------------------------------------------------------

describe("orchestrator routes: assign", () => {
  it("returns agentSessionId and streamUrl on successful assignment", async () => {
    const handlers = createOrchestratorRouteHandlers(stubDeps());
    const req = makeRequest(
      "POST",
      "/api/orchestrator/ws-1/assign",
      { workspaceId: "ws-1" },
      { taskId: "task-1" },
    );

    const response = await handlers.assign(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agentSessionId).toBe("sess-123");
    expect(body.streamId).toBe("stream-sess-123");
    expect(body.streamUrl).toContain("sess-123");
  });

  it("returns 400 when taskId is missing from body", async () => {
    const handlers = createOrchestratorRouteHandlers(stubDeps());
    const req = makeRequest(
      "POST",
      "/api/orchestrator/ws-1/assign",
      { workspaceId: "ws-1" },
      {},
    );

    const response = await handlers.assign(req);
    expect(response.status).toBe(400);
  });

  it("maps session error to appropriate HTTP status", async () => {
    const handlers = createOrchestratorRouteHandlers(
      stubDeps({
        createSession: async () => ({
          ok: false as const,
          error: {
            code: "TASK_NOT_FOUND" as const,
            message: "Task not found: task-1",
            httpStatus: 404,
          },
        }),
      }),
    );
    const req = makeRequest(
      "POST",
      "/api/orchestrator/ws-1/assign",
      { workspaceId: "ws-1" },
      { taskId: "task-1" },
    );

    const response = await handlers.assign(req);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toContain("Task not found");
  });
});

// ---------------------------------------------------------------------------
// status route
// ---------------------------------------------------------------------------

describe("orchestrator routes: status", () => {
  it("returns session status on success", async () => {
    const handlers = createOrchestratorRouteHandlers(stubDeps());
    const req = makeRequest(
      "GET",
      "/api/orchestrator/ws-1/sessions/sess-123",
      { workspaceId: "ws-1", sessionId: "sess-123" },
    );

    const response = await handlers.status(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agentSessionId).toBe("sess-123");
    expect(body.orchestratorStatus).toBe("spawning");
    expect(body.startedAt).toBeTruthy();
  });

  it("returns 404 when session not found", async () => {
    const handlers = createOrchestratorRouteHandlers(
      stubDeps({
        getSessionStatus: async () => ({
          ok: false as const,
          error: {
            code: "SESSION_NOT_FOUND" as const,
            message: "Session not found: bad-id",
            httpStatus: 404,
          },
        }),
      }),
    );
    const req = makeRequest(
      "GET",
      "/api/orchestrator/ws-1/sessions/bad-id",
      { workspaceId: "ws-1", sessionId: "bad-id" },
    );

    const response = await handlers.status(req);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// accept route
// ---------------------------------------------------------------------------

describe("orchestrator routes: accept", () => {
  it("returns accepted true on success", async () => {
    const handlers = createOrchestratorRouteHandlers(stubDeps());
    const req = makeRequest(
      "POST",
      "/api/orchestrator/ws-1/sessions/sess-123/accept",
      { workspaceId: "ws-1", sessionId: "sess-123" },
      { summary: "Looks good" },
    );

    const response = await handlers.accept(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.taskStatus).toBe("done");
  });

  it("returns error status when session not found", async () => {
    const handlers = createOrchestratorRouteHandlers(
      stubDeps({
        acceptSession: async () => ({
          ok: false as const,
          error: {
            code: "SESSION_NOT_FOUND" as const,
            message: "Session not found",
            httpStatus: 404,
          },
        }),
      }),
    );
    const req = makeRequest(
      "POST",
      "/api/orchestrator/ws-1/sessions/bad-id/accept",
      { workspaceId: "ws-1", sessionId: "bad-id" },
    );

    const response = await handlers.accept(req);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// abort route
// ---------------------------------------------------------------------------

describe("orchestrator routes: abort", () => {
  it("returns aborted true on success", async () => {
    const handlers = createOrchestratorRouteHandlers(stubDeps());
    const req = makeRequest(
      "POST",
      "/api/orchestrator/ws-1/sessions/sess-123/abort",
      { workspaceId: "ws-1", sessionId: "sess-123" },
    );

    const response = await handlers.abort(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.aborted).toBe(true);
    expect(body.taskStatus).toBe("ready");
  });

  it("returns error status when session not found", async () => {
    const handlers = createOrchestratorRouteHandlers(
      stubDeps({
        abortSession: async () => ({
          ok: false as const,
          error: {
            code: "SESSION_NOT_FOUND" as const,
            message: "Session not found",
            httpStatus: 404,
          },
        }),
      }),
    );
    const req = makeRequest(
      "POST",
      "/api/orchestrator/ws-1/sessions/bad-id/abort",
      { workspaceId: "ws-1", sessionId: "bad-id" },
    );

    const response = await handlers.abort(req);
    expect(response.status).toBe(404);
  });
});
