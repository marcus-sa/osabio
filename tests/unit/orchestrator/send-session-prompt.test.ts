import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import {
  sendSessionPrompt,
  type PromptSessionResult,
} from "../../../app/src/server/orchestrator/session-lifecycle";
import type { SandboxAgentAdapter } from "../../../app/src/server/orchestrator/sandbox-adapter";

// ---------------------------------------------------------------------------
// Stubs & helpers
// ---------------------------------------------------------------------------

type SurrealSpy = {
  stub: unknown;
  updates: Array<{ record: unknown; merge: unknown }>;
};

function createSurrealSpy(responses: {
  sessionSelect?: Record<string, unknown>;
}): SurrealSpy {
  const spy: SurrealSpy = {
    stub: undefined,
    updates: [],
  };

  spy.stub = {
    query(sql: string, _bindings?: Record<string, unknown>) {
      // Session lookup by ID
      if (sql.includes("FROM $sessionRecord") || sql.includes("FROM $record")) {
        return Promise.resolve([responses.sessionSelect ? [responses.sessionSelect] : []]);
      }
      return Promise.resolve([[]]);
    },
    update(record: unknown) {
      return {
        merge(data: unknown) {
          spy.updates.push({ record, merge: data });
          return Promise.resolve({ id: record, ...(data as object) });
        },
      };
    },
    select(record: unknown) {
      return Promise.resolve(responses.sessionSelect ?? undefined);
    },
  };

  return spy;
}

function mockAdapterStub(): SandboxAgentAdapter {
  return {
    createSession: async () => ({
      id: `ext-${crypto.randomUUID()}`,
      prompt: async () => ({ stopReason: "end_turn" as const }) as any,
      onEvent: () => () => {},
      onPermissionRequest: () => () => {},
      respondPermission: async () => {},
    }),
    resumeSession: async (sessionId) => ({
      id: sessionId,
      prompt: async () => ({ stopReason: "end_turn" as const }) as any,
      onEvent: () => () => {},
      onPermissionRequest: () => () => {},
      respondPermission: async () => {},
    }),
    destroySession: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests: sendSessionPrompt
// ---------------------------------------------------------------------------

describe("sendSessionPrompt", () => {
  test("delivers prompt via adapter for active session with external_session_id", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "active",
        external_session_id: "ext-123",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Please add input validation",
      adapter: mockAdapterStub(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.delivered).toBe(true);
    }
  });

  test("returns 404 for nonexistent session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: undefined,
    });

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "nonexistent",
      text: "Hello",
      adapter: mockAdapterStub(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
      expect(result.error.httpStatus).toBe(404);
    }
  });

  test("returns 404 for completed session (terminal sessions are gone)", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "completed",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "More work please",
      adapter: mockAdapterStub(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
      expect(result.error.httpStatus).toBe(404);
    }
  });

  test("returns 404 for aborted session (terminal sessions are gone)", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "aborted",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Try again",
      adapter: mockAdapterStub(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
      expect(result.error.httpStatus).toBe(404);
    }
  });
});
