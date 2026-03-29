import { describe, expect, it } from "bun:test";
import { extractReferencedTaskIds } from "../../../app/src/server/webhook/commit-task-refs";

/**
 * US-3: osabio commit-check parses task refs from commit messages.
 *
 * These tests validate the pure function that extracts task references
 * from commit messages. This is the "fast path" regex parser used by
 * both the CLI commit-check and the GitHub webhook processor.
 */
describe("task reference extraction from commit messages", () => {
  // --- Happy path: single task ref ---

  it("Given a commit message with a single task:id, When parsed, Then the task id is extracted", () => {
    const ids = extractReferencedTaskIds(
      "Implement login flow\n\ntask:abc-1234",
    );
    expect(ids).toEqual(["abc-1234"]);
  });

  it("Given a task ref at the start of the message, When parsed, Then the task id is extracted", () => {
    const ids = extractReferencedTaskIds(
      "task:feat-0042 finalize oauth callback",
    );
    expect(ids).toEqual(["feat-0042"]);
  });

  it("Given a task ref embedded mid-sentence, When parsed, Then the task id is extracted", () => {
    const ids = extractReferencedTaskIds(
      "finalize task:login-7890 oauth callback",
    );
    expect(ids).toEqual(["login-7890"]);
  });

  // --- Happy path: multiple task refs ---

  it("Given a commit with tasks: list, When parsed, Then all task ids are extracted", () => {
    const ids = extractReferencedTaskIds(
      "Batch update\n\ntasks: abc-1234, def-5678",
    );
    expect(ids).toEqual(["abc-1234", "def-5678"]);
  });

  it("Given a commit with both task: and tasks: formats, When parsed, Then all unique ids are extracted", () => {
    const ids = extractReferencedTaskIds(
      "task:abc-1234 cleanup\n\ntasks: abc-1234, ghi-9012",
    );
    expect(ids).toEqual(["abc-1234", "ghi-9012"]);
  });

  it("Given multiple task: tokens in one message, When parsed, Then all are extracted", () => {
    const ids = extractReferencedTaskIds(
      "task:item-001 and also task:item-002 resolved",
    );
    expect(ids).toEqual(["item-001", "item-002"]);
  });

  // --- No refs / edge cases ---

  it("Given a commit message with no task refs, When parsed, Then an empty list is returned", () => {
    const ids = extractReferencedTaskIds("Fix typo in README");
    expect(ids).toEqual([]);
  });

  it("Given a tasks: prefix followed by non-id words, When parsed, Then no ids are extracted", () => {
    const ids = extractReferencedTaskIds("tasks: cleanup docs followups");
    expect(ids).toEqual([]);
  });

  it("Given a commit with only very short tokens after task:, When parsed, Then they are rejected as non-ids", () => {
    const ids = extractReferencedTaskIds("task:abc fix");
    expect(ids).toEqual([]);
  });

  // --- Deduplication ---

  it("Given duplicate task refs in a commit, When parsed, Then each id appears exactly once", () => {
    const ids = extractReferencedTaskIds(
      "task:dup-1111 first mention\ntask:dup-1111 second mention",
    );
    expect(ids).toEqual(["dup-1111"]);
  });

  // --- Boundary: id format validation ---

  it("Given a task ref without digits, When parsed, Then it is rejected", () => {
    const ids = extractReferencedTaskIds("task:refactor");
    expect(ids).toEqual([]);
  });

  it("Given a task ref with hyphens and digits, When parsed, Then it is accepted", () => {
    const ids = extractReferencedTaskIds("task:my-feature-2026");
    expect(ids).toEqual(["my-feature-2026"]);
  });

  it("Given a task ref with underscores, When parsed, Then it is accepted", () => {
    const ids = extractReferencedTaskIds("task:task_20260304_123");
    expect(ids).toEqual(["task_20260304_123"]);
  });
});
