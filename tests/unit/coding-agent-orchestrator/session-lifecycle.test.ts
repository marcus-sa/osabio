import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import type {
  SessionDeps,
  OrchestratorSessionResult,
  SessionStatusResult,
  AbortSessionResult,
  AcceptSessionResult,
  ReviewResult,
  RejectSessionResult,
} from "../../../app/src/server/orchestrator/session-lifecycle";
import type { AgentHandle, SpawnAgentFn } from "../../../app/src/server/orchestrator/spawn-agent";
import type { AgentSpawnConfig } from "../../../app/src/server/orchestrator/agent-options";
import {
  createOrchestratorSession,
  getOrchestratorSessionStatus,
  abortOrchestratorSession,
  acceptOrchestratorSession,
  getOrchestratorReview,
  rejectOrchestratorSession,
  startEventIteration,
  type EventIterationDeps,
} from "../../../app/src/server/orchestrator/session-lifecycle";

// ---------------------------------------------------------------------------
// Stubs & helpers
// ---------------------------------------------------------------------------

type QueryResult = Array<Record<string, unknown>>;

/** Tracks calls made to the surreal stub for spy assertions */
type SurrealSpy = {
  stub: unknown;
  queries: Array<{ sql: string; bindings?: Record<string, unknown> }>;
  creates: Array<{ record: unknown; content: unknown }>;
  updates: Array<{ record: unknown; merge: unknown }>;
  selects: Array<{ record: unknown }>;
};

function createSurrealSpy(responses: {
  taskQuery?: QueryResult;
  sessionQuery?: QueryResult;
  sessionSelect?: Record<string, unknown>;
  createReturn?: Record<string, unknown>;
}): SurrealSpy {
  const spy: SurrealSpy = {
    stub: undefined,
    queries: [],
    creates: [],
    updates: [],
    selects: [],
  };

  spy.stub = {
    query(sql: string, bindings?: Record<string, unknown>) {
      spy.queries.push({ sql, bindings });

      // Task lookup
      if (sql.includes("FROM $taskRecord")) {
        return Promise.resolve([responses.taskQuery ?? []]);
      }
      // Active session check
      if (sql.includes("orchestrator_status") && sql.includes("agent_session")) {
        return Promise.resolve([responses.sessionQuery ?? []]);
      }
      // Session orchestrator fields query (for getStatus)
      if (sql.includes("orchestrator_status") && sql.includes("$sessionRecord")) {
        return Promise.resolve([responses.sessionSelect ? [responses.sessionSelect] : []]);
      }
      // Update queries
      if (sql.includes("UPDATE")) {
        return Promise.resolve([responses.createReturn ?? {}]);
      }
      return Promise.resolve([[]]);
    },
    create(record: unknown) {
      return {
        content(content: unknown) {
          spy.creates.push({ record, content });
          return Promise.resolve(responses.createReturn ?? { id: record });
        },
      };
    },
    update(record: unknown) {
      return {
        merge(data: unknown) {
          spy.updates.push({ record, merge: data });
          return Promise.resolve({ id: record, ...data as object });
        },
      };
    },
    select(record: unknown) {
      spy.selects.push({ record });
      return Promise.resolve(responses.sessionSelect ?? undefined);
    },
    delete(_record: unknown) {
      return Promise.resolve(undefined);
    },
  };

  return spy;
}

function successShellExec(): SessionDeps["shellExec"] {
  return async (_cmd: string, _args: string[], _cwd: string) => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
}

function spawnAgentStub(): {
  spawn: SpawnAgentFn;
  abortCalls: string[];
} {
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

// Stub for createAgentSession from mcp-queries
function createAgentSessionStub(returnSessionId = "agent-sess-1") {
  const calls: Array<Record<string, unknown>> = [];
  return {
    fn: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { session_id: returnSessionId };
    },
    calls,
  };
}

// Stub for endAgentSession from mcp-queries
function endAgentSessionStub() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    fn: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { session_id: input.sessionId as string, ended: true };
    },
    calls,
  };
}

// Stub for validateAssignment
function validateAssignmentStubOk(taskTitle = "Implement feature X", repoPath = "/repo") {
  const calls: Array<{ workspaceId: string; taskId: string }> = [];
  return {
    fn: async (_surreal: unknown, workspaceId: string, taskId: string) => {
      calls.push({ workspaceId, taskId });
      return {
        ok: true as const,
        validation: {
          taskRecord: new RecordId("task", taskId),
          workspaceRecord: new RecordId("workspace", workspaceId),
          taskStatus: "ready" as const,
          title: taskTitle,
          repoPath,
        },
      };
    },
    calls,
  };
}

