import { describe, expect, test, beforeEach } from "bun:test";
import { RecordId } from "surrealdb";
import {
  sendSessionPrompt,
  clearHandleRegistry,
  createOrchestratorSession,
  type PromptSessionResult,
} from "../../../app/src/server/orchestrator/session-lifecycle";
import type { AgentSpawnConfig } from "../../../app/src/server/orchestrator/agent-options";

// ---------------------------------------------------------------------------
// Stubs & helpers
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

function spawnAgentStub() {
  const abortCalls: string[] = [];
  return {
    spawn: (config: AgentSpawnConfig) => ({
      messages: (async function* () {})(),
      abort: () => {
        abortCalls.push("aborted");
      },
    }),
    abortCalls,
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
) {
  const { spawn } = spawnAgentStub();
  const agentSessionStub = createAgentSessionStub(agentSessionId);
  const assignmentStub = validateAssignmentStubOk();

  await createOrchestratorSession({
    surreal: surrealSpy.stub as any,
    shellExec: successShellExec(),
    brainBaseUrl: "http://localhost:3000",
    workspaceId: "ws-1",
    taskId: "task-abc",
    spawnAgent: spawn,
    validateAssignment: assignmentStub.fn,
    createAgentSession: agentSessionStub.fn as any,
  });
}

// ---------------------------------------------------------------------------
// Tests: sendSessionPrompt
// ---------------------------------------------------------------------------

describe("sendSessionPrompt", () => {
  beforeEach(() => {
    clearHandleRegistry();
  });

  test("returns not-supported error for active session (SDK has no sendPrompt)", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "active",
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    await seedSessionWithHandle(surrealSpy, "sess-1");

    const result = await sendSessionPrompt({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      text: "Please add input validation",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_ERROR");
      expect(result.error.message).toContain("not supported");
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
});
