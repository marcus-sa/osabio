import { describe, expect, test } from "bun:test";
import {
  createOrchestratorRouteHandlers,
  type OrchestratorRouteDeps,
} from "../../../app/src/server/orchestrator/routes";

// ---------------------------------------------------------------------------
// Stub deps (only the prompt-related path)
// ---------------------------------------------------------------------------

function createRouteDepsStub(overrides: Partial<OrchestratorRouteDeps> = {}): OrchestratorRouteDeps {
  return {
    createSession: async () => ({ ok: true, value: { agentSessionId: "s1", streamId: "st1", worktreeBranch: "agent/x" } }),
    getSessionStatus: async () => ({ ok: true, value: { orchestratorStatus: "active" as const } }),
    abortSession: async () => ({ ok: true, value: { aborted: true, sessionId: "s1" } }),
    acceptSession: async () => ({ ok: true, value: { accepted: true, sessionId: "s1" } }),
    getReview: async () => ({ ok: true, value: { taskTitle: "t", diff: {}, session: {} } }),
    rejectSession: async () => ({ ok: true, value: { rejected: true, continuing: true } }),
    sendPrompt: async () => ({ ok: true, value: { delivered: true } }),
    ...overrides,
  };
}

function makeRequest(body: object, sessionId = "sess-1"): Request & { params: Record<string, string> } {
  const req = new Request("http://localhost/api/orchestrator/ws-1/sessions/sess-1/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as Request & { params: Record<string, string> };
  req.params = { workspaceId: "ws-1", sessionId };
  return req;
}

// ---------------------------------------------------------------------------
// Tests: prompt route handler
// ---------------------------------------------------------------------------

describe("prompt route handler", () => {
  test("returns 202 when prompt delivered successfully", async () => {
    const deps = createRouteDepsStub();
    const handlers = createOrchestratorRouteHandlers(deps);
    const request = makeRequest({ text: "Add tests please" });

    const response = await handlers.prompt(request);

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.delivered).toBe(true);
  });

  test("returns 400 when text is missing", async () => {
    const deps = createRouteDepsStub();
    const handlers = createOrchestratorRouteHandlers(deps);
    const request = makeRequest({});

    const response = await handlers.prompt(request);

    expect(response.status).toBe(400);
  });

  test("returns 400 when text is empty string", async () => {
    const deps = createRouteDepsStub();
    const handlers = createOrchestratorRouteHandlers(deps);
    const request = makeRequest({ text: "" });

    const response = await handlers.prompt(request);

    expect(response.status).toBe(400);
  });

  test("returns 400 when text is whitespace only", async () => {
    const deps = createRouteDepsStub();
    const handlers = createOrchestratorRouteHandlers(deps);
    const request = makeRequest({ text: "   " });

    const response = await handlers.prompt(request);

    expect(response.status).toBe(400);
  });

  test("forwards session error (404) from lifecycle", async () => {
    const deps = createRouteDepsStub({
      sendPrompt: async () => ({
        ok: false,
        error: { code: "SESSION_NOT_FOUND" as const, message: "Session not found", httpStatus: 404 },
      }),
    });
    const handlers = createOrchestratorRouteHandlers(deps);
    const request = makeRequest({ text: "Hello" });

    const response = await handlers.prompt(request);

    expect(response.status).toBe(404);
  });

  test("forwards session error (409) from lifecycle", async () => {
    const deps = createRouteDepsStub({
      sendPrompt: async () => ({
        ok: false,
        error: { code: "SESSION_ERROR" as const, message: "Terminal", httpStatus: 409 },
      }),
    });
    const handlers = createOrchestratorRouteHandlers(deps);
    const request = makeRequest({ text: "Hello" });

    const response = await handlers.prompt(request);

    expect(response.status).toBe(409);
  });
});
