import { describe, expect, it } from "bun:test";
import {
  determineTaskStatusUpdates,
  type TaskStatusContext,
} from "../../../app/src/server/webhook/task-status-from-push";

/**
 * US-5: GitHub commit processor sets task status to done on push to non-main branch.
 *
 * Pure function tests for determining which tasks need status updates
 * based on branch context and current task status.
 */
describe("determineTaskStatusUpdates", () => {
  // --- Feature branch (non-default) -> done ---

  it("Given a push to a feature branch with in_progress tasks, When determining updates, Then tasks are set to done", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-001", currentStatus: "in_progress" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: false,
    });

    expect(updates).toEqual([
      { taskId: "task-001", targetStatus: "done" },
    ]);
  });

  it("Given a push to a feature branch with open tasks, When determining updates, Then tasks are set to done", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-002", currentStatus: "open" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: false,
    });

    expect(updates).toEqual([
      { taskId: "task-002", targetStatus: "done" },
    ]);
  });

  it("Given a push to a feature branch with multiple tasks, When determining updates, Then all eligible tasks are set to done", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-010", currentStatus: "in_progress" },
      { taskId: "task-011", currentStatus: "open" },
      { taskId: "task-012", currentStatus: "ready" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: false,
    });

    expect(updates).toEqual([
      { taskId: "task-010", targetStatus: "done" },
      { taskId: "task-011", targetStatus: "done" },
      { taskId: "task-012", targetStatus: "done" },
    ]);
  });

  // --- Idempotent: already done/completed tasks stay unchanged ---

  it("Given a push to a feature branch with an already-done task, When determining updates, Then the task is skipped", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-003", currentStatus: "done" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: false,
    });

    expect(updates).toEqual([]);
  });

  it("Given a push to a feature branch with an already-completed task, When determining updates, Then the task is skipped", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-004", currentStatus: "completed" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: false,
    });

    expect(updates).toEqual([]);
  });

  // --- Default branch -> completed ---

  it("Given a push to the default branch with in_progress tasks, When determining updates, Then tasks are set to completed", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-005", currentStatus: "in_progress" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: true,
    });

    expect(updates).toEqual([
      { taskId: "task-005", targetStatus: "completed" },
    ]);
  });

  it("Given a push to the default branch with done tasks, When determining updates, Then tasks are set to completed", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-030", currentStatus: "done" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: true,
    });

    expect(updates).toEqual([
      { taskId: "task-030", targetStatus: "completed" },
    ]);
  });

  it("Given a push to the default branch with already-completed tasks, When determining updates, Then completed tasks are skipped", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-031", currentStatus: "completed" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: true,
    });

    expect(updates).toEqual([]);
  });

  it("Given a push to the default branch with mixed statuses, When determining updates, Then only non-completed tasks are set to completed", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-040", currentStatus: "in_progress" },
      { taskId: "task-041", currentStatus: "done" },
      { taskId: "task-042", currentStatus: "completed" },
      { taskId: "task-043", currentStatus: "open" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: true,
    });

    expect(updates).toEqual([
      { taskId: "task-040", targetStatus: "completed" },
      { taskId: "task-041", targetStatus: "completed" },
      { taskId: "task-043", targetStatus: "completed" },
    ]);
  });

  // --- Empty tasks ---

  it("Given no linked tasks, When determining updates, Then an empty list is returned", () => {
    const updates = determineTaskStatusUpdates({
      tasks: [],
      isDefaultBranch: false,
    });

    expect(updates).toEqual([]);
  });

  // --- Mixed statuses ---

  it("Given a mix of done and in_progress tasks on feature branch, When determining updates, Then only non-done tasks are updated", () => {
    const tasks: TaskStatusContext[] = [
      { taskId: "task-020", currentStatus: "in_progress" },
      { taskId: "task-021", currentStatus: "done" },
      { taskId: "task-022", currentStatus: "completed" },
      { taskId: "task-023", currentStatus: "open" },
    ];

    const updates = determineTaskStatusUpdates({
      tasks,
      isDefaultBranch: false,
    });

    expect(updates).toEqual([
      { taskId: "task-020", targetStatus: "done" },
      { taskId: "task-023", targetStatus: "done" },
    ]);
  });
});
