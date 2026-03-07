import { describe, it, expect, beforeEach, afterEach } from "bun:test";

/**
 * Unit tests for orchestrator-api.ts client module.
 *
 * Strategy: stub global fetch to verify URL construction, HTTP method,
 * request body, and error handling. Each function is tested for:
 *   - correct endpoint URL with workspaceId interpolation
 *   - correct HTTP method (POST or GET)
 *   - correct request body (when applicable)
 *   - typed response parsing on success
 *   - error throwing with status and message on failure
 */

// We import the module under test after defining the fetch stub
import {
  assignAgent,
  getSessionStatus,
  getSessionReview,
  acceptSession,
  rejectSession,
  abortSession,
  sendPrompt,
  OrchestratorError,
} from "../../app/src/client/graph/orchestrator-api";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

let fetchCalls: FetchCall[];
let fetchStub: (url: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  // Default stub returns 200 with empty JSON
  fetchStub = async () => new Response(JSON.stringify({}), { status: 200 });
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    fetchCalls.push({ url: urlStr, init });
    return fetchStub(urlStr, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// assignAgent
// ---------------------------------------------------------------------------

describe("assignAgent", () => {
  it("POSTs to /api/orchestrator/:ws/assign with taskId body", async () => {
    const mockResponse = {
      agentSessionId: "session-123",
      streamId: "stream-456",
      streamUrl: "/api/orchestrator/ws-1/sessions/session-123/stream",
    };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 });

    const result = await assignAgent("ws-1", "task-abc");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-1/assign");
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(JSON.parse(fetchCalls[0].init?.body as string)).toEqual({
      taskId: "task-abc",
    });
    expect(result).toEqual(mockResponse);
  });

  it("throws OrchestratorError with code, message, httpStatus on failure", async () => {
    fetchStub = async () =>
      new Response("Task not found", { status: 404 });

    try {
      await assignAgent("ws-1", "bad-task");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OrchestratorError);
      const oe = err as OrchestratorError;
      expect(oe.code).toBe("SESSION_NOT_FOUND");
      expect(oe.message).toBe("Task not found");
      expect(oe.httpStatus).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// getSessionStatus
// ---------------------------------------------------------------------------

describe("getSessionStatus", () => {
  it("GETs /api/orchestrator/:ws/sessions/:id", async () => {
    const mockResponse = {
      agentSessionId: "s-1",
      orchestratorStatus: "active",
      startedAt: "2026-03-07T12:00:00Z",
    };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 });

    const result = await getSessionStatus("ws-2", "s-1");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-2/sessions/s-1");
    expect(fetchCalls[0].init).toBeUndefined(); // GET calls pass no RequestInit
    expect(result).toEqual(mockResponse);
  });

  it("throws OrchestratorError on error response", async () => {
    fetchStub = async () =>
      new Response("Session not found", { status: 404 });

    try {
      await getSessionStatus("ws-2", "bad");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OrchestratorError);
      const oe = err as OrchestratorError;
      expect(oe.code).toBe("SESSION_NOT_FOUND");
      expect(oe.httpStatus).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// getSessionReview
// ---------------------------------------------------------------------------

describe("getSessionReview", () => {
  it("GETs /api/orchestrator/:ws/sessions/:id/review", async () => {
    const mockResponse = {
      taskTitle: "Fix login bug",
      diff: { files: [], rawDiff: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
      session: { orchestratorStatus: "idle", startedAt: "2026-03-07T12:00:00Z" },
    };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 });

    const result = await getSessionReview("ws-3", "s-1");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-3/sessions/s-1/review");
    expect(result.taskTitle).toBe("Fix login bug");
  });

  it("throws OrchestratorError on error response", async () => {
    fetchStub = async () =>
      new Response("Review not available", { status: 400 });

    try {
      await getSessionReview("ws-3", "s-1");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OrchestratorError);
      const oe = err as OrchestratorError;
      expect(oe.code).toBe("BAD_REQUEST");
      expect(oe.httpStatus).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// acceptSession
// ---------------------------------------------------------------------------

describe("acceptSession", () => {
  it("POSTs to /api/orchestrator/:ws/sessions/:id/accept", async () => {
    const mockResponse = { accepted: true, taskStatus: "done" };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 });

    const result = await acceptSession("ws-4", "s-2");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-4/sessions/s-2/accept");
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(result).toEqual(mockResponse);
  });

  it("sends optional summary in body", async () => {
    fetchStub = async () =>
      new Response(JSON.stringify({ accepted: true, taskStatus: "done" }), { status: 200 });

    await acceptSession("ws-4", "s-2", "Looks good");

    const body = JSON.parse(fetchCalls[0].init?.body as string);
    expect(body.summary).toBe("Looks good");
  });

  it("throws OrchestratorError with SESSION_ERROR for 409", async () => {
    fetchStub = async () =>
      new Response("Session not idle", { status: 409 });

    try {
      await acceptSession("ws-4", "s-2");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OrchestratorError);
      const oe = err as OrchestratorError;
      expect(oe.code).toBe("SESSION_ERROR");
      expect(oe.httpStatus).toBe(409);
    }
  });
});

// ---------------------------------------------------------------------------
// rejectSession
// ---------------------------------------------------------------------------

describe("rejectSession", () => {
  it("POSTs to /api/orchestrator/:ws/sessions/:id/reject with feedback", async () => {
    const mockResponse = { rejected: true, continuing: true };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 });

    const result = await rejectSession("ws-5", "s-3", "Needs error handling");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-5/sessions/s-3/reject");
    expect(fetchCalls[0].init?.method).toBe("POST");
    const body = JSON.parse(fetchCalls[0].init?.body as string);
    expect(body.feedback).toBe("Needs error handling");
    expect(result).toEqual(mockResponse);
  });

  it("throws OrchestratorError on error response", async () => {
    fetchStub = async () =>
      new Response("Cannot reject completed session", { status: 409 });

    try {
      await rejectSession("ws-5", "s-3", "feedback");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OrchestratorError);
      const oe = err as OrchestratorError;
      expect(oe.code).toBe("SESSION_ERROR");
      expect(oe.httpStatus).toBe(409);
    }
  });
});

// ---------------------------------------------------------------------------
// abortSession
// ---------------------------------------------------------------------------

describe("abortSession", () => {
  it("POSTs to /api/orchestrator/:ws/sessions/:id/abort", async () => {
    const mockResponse = { aborted: true, taskStatus: "ready" };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 });

    const result = await abortSession("ws-6", "s-4");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-6/sessions/s-4/abort");
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(result).toEqual(mockResponse);
  });

  it("throws OrchestratorError on error response", async () => {
    fetchStub = async () =>
      new Response("Session already aborted", { status: 409 });

    try {
      await abortSession("ws-6", "s-4");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OrchestratorError);
      const oe = err as OrchestratorError;
      expect(oe.code).toBe("SESSION_ERROR");
      expect(oe.httpStatus).toBe(409);
    }
  });
});

