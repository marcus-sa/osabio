import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import {
  ASSIGNABLE_TASK_STATUSES,
  ACTIVE_ORCHESTRATOR_STATUSES,
  TERMINAL_ORCHESTRATOR_STATUSES,
  type TaskRow,
  type ActiveSessionRow,
} from "../../../app/src/server/orchestrator/types";
import {
  validateAssignment,
  type AssignmentResult,
} from "../../../app/src/server/orchestrator/assignment-guard";

// ---------------------------------------------------------------------------
// Surreal stub factory — returns canned query results
// ---------------------------------------------------------------------------

type QueryResult = Array<Record<string, unknown>>;

function createSurrealStub(responses: {
  taskQuery?: QueryResult;
  sessionQuery?: QueryResult;
  workspaceQuery?: QueryResult;
}): unknown {
  return {
    query(sql: string, _bindings?: Record<string, unknown>) {
      // Task lookup query
      if (sql.includes("FROM $taskRecord")) {
        return Promise.resolve([responses.taskQuery ?? []]);
      }
      // Active session query
      if (sql.includes("orchestrator_status")) {
        return Promise.resolve([responses.sessionQuery ?? []]);
      }
      // Workspace repo_path query
      if (sql.includes("repo_path")) {
        return Promise.resolve([responses.workspaceQuery ?? []]);
      }
      return Promise.resolve([[]]);
    },
  };
}

function taskRow(overrides: {
  status: string;
  workspaceId?: string;
}): TaskRow[] {
  return [
    {
      id: new RecordId("task", "task-123"),
      title: "Test task",
      status: overrides.status,
      workspace: new RecordId("workspace", overrides.workspaceId ?? "ws-1"),
    },
  ];
}

function workspaceRow(overrides?: {
  workspaceId?: string;
  repoPath?: string;
}): Array<Record<string, unknown>> {
  return [
    {
      id: new RecordId("workspace", overrides?.workspaceId ?? "ws-1"),
      ...(overrides?.repoPath ? { repo_path: overrides.repoPath } : {}),
    },
  ];
}

function activeSession(): ActiveSessionRow[] {
  return [
    {
      id: new RecordId("agent_session", "sess-active"),
      orchestrator_status: "active",
    },
  ];
}

// ---------------------------------------------------------------------------
// Type-level: status classification constants are correct
// ---------------------------------------------------------------------------

describe("Assignment Guard: status classification", () => {
  test("assignable statuses include only ready and todo", () => {
    expect(ASSIGNABLE_TASK_STATUSES).toEqual(["ready", "todo"]);
  });

  test("active orchestrator statuses include spawning, active, idle", () => {
    expect(ACTIVE_ORCHESTRATOR_STATUSES).toEqual([
      "spawning",
      "active",
      "idle",
    ]);
  });

  test("terminal orchestrator statuses include completed, aborted, error", () => {
    expect(TERMINAL_ORCHESTRATOR_STATUSES).toEqual([
      "completed",
      "aborted",
      "error",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Task eligibility
// ---------------------------------------------------------------------------

describe("Assignment Guard: task eligibility", () => {
  test("accepts a task with status 'ready'", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "ready" }),
      sessionQuery: [],
      workspaceQuery: workspaceRow({ repoPath: "/some/repo" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validation.taskStatus).toBe("ready");
    }
  });

  test("accepts a task with status 'todo'", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "todo" }),
      sessionQuery: [],
      workspaceQuery: workspaceRow({ repoPath: "/some/repo" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validation.taskStatus).toBe("todo");
    }
  });

  test("rejects a task with status 'in_progress'", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "in_progress" }),
      workspaceQuery: workspaceRow({ repoPath: "/some/repo" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TASK_NOT_ASSIGNABLE");
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("rejects a task with status 'done'", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "done" }),
      workspaceQuery: workspaceRow({ repoPath: "/some/repo" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TASK_NOT_ASSIGNABLE");
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("rejects a task with status 'completed'", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "completed" }),
      workspaceQuery: workspaceRow({ repoPath: "/some/repo" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TASK_NOT_ASSIGNABLE");
    }
  });

  test("returns TASK_NOT_FOUND for nonexistent task", async () => {
    const surreal = createSurrealStub({
      taskQuery: [],
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "nonexistent",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TASK_NOT_FOUND");
      expect(result.error.httpStatus).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace membership
// ---------------------------------------------------------------------------

describe("Assignment Guard: workspace membership", () => {
  test("rejects task belonging to a different workspace", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "ready", workspaceId: "other-ws" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WORKSPACE_MISMATCH");
      expect(result.error.httpStatus).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// One-agent-per-task
// ---------------------------------------------------------------------------

describe("Assignment Guard: one agent per task", () => {
  test("rejects assignment when an active session exists for the task", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "ready" }),
      sessionQuery: activeSession(),
      workspaceQuery: workspaceRow({ repoPath: "/some/repo" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_ALREADY_ACTIVE");
      expect(result.error.httpStatus).toBe(409);
    }
  });

  test("allows assignment when all prior sessions are in terminal status", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "ready" }),
      sessionQuery: [], // no active sessions
      workspaceQuery: workspaceRow({ repoPath: "/some/repo" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("Assignment Guard: input validation", () => {
  test("rejects empty taskId", async () => {
    const surreal = createSurrealStub({});

    const result = await validateAssignment(surreal as any, "ws-1", "");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MISSING_TASK_ID");
      expect(result.error.httpStatus).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// Repo path required
// ---------------------------------------------------------------------------

describe("Assignment Guard: repo_path required", () => {
  test("rejects assignment when workspace has no repo_path", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "ready" }),
      sessionQuery: [],
      workspaceQuery: workspaceRow(), // no repoPath
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REPO_PATH_REQUIRED");
      expect(result.error.httpStatus).toBe(400);
      expect(result.error.message).toContain("repo_path");
    }
  });

  test("succeeds when workspace has repo_path set", async () => {
    const surreal = createSurrealStub({
      taskQuery: taskRow({ status: "ready" }),
      sessionQuery: [],
      workspaceQuery: workspaceRow({ repoPath: "/home/user/my-project" }),
    });

    const result = await validateAssignment(
      surreal as any,
      "ws-1",
      "task-123",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validation.repoPath).toBe("/home/user/my-project");
    }
  });
});