function resolveRepoRootStub(repoPath = "/repo") {
  return async () => repoPath;
}

function validateAssignmentStubErr(code = "TASK_NOT_FOUND") {
  return {
    fn: async (_surreal: unknown, _workspaceId: string, _taskId: string) => ({
      ok: false as const,
      error: {
        code: code as any,
        message: "Task not found",
        httpStatus: 404,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Acceptance: createOrchestratorSession returns session info on success
// ---------------------------------------------------------------------------

describe("createOrchestratorSession", () => {
  test("returns agentSessionId, streamId, and worktreeBranch on success", async () => {
    const surrealSpy = createSurrealSpy({
      sessionQuery: [],
      createReturn: {},
    });
    const { spawn } = spawnAgentStub();
    const agentSessionStub = createAgentSessionStub("agent-sess-42");
    const assignmentStub = validateAssignmentStubOk("Fix the bug");

    const result = await createOrchestratorSession({
      surreal: surrealSpy.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-abc",
      spawnAgent: spawn,
      validateAssignment: assignmentStub.fn,
      createAgentSession: agentSessionStub.fn as any,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentSessionId).toBe("agent-sess-42");
      expect(result.value.worktreeBranch).toMatch(/^agent\//);
      expect(result.value.streamId).toBeDefined();
      expect(typeof result.value.streamId).toBe("string");
    }
  });

  test("propagates assignment validation errors", async () => {
    const surrealSpy = createSurrealSpy({});
    const assignmentStub = validateAssignmentStubErr("TASK_NOT_FOUND");

    const result = await createOrchestratorSession({
      surreal: surrealSpy.stub as any,
      shellExec: successShellExec(),
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-missing",
      validateAssignment: assignmentStub.fn,
      createAgentSession: createAgentSessionStub().fn as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TASK_NOT_FOUND");
    }
  });

  test("propagates worktree creation errors", async () => {
    const surrealSpy = createSurrealSpy({});
    const assignmentStub = validateAssignmentStubOk();
    const failingShellExec: SessionDeps["shellExec"] = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "worktree already exists",
    });

    const result = await createOrchestratorSession({
      surreal: surrealSpy.stub as any,
      shellExec: failingShellExec,
      brainBaseUrl: "http://localhost:3000",
      workspaceId: "ws-1",
      taskId: "task-abc",
      validateAssignment: assignmentStub.fn,
      createAgentSession: createAgentSessionStub().fn as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WORKTREE_ERROR");
    }
  });

  test("updates agent_session with orchestrator fields after creation", async () => {
    const surrealSpy = createSurrealSpy({
      sessionQuery: [],
      createReturn: {},
    });
    const { spawn } = spawnAgentStub();
    const agentSessionStub = createAgentSessionStub("agent-sess-42");
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

    // Should have updated agent_session with orchestrator fields
    const orchestratorUpdate = surrealSpy.updates.find(
      (u) => u.merge && typeof u.merge === "object" && "orchestrator_status" in (u.merge as object),
    );
    expect(orchestratorUpdate).toBeDefined();
    const mergeData = orchestratorUpdate!.merge as Record<string, unknown>;
    expect(mergeData.orchestrator_status).toBe("spawning");
    expect(mergeData.worktree_branch).toMatch(/^agent\//);
    // opencode_session_id no longer set (SDK migration)
    expect(mergeData.opencode_session_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getOrchestratorSessionStatus
// ---------------------------------------------------------------------------

describe("getOrchestratorSessionStatus", () => {
  test("returns orchestrator fields for an existing session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "active",
        worktree_branch: "agent/fix-bug",
        worktree_path: "/repo/.brain/worktrees/agent-fix-bug",
        started_at: "2026-03-07T08:00:00Z",
        last_event_at: "2026-03-07T08:05:00Z",
      },
    });

    const result = await getOrchestratorSessionStatus({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.orchestratorStatus).toBe("active");
      expect(result.value.worktreeBranch).toBe("agent/fix-bug");
      expect(result.value.startedAt).toBe("2026-03-07T08:00:00Z");
    }
  });

  test("returns error for nonexistent session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: undefined,
    });

    const result = await getOrchestratorSessionStatus({
      surreal: surrealSpy.stub as any,
      sessionId: "nonexistent",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------------------
// abortOrchestratorSession
// ---------------------------------------------------------------------------

describe("abortOrchestratorSession", () => {
  test("marks session as aborted, kills process, removes worktree, returns task to ready", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "active",
        worktree_branch: "agent/fix-bug",
        worktree_path: "/repo/.brain/worktrees/agent-fix-bug",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });
    const { spawn, abortCalls } = spawnAgentStub();
    const endSessionStub = endAgentSessionStub();

    // First create a session to register the handle
    const agentSessionStub = createAgentSessionStub("sess-1");
    const assignmentStub = validateAssignmentStubOk();

    // Create session to populate the handle registry
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

    const result = await abortOrchestratorSession({
      surreal: surrealSpy.stub as any,
      shellExec: successShellExec(),
      resolveRepoRoot: resolveRepoRootStub(),
      sessionId: "sess-1",
      endAgentSession: endSessionStub.fn as any,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.aborted).toBe(true);
    }

    // Verify the process abort was called
    expect(abortCalls).toHaveLength(1);

    // Verify endAgentSession was called
    expect(endSessionStub.calls).toHaveLength(1);
  });

  test("returns error for nonexistent session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: undefined,
    });
    const endSessionStub = endAgentSessionStub();

    const result = await abortOrchestratorSession({
      surreal: surrealSpy.stub as any,
      shellExec: successShellExec(),
      resolveRepoRoot: resolveRepoRootStub(),
      sessionId: "nonexistent",
      endAgentSession: endSessionStub.fn as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------------------
// acceptOrchestratorSession
// ---------------------------------------------------------------------------

describe("acceptOrchestratorSession", () => {
  test("marks session as completed and task as done", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "idle",
        worktree_branch: "agent/fix-bug",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });
    const endSessionStub = endAgentSessionStub();

    const result = await acceptOrchestratorSession({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      summary: "Implemented the feature successfully",
      endAgentSession: endSessionStub.fn as any,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accepted).toBe(true);
    }

    // Verify orchestrator_status was set to completed
    const statusUpdate = surrealSpy.updates.find(
      (u) => u.merge && typeof u.merge === "object" && "orchestrator_status" in (u.merge as object),
    );
    expect(statusUpdate).toBeDefined();
    expect((statusUpdate!.merge as Record<string, unknown>).orchestrator_status).toBe("completed");

    // Verify endAgentSession was called with the summary
    expect(endSessionStub.calls).toHaveLength(1);
    expect((endSessionStub.calls[0] as Record<string, unknown>).summary).toBe(
      "Implemented the feature successfully",
    );
  });

  test("returns error for nonexistent session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: undefined,
    });
    const endSessionStub = endAgentSessionStub();

    const result = await acceptOrchestratorSession({
      surreal: surrealSpy.stub as any,
      sessionId: "nonexistent",
      summary: "done",
      endAgentSession: endSessionStub.fn as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
    }
  });

  test("returns 409 when session is aborted", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "aborted",
        worktree_branch: "agent/fix-bug",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });
    const endSessionStub = endAgentSessionStub();

    const result = await acceptOrchestratorSession({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      summary: "Looks good",
      endAgentSession: endSessionStub.fn as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
    }
  });
});

// ---------------------------------------------------------------------------
// getOrchestratorReview
// ---------------------------------------------------------------------------

describe("getOrchestratorReview", () => {
  test("returns diff, session info, and task title for idle session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "idle",
        worktree_branch: "agent/fix-bug",
        worktree_path: "/repo/.brain/worktrees/agent-fix-bug",
        started_at: "2026-03-07T08:00:00Z",
        last_event_at: "2026-03-07T08:05:00Z",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const getDiffStub = async (_repoRoot: string) => ({
      ok: true as const,
      value: {
        files: [{ path: "src/index.ts", status: "M", additions: 10, deletions: 2 }],
        rawDiff: "diff --git ...",
        stats: { filesChanged: 1, insertions: 10, deletions: 2 },
      },
    });

    const getTaskTitleStub = async () => "Fix the bug";

    const result = await getOrchestratorReview({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      resolveRepoRoot: resolveRepoRootStub(),
      getDiff: getDiffStub,
      getTaskTitle: getTaskTitleStub,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskTitle).toBe("Fix the bug");
      expect(result.value.diff.files).toHaveLength(1);
      expect(result.value.diff.stats.filesChanged).toBe(1);
      expect(result.value.session.orchestratorStatus).toBe("idle");
      expect(result.value.session.worktreeBranch).toBe("agent/fix-bug");
      expect(result.value.session.startedAt).toBe("2026-03-07T08:00:00Z");
    }
  });

  test("returns 409 for aborted session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "aborted",
        worktree_branch: "agent/fix-bug",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await getOrchestratorReview({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      resolveRepoRoot: resolveRepoRootStub(),
      getDiff: async () => ({ ok: true as const, value: { files: [], rawDiff: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } } }),
      getTaskTitle: async () => "Fix the bug",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("returns 404 for nonexistent session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: undefined,
    });

    const result = await getOrchestratorReview({
      surreal: surrealSpy.stub as any,
      sessionId: "nonexistent",
      resolveRepoRoot: resolveRepoRootStub(),
      getDiff: async () => ({ ok: true as const, value: { files: [], rawDiff: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } } }),
      getTaskTitle: async () => "N/A",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
    }
  });

  test("returns error when session is in active state (not reviewable)", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "active",
        worktree_branch: "agent/fix-bug",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await getOrchestratorReview({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      resolveRepoRoot: resolveRepoRootStub(),
      getDiff: async () => ({ ok: true as const, value: { files: [], rawDiff: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } } }),
      getTaskTitle: async () => "Fix the bug",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
    }
  });
});

// ---------------------------------------------------------------------------
// rejectOrchestratorSession
// ---------------------------------------------------------------------------

describe("rejectOrchestratorSession", () => {
  test("rejects with feedback, returns task to in_progress", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "idle",
        worktree_branch: "agent/fix-bug",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await rejectOrchestratorSession({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      feedback: "Please add unit tests",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rejected).toBe(true);
      expect(result.value.continuing).toBe(true);
    }

    // Verify task was returned to in_progress
    const taskUpdate = surrealSpy.updates.find(
      (u) => u.merge && typeof u.merge === "object" && "status" in (u.merge as object) && (u.merge as Record<string, unknown>).status === "in_progress",
    );
    expect(taskUpdate).toBeDefined();

    // Verify session status updated to active
    const sessionUpdate = surrealSpy.updates.find(
      (u) => u.merge && typeof u.merge === "object" && "orchestrator_status" in (u.merge as object) && (u.merge as Record<string, unknown>).orchestrator_status === "active",
    );
    expect(sessionUpdate).toBeDefined();
  });

  test("returns 409 when session is not in idle state", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: {
        id: new RecordId("agent_session", "sess-1"),
        orchestrator_status: "completed",
        worktree_branch: "agent/fix-bug",
        task_id: new RecordId("task", "task-abc"),
        workspace: new RecordId("workspace", "ws-1"),
      },
    });

    const result = await rejectOrchestratorSession({
      surreal: surrealSpy.stub as any,
      sessionId: "sess-1",
      feedback: "Please fix this",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("returns 404 for nonexistent session", async () => {
    const surrealSpy = createSurrealSpy({
      sessionSelect: undefined,
    });

    const result = await rejectOrchestratorSession({
      surreal: surrealSpy.stub as any,
      sessionId: "nonexistent",
      feedback: "Fix it",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------------------
// startEventIteration
// ---------------------------------------------------------------------------

describe("startEventIteration", () => {
  function createEventIterationDeps(overrides: Partial<EventIterationDeps> = {}): EventIterationDeps & {
    statusUpdates: Array<{ sessionId: string; status: string; error?: string }>;
  } {
    const statusUpdates: Array<{ sessionId: string; status: string; error?: string }> = [];
    return {
      emitEvent: () => {},
      updateSessionStatus: async (sessionId, status, error) => {
        statusUpdates.push({ sessionId, status, error });
      },
      updateLastEventAt: async () => {},
      getSessionStatus: async () => "spawning" as any,
      startStallDetector: () => ({
        recordActivity: () => {},
        incrementStepCount: () => {},
        stop: () => {},
      }),
      statusUpdates,
      ...overrides,
    };
  }

  test("transitions to error status when async iteration throws", async () => {
    const deps = createEventIterationDeps();

    const failingStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", content: [{ type: "text", text: "hello" }] };
        throw new Error("MCP server connection lost");
      },
    };

    await startEventIteration(deps, failingStream, "stream-1", "sess-err");

    const errorUpdate = deps.statusUpdates.find((u) => u.status === "error");
    expect(errorUpdate).toBeDefined();
    expect(errorUpdate!.error).toBe("MCP server connection lost");
    expect(errorUpdate!.sessionId).toBe("sess-err");
  });

  test("transitions to active on first message then processes stream", async () => {
    const deps = createEventIterationDeps();

    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", content: [{ type: "text", text: "working" }] };
      },
    };

    await startEventIteration(deps, stream, "stream-1", "sess-ok");

    const activeUpdate = deps.statusUpdates.find((u) => u.status === "active");
    expect(activeUpdate).toBeDefined();
    expect(activeUpdate!.sessionId).toBe("sess-ok");
  });
});