// ---------------------------------------------------------------------------
// sendPrompt
// ---------------------------------------------------------------------------

describe("sendPrompt", () => {
  it("POSTs to /api/orchestrator/:ws/sessions/:id/prompt with text body", async () => {
    const mockResponse = { delivered: true };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 202 });

    const result = await sendPrompt("ws-7", "s-5", "Add input validation");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-7/sessions/s-5/prompt");
    expect(fetchCalls[0].init?.method).toBe("POST");
    const body = JSON.parse(fetchCalls[0].init?.body as string);
    expect(body.text).toBe("Add input validation");
    expect(result).toEqual(mockResponse);
  });

  it("throws OrchestratorError with code, message, httpStatus on failure", async () => {
    fetchStub = async () =>
      new Response("Session is completed", { status: 409 });

    try {
      await sendPrompt("ws-7", "s-5", "Try again");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OrchestratorError);
      const oe = err as OrchestratorError;
      expect(oe.code).toBe("SESSION_ERROR");
      expect(oe.message).toBe("Session is completed");
      expect(oe.httpStatus).toBe(409);
    }
  });
});

// ---------------------------------------------------------------------------
// URL encoding
// ---------------------------------------------------------------------------

describe("URL encoding", () => {
  it("encodes workspaceId with special characters", async () => {
    fetchStub = async () =>
      new Response(JSON.stringify({}), { status: 200 });

    await getSessionStatus("ws/special&chars", "s-1");

    expect(fetchCalls[0].url).toBe(
      `/api/orchestrator/${encodeURIComponent("ws/special&chars")}/sessions/s-1`,
    );
  });

  it("encodes sessionId with special characters", async () => {
    fetchStub = async () =>
      new Response(JSON.stringify({}), { status: 200 });

    await getSessionStatus("ws-1", "s/special&id");

    expect(fetchCalls[0].url).toBe(
      `/api/orchestrator/ws-1/sessions/${encodeURIComponent("s/special&id")}`,
    );
  });
});
