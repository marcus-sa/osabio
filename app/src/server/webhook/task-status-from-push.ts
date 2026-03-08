/**
 * Pure function to determine which tasks need status updates based on push context.
 *
 * Step 03-01: Feature branch push -> set tasks to "done"
 * Step 03-02: Default branch push -> set tasks to "completed"
 */

export type TaskStatusContext = {
  taskId: string;
  currentStatus: string;
};

export type TaskStatusUpdate = {
  taskId: string;
  targetStatus: string;
};

/** Statuses that are at or beyond "done" -- no need to transition to done again */
const DONE_OR_BEYOND = new Set(["done", "completed"]);

export function determineTaskStatusUpdates(input: {
  tasks: TaskStatusContext[];
  isDefaultBranch: boolean;
}): TaskStatusUpdate[] {
  if (input.isDefaultBranch) {
    // Default branch (merge to main): set eligible tasks to completed
    return input.tasks
      .filter((task) => task.currentStatus !== "completed")
      .map((task) => ({ taskId: task.taskId, targetStatus: "completed" }));
  }

  // Feature branch: set eligible tasks to done
  return input.tasks
    .filter((task) => !DONE_OR_BEYOND.has(task.currentStatus))
    .map((task) => ({ taskId: task.taskId, targetStatus: "done" }));
}
