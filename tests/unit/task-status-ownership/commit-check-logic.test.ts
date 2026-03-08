import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  processCommitTaskRefs,
  type UpdateTaskPort,
  type TaskExistsPort,
} from "../../../app/src/server/mcp/commit-check";

/**
 * Unit tests for commit-check orchestration logic.
 *
 * Tests the pure pipeline: extract task IDs from commit message -> update each task to done.
 * Uses function stubs for ports (updateTask, taskExists).
 */

function createUpdateTaskSpy(): { port: UpdateTaskPort; calls: Array<{ taskId: string; status: string }> } {
  const calls: Array<{ taskId: string; status: string }> = [];
  const port: UpdateTaskPort = async (taskId, status) => {
    calls.push({ taskId, status });
    return { task_id: taskId, status, updated: true };
  };
  return { port, calls };
}

function createTaskExistsPort(existingIds: Set<string>): TaskExistsPort {
  return async (taskId) => existingIds.has(taskId);
}

describe("processCommitTaskRefs", () => {
  it("Given a commit message with task:abc123, When processed, Then task abc123 is set to done", async () => {
    const { port: updateTask, calls } = createUpdateTaskSpy();
    const taskExists = createTaskExistsPort(new Set(["abc-1234"]));

    const result = await processCommitTaskRefs({
      commitMessage: "Implement login flow\n\ntask:abc-1234",
      updateTask,
      taskExists,
    });

    expect(result.updatedTasks).toEqual([
      { task_id: "abc-1234", status: "done", updated: true },
    ]);
    expect(calls).toEqual([{ taskId: "abc-1234", status: "done" }]);
  });

  it("Given a commit with tasks: abc, def, When processed, Then both tasks are set to done", async () => {
    const { port: updateTask, calls } = createUpdateTaskSpy();
    const taskExists = createTaskExistsPort(new Set(["abc-1234", "def-5678"]));

    const result = await processCommitTaskRefs({
      commitMessage: "Batch update\n\ntasks: abc-1234, def-5678",
      updateTask,
      taskExists,
    });

    expect(result.updatedTasks).toHaveLength(2);
    expect(calls).toEqual([
      { taskId: "abc-1234", status: "done" },
      { taskId: "def-5678", status: "done" },
    ]);
  });

  it("Given a commit with no task refs, When processed, Then returns empty list", async () => {
    const { port: updateTask, calls } = createUpdateTaskSpy();
    const taskExists = createTaskExistsPort(new Set());

    const result = await processCommitTaskRefs({
      commitMessage: "Fix typo in README",
      updateTask,
      taskExists,
    });

    expect(result.updatedTasks).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("Given a task ref that does not exist in DB, When processed, Then it is skipped without error", async () => {
    const { port: updateTask, calls } = createUpdateTaskSpy();
    const taskExists = createTaskExistsPort(new Set()); // no tasks exist

    const result = await processCommitTaskRefs({
      commitMessage: "task:nonexistent-9999 some work",
      updateTask,
      taskExists,
    });

    expect(result.updatedTasks).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("Given mixed existing and non-existing task refs, When processed, Then only existing tasks are updated", async () => {
    const { port: updateTask, calls } = createUpdateTaskSpy();
    const taskExists = createTaskExistsPort(new Set(["real-task-1"]));

    const result = await processCommitTaskRefs({
      commitMessage: "task:real-task-1 task:fake-task-2",
      updateTask,
      taskExists,
    });

    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task_id).toBe("real-task-1");
    expect(calls).toEqual([{ taskId: "real-task-1", status: "done" }]);
  });

  it("Given an already-done task, When updateTask is called, Then it still appears in results (idempotent)", async () => {
    const updateTask: UpdateTaskPort = async (taskId, status) => {
      return { task_id: taskId, status, updated: false }; // already was done
    };
    const taskExists = createTaskExistsPort(new Set(["done-task-1"]));

    const result = await processCommitTaskRefs({
      commitMessage: "task:done-task-1 followup",
      updateTask,
      taskExists,
    });

    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task_id).toBe("done-task-1");
  });
});
