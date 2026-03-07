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

  it("throws on error response with status and message", async () => {
    fetchStub = async () =>
      new Response("Task not found", { status: 404 });

    await expect(assignAgent("ws-1", "bad-task")).rejects.toThrow("404");
    await expect(assignAgent("ws-1", "bad-task")).rejects.toThrow(
      "Task not found",
    );
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
    expect(fetchCalls[0].init?.method).toBeUndefined(); // GET = no method needed
    expect(result).toEqual(mockResponse);
  });

  it("throws on error response", async () => {
    fetchStub = async () =>
      new Response("Session not found", { status: 404 });

    await expect(getSessionStatus("ws-2", "bad")).rejects.toThrow("404");
  });
});

// ---------------------------------------------------------------------------
// getSessionReview
// ---------------------------------------------------------------------------

describe("getSessionReview", () => {
  it("GETs /api/orchestrator/:ws/sessions/:id/review", async () => {
    const mockResponse = {
      agentSessionId: "s-1",
      taskId: "t-1",
      taskTitle: "Fix login bug",
      diff: { files: [], rawDiff: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
      session: { startedAt: "2026-03-07T12:00:00Z", decisionsCount: 0, questionsCount: 0, observationsCount: 0 },
    };
    fetchStub = async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 });

    const result = await getSessionReview("ws-3", "s-1");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/orchestrator/ws-3/sessions/s-1/review");
    expect(result.taskTitle).toBe("Fix login bug");
  });

  it("throws on error response", async () => {
    fetchStub = async () =>
      new Response("Review not available", { status: 400 });

    await expect(getSessionReview("ws-3", "s-1")).rejects.toThrow("400");
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

  it("throws on error response", async () => {
    fetchStub = async () =>
      new Response("Session not idle", { status: 409 });

    await expect(acceptSession("ws-4", "s-2")).rejects.toThrow("409");
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

  it("throws on error response", async () => {
    fetchStub = async () =>
      new Response("Cannot reject completed session", { status: 409 });

    await expect(
      rejectSession("ws-5", "s-3", "feedback"),
    ).rejects.toThrow("409");
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

  it("throws on error response", async () => {
    fetchStub = async () =>
      new Response("Session already aborted", { status: 409 });

    await expect(abortSession("ws-6", "s-4")).rejects.toThrow("409");
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

  it("throws on error response with status and message", async () => {
    fetchStub = async () =>
      new Response("Session is completed", { status: 409 });

    await expect(sendPrompt("ws-7", "s-5", "Try again")).rejects.toThrow("409");
    await expect(sendPrompt("ws-7", "s-5", "Try again")).rejects.toThrow(
      "Session is completed",
    );
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
