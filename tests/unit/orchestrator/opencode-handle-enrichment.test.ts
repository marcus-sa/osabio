import { describe, expect, test, beforeEach } from "bun:test";
import { RecordId } from "surrealdb";
import {
  createOrchestratorSession,
  clearHandleRegistry,
  getHandle,
} from "../../../app/src/server/orchestrator/session-lifecycle";
import type { AgentHandle, SpawnAgentFn } from "../../../app/src/server/orchestrator/spawn-agent";
import type { AgentSpawnConfig } from "../../../app/src/server/orchestrator/agent-options";

// ---------------------------------------------------------------------------
// Helpers -- reusable stubs following FP test double patterns
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
// Captured handle -- spy that records interactions with the AgentHandle
// ---------------------------------------------------------------------------

type HandleCapture = {
  spawnFn: SpawnAgentFn;
  abortCalls: number;
  receivedConfig?: AgentSpawnConfig;
  capturedHandle?: AgentHandle;
};

function createHandleCapture(
  messages: unknown[] = [],
): HandleCapture {
  const capture: HandleCapture = {
    spawnFn: undefined as unknown as SpawnAgentFn,
    abortCalls: 0,
  };

  async function* generateMessages() {
    for (const msg of messages) {
      yield msg;
    }
  }

  capture.spawnFn = (config: AgentSpawnConfig) => {
    capture.receivedConfig = config;
    const handle: AgentHandle = {
      messages: generateMessages(),
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
// Tests: AgentHandle lifecycle after session creation (step 02-01 migration)
// ---------------------------------------------------------------------------

describe("AgentHandle lifecycle (step 02-01)", () => {
  beforeEach(() => {
    clearHandleRegistry();
  });

  test("messages stream is async-iterable after session creation", async () => {
    const testMessages = [
      { type: "assistant", content: [{ type: "text", text: "Hello" }] },
      { type: "result", subtype: "success", duration_ms: 500 },
    ];
    const capture = createHandleCapture(testMessages);
    const surreal = createSurrealStub();

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-2",
      spawnAgent: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(result.ok).toBe(true);

    // The handle's messages should be consumable via for-await-of
    const collected: unknown[] = [];
    for await (const msg of capture.capturedHandle!.messages) {
      collected.push(msg);
    }
    expect(collected).toEqual(testMessages);
  });

  test("abort cleans up agent process", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-3",
      spawnAgent: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(result.ok).toBe(true);

    // Abort should be callable and trigger cleanup
    capture.capturedHandle!.abort();
    expect(capture.abortCalls).toBe(1);
  });

  test("handle is registered and retrievable via getHandle", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();
    const agentSessionId = "agent-sess-for-abort";

    const result = await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-4",
      spawnAgent: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub(agentSessionId) as any,
    });

    expect(result.ok).toBe(true);

    // Handle should be retrievable from the registry
    const retrieved = getHandle(agentSessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved).toBe(capture.capturedHandle);
  });

  test("session record does NOT contain opencode_session_id", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();

    await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-5",
      spawnAgent: capture.spawnFn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    // No update should contain opencode_session_id
    const hasOpencodeId = surreal.updates.some(
      (u) => u.merge && typeof u.merge === "object" && "opencode_session_id" in (u.merge as object),
    );
    expect(hasOpencodeId).toBe(false);
  });

  test("spawn failure rolls back worktree and agent_session", async () => {
    const failingSpawn: SpawnAgentFn = (_config: AgentSpawnConfig) => {
      throw new Error("Agent SDK not available");
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
      spawnAgent: failingSpawn,
      validateAssignment: validateAssignmentOk(),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WORKTREE_ERROR");
      expect(result.error.message).toContain("Agent SDK not available");
    }
    // Agent session record should have been deleted on rollback
    expect(deletedRecords.length).toBe(1);
  });

  test("spawnAgent receives correct AgentSpawnConfig", async () => {
    const capture = createHandleCapture();
    const surreal = createSurrealStub();

    await createOrchestratorSession({
      surreal: surreal.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-7",
      spawnAgent: capture.spawnFn,
      validateAssignment: validateAssignmentOk("My Task", "/repo"),
      createAgentSession: createAgentSessionStub() as any,
    });

    expect(capture.receivedConfig).toBeDefined();
    expect(capture.receivedConfig!.workDir).toContain("/repo");
    expect(capture.receivedConfig!.workspaceId).toBe("ws-1");
    expect(capture.receivedConfig!.brainBaseUrl).toBe("http://localhost:3000");
    expect(capture.receivedConfig!.prompt).toContain("task-7");
  });
});
