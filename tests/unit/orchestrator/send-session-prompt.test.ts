import { describe, expect, test, beforeEach } from "bun:test";
import { RecordId } from "surrealdb";
import {
  sendSessionPrompt,
  clearHandleRegistry,
  createOrchestratorSession,
  type PromptSessionResult,
} from "../../../app/src/server/orchestrator/session-lifecycle";

// ---------------------------------------------------------------------------
// Stubs & helpers (same patterns as session-lifecycle.test.ts)
// ---------------------------------------------------------------------------

type SurrealSpy = {
  stub: unknown;
  updates: Array<{ record: unknown; merge: unknown }>;
  selects: Array<{ record: unknown }>;
};

function createSurrealSpy(responses: {
  sessionSelect?: Record<string, unknown>;
}): SurrealSpy {
  const spy: SurrealSpy = {
    stub: undefined,
    updates: [],
    selects: [],
  };

  spy.stub = {
    query(sql: string, _bindings?: Record<string, unknown>) {
      if (sql.includes("FROM $taskRecord")) {
        return Promise.resolve([[]]);
      }
      if (sql.includes("orchestrator_status") && sql.includes("agent_session")) {
        return Promise.resolve([[]]);
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
      spy.selects.push({ record });
      return Promise.resolve(responses.sessionSelect ?? undefined);
    },
    delete(_record: unknown) {
      return Promise.resolve();
    },
  };

  return spy;
}

function spawnOpenCodeStub(sessionId = "opencode-sess-1") {
  const abortCalls: string[] = [];
  const promptCalls: string[] = [];
  return {
    spawn: async (_config: unknown, _worktreePath: string, _taskId: string) => ({
      sessionId,
      abort: () => {
        abortCalls.push(sessionId);
      },
      sendPrompt: async (text: string) => {
        promptCalls.push(text);
      },
      eventStream: (async function* () {})(),
    }),
    abortCalls,
    promptCalls,
  };
}

function successShellExec() {
  return async (_cmd: string, _args: string[], _cwd: string) => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
}

function validateAssignmentStubOk(taskTitle = "Task", repoPath = "/repo") {
  return {
    fn: async (_surreal: unknown, workspaceId: string, taskId: string) => ({
      ok: true as const,
      validation: {
        taskRecord: new RecordId("task", taskId),
        workspaceRecord: new RecordId("workspace", workspaceId),
        taskStatus: "ready" as const,
        title: taskTitle,
        repoPath,
      },
    }),
  };
}

function createAgentSessionStub(returnSessionId = "agent-sess-1") {
  return {
    fn: async (_input: Record<string, unknown>) => ({
      session_id: returnSessionId,
    }),
  };
}

// ---------------------------------------------------------------------------
// Helper: create a session to populate the handle registry
// ---------------------------------------------------------------------------

async function seedSessionWithHandle(
  surrealSpy: SurrealSpy,
  agentSessionId: string,
  openCodeSessionId = "oc-sess-1",
) {
  const { spawn, promptCalls } = spawnOpenCodeStub(openCodeSessionId);
  const agentSessionStub = createAgentSessionStub(agentSessionId);
  const assignmentStub = validateAssignmentStubOk();

  await createOrchestratorSession({
    surreal: surrealSpy.stub as any,
    shellExec: successShellExec(),
    brainBaseUrl: "http://localhost:3000",
    workspaceId: "ws-1",
    taskId: "task-abc",
    authToken: "jwt-xyz",
    spawnOpenCode: spawn,
    validateAssignment: assignmentStub.fn,
    createAgentSession: agentSessionStub.fn as any,
  });

  return { promptCalls };
}

// ---------------------------------------------------------------------------
// Tests: sendSessionPrompt
// ---------------------------------------------------------------------------

describe("sendSessionPrompt", () => {
  beforeEach(() => {
    clearHandleRegistry();
  });

  test("delivers prompt to active session and returns delivered: true", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "active",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const { promptCalls } = await seedSessionWithHandle(surrealSpy, "sess-1");

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Please add input validation",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.delivered).toBe(true);
    }
    expect(promptCalls).toContain("Please add input validation");
  });

  test("delivers prompt to idle session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "idle",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const { promptCalls } = await seedSessionWithHandle(surrealSpy, "sess-1");

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Continue with error handling",
    });

    expect(result.ok).toBe(true);
    expect(promptCalls).toContain("Continue with error handling");
  });

  test("delivers prompt to spawning session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "spawning",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const { promptCalls } = await seedSessionWithHandle(surrealSpy, "sess-1");

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Extra context for the task",
    });

    expect(result.ok).toBe(true);
    expect(promptCalls).toContain("Extra context for the task");
  });

  test("returns 404 for nonexistent session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: undefined,
    });

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "nonexistent",
      text: "Hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
      expect(result.error.httpStatus).toBe(404);
    }
  });

  test("returns 409 for completed session", async () => {
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
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("returns 409 for aborted session", async () => {
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
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("returns 409 for error session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "error",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Retry",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("returns 409 when handle is missing from registry", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "active",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });
    // Note: no seedSessionWithHandle -- handle registry is empty

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
      expect(result.error.message).toContain("handle");
    }
  });
});
