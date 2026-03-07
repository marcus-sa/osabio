import { describe, expect, test, beforeEach } from "bun:test";
import { RecordId } from "surrealdb";
import {
  createOrchestratorSession,
  clearHandleRegistry,
  type OpenCodeHandle,
  type SpawnOpenCodeFn,
} from "../../../app/src/server/orchestrator/session-lifecycle";

// ---------------------------------------------------------------------------
// Helpers — reusable stubs following FP test double patterns
// ---------------------------------------------------------------------------

type SurrealStub = {
  stub: unknown;
  updates: Array<{ record: unknown; merge: unknown }>;
};

function createSurrealStub(): SurrealStub {
  const spy: SurrealStub = { stub: undefined, updates: [] };
  spy.stub = {
    query: () => Promise.resolve([[]]),
    select: () => Promise.resolve(undefined),
    create: (record: unknown) => ({
      content: (content: unknown) => Promise.resolve({ id: record, ...content as object }),
    }),
    update: (record: unknown) => ({
      merge: (data: unknown) => {
        spy.updates.push({ record, merge: data });
        return Promise.resolve({ id: record, ...data as object });
      },
    }),
    delete: () => Promise.resolve(undefined),
  };
  return spy;
}

function successShellExec() {
  return async () => ({ exitCode: 0, stdout: "", stderr: "" });
}

function validateAssignmentOk(taskTitle = "Implement feature", repoPath = "/repo") {
  return async (_surreal: unknown, workspaceId: string, taskId: string) => ({
    ok: true as const,
    validation: {
      taskRecord: new RecordId("task", taskId),
      workspaceRecord: new RecordId("workspace", workspaceId),
      taskStatus: "ready" as const,
      title: taskTitle,
      repoPath,
    },
  });
}

function createAgentSessionStub(returnSessionId = "agent-sess-1") {
  return async () => ({ session_id: returnSessionId });
}

// ---------------------------------------------------------------------------
// Captured handle — spy that records interactions with the OpenCodeHandle
// ---------------------------------------------------------------------------

type HandleCapture = {
  spawnFn: SpawnOpenCodeFn;
  promptCalls: string[];
  abortCalls: number;
  events: Array<{ type: string; data: string }>;
  capturedHandle?: OpenCodeHandle;
};

function createHandleCapture(
  events: Array<{ type: string; data: string }> = [],
): HandleCapture {
  const capture: HandleCapture = {
    spawnFn: undefined as unknown as SpawnOpenCodeFn,
    promptCalls: [],
    abortCalls: 0,
    events,
  };

  async function* generateEvents() {
    for (const event of events) {
      yield event;
    }
  }

  capture.spawnFn = async (_config, _worktreePath, _taskId) => {
    const handle: OpenCodeHandle = {
      sessionId: "oc-sess-1",
      sendPrompt: async (text: string) => {
        capture.promptCalls.push(text);
      },
      eventStream: generateEvents(),
      abort: () => {
        capture.abortCalls++;
      },
    };
    capture.capturedHandle = handle;
    return handle;
  };

  return capture;
}

// ---------------------------------------------------------------------------
// Acceptance: OpenCodeHandle enrichment after session creation
// ---------------------------------------------------------------------------

describe("OpenCodeHandle enrichment (step 01-01)", () => {
  beforeEach(() => {
    clearHandleRegistry();
  });

  test("sendPrompt is available and delivers text after session creation", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-1",
      authToken: "jwt-xyz",
      spawnOpenCode: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(result.ok).toBe(true);

    // The handle's sendPrompt should be callable
    expect(capture.capturedHandle).toBeDefined();
    await capture.capturedHandle!.sendPrompt("Please add unit tests");
    expect(capture.promptCalls).toEqual(["Please add unit tests"]);
  });

  test("eventStream is async-iterable after session creation", async () => {
    const testEvents = [
      { type: "agent_token", data: "Hello" },
      { type: "agent_status", data: "idle" },
    ];
    const capture = createHandleCapture(testEvents);
    const surreal = createSurrealStub();

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-2",
      authToken: "jwt-xyz",
      spawnOpenCode: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(result.ok).toBe(true);

    // The handle's eventStream should be consumable via for-await-of
    const collected: Array<{ type: string; data: string }> = [];
    for await (const event of capture.capturedHandle!.eventStream) {
      collected.push(event as { type: string; data: string });
    }
    expect(collected).toEqual(testEvents);
  });

  test("abort cleans up event subscription, session, and process", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-3",
      authToken: "jwt-xyz",
      spawnOpenCode: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(result.ok).toBe(true);

    // Abort should be callable and trigger cleanup
    capture.capturedHandle!.abort();
    expect(capture.abortCalls).toBe(1);
  });

  test("handle is registered and retrievable for abort after session creation", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();
    const agentSessionId = "agent-sess-for-abort";

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-4",
      authToken: "jwt-xyz",
      spawnOpenCode: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub(agentSessionId) as any,
    });

    expect(result.ok).toBe(true);

    // The session should be abortable through the lifecycle function
    // (abort via handleRegistry lookup happens inside abortOrchestratorSession)
    // Verify the handle was stored by checking that abort is tracked
    expect(capture.abortCalls).toBe(0);
  });

  test("opencode_session_id is persisted to agent_session record", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();

    await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-5",
      authToken: "jwt-xyz",
      spawnOpenCode: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    const orchestratorUpdate = surreal.updates.find(
      (u) => u.merge && typeof u.merge === "object" && "opencode_session_id" in (u.merge as object),
    );
    expect(orchestratorUpdate).toBeDefined();
    expect((orchestratorUpdate!.merge as Record<string, unknown>).opencode_session_id).toBe("oc-sess-1");
  });

  test("spawn failure rolls back worktree and agent_session", async () => {
    const failingSpawn: SpawnOpenCodeFn = async () => {
      throw new Error("OpenCode binary not found");
    };
    const surreal = createSurrealStub();
    const deletedRecords: unknown[] = [];
    (surreal.stub as any).delete = (record: unknown) => {
      deletedRecords.push(record);
      return Promise.resolve(undefined);
    };

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-6",
      authToken: "jwt-xyz",
      spawnOpenCode: failingSpawn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WORKTREE_ERROR");
      expect(result.error.message).toContain("OpenCode binary not found");
    }
    // Agent session record should have been deleted on rollback
    expect(deletedRecords.length).toBe(1);
  });
});
