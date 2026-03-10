import { describe, expect, test } from "bun:test";
import { deriveRequestedAction } from "../../../app/src/server/oauth/route-action-map";

describe("deriveRequestedAction", () => {
  // -- Read operations --

  test("maps POST /api/mcp/:ws/workspace-context to read workspace", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/my-ws/workspace-context");
    expect(result).toEqual({ type: "brain_action", action: "read", resource: "workspace" });
  });

  test("maps POST /api/mcp/:ws/project-context to read project", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/proj-1/project-context");
    expect(result).toEqual({ type: "brain_action", action: "read", resource: "project" });
  });

  test("maps POST /api/mcp/:ws/task-context to read task", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/task-context");
    expect(result).toEqual({ type: "brain_action", action: "read", resource: "task" });
  });

  test("maps POST /api/mcp/:ws/decisions to read decision", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/decisions");
    expect(result).toEqual({ type: "brain_action", action: "read", resource: "decision" });
  });

  test("maps POST /api/mcp/:ws/constraints to read constraint", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/constraints");
    expect(result).toEqual({ type: "brain_action", action: "read", resource: "constraint" });
  });

  test("maps POST /api/mcp/:ws/changes to read change_log", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/changes");
    expect(result).toEqual({ type: "brain_action", action: "read", resource: "change_log" });
  });

  test("maps GET /api/mcp/:ws/entities/:id to read entity", () => {
    const result = deriveRequestedAction("GET", "/api/mcp/ws/entities/abc-123");
    expect(result).toEqual({ type: "brain_action", action: "read", resource: "entity" });
  });

  // -- Reason operations --

  test("maps POST /api/mcp/:ws/decisions/resolve to reason decision", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/decisions/resolve");
    expect(result).toEqual({ type: "brain_action", action: "reason", resource: "decision" });
  });

  test("maps POST /api/mcp/:ws/constraints/check to reason constraint", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/constraints/check");
    expect(result).toEqual({ type: "brain_action", action: "reason", resource: "constraint" });
  });

  // -- Create operations --

  test("maps POST /api/mcp/:ws/decisions/provisional to create decision", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/decisions/provisional");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "decision" });
  });

  test("maps POST /api/mcp/:ws/questions to create question", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/questions");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "question" });
  });

  test("maps POST /api/mcp/:ws/tasks/subtask to create task", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/tasks/subtask");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "task" });
  });

  test("maps POST /api/mcp/:ws/notes to create note", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/notes");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "note" });
  });

  test("maps POST /api/mcp/:ws/observations to create observation", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/observations");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "observation" });
  });

  test("maps POST /api/mcp/:ws/suggestions/create to create suggestion", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/suggestions/create");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "suggestion" });
  });

  test("maps POST /api/mcp/:ws/sessions/start to create session", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/sessions/start");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "session" });
  });

  test("maps POST /api/mcp/:ws/commits to create commit", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/commits");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "commit" });
  });

  test("maps POST /api/mcp/:ws/intents/create to create intent", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/intents/create");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "intent" });
  });

  // -- Update operations --

  test("maps POST /api/mcp/:ws/tasks/status to update task", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/tasks/status");
    expect(result).toEqual({ type: "brain_action", action: "update", resource: "task" });
  });

  test("maps POST /api/mcp/:ws/sessions/end to update session", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/sessions/end");
    expect(result).toEqual({ type: "brain_action", action: "update", resource: "session" });
  });

  // -- Submit operations --

  test("maps POST /api/mcp/:ws/intents/submit to submit intent", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/ws/intents/submit");
    expect(result).toEqual({ type: "brain_action", action: "submit", resource: "intent" });
  });

  // -- Unknown routes --

  test("returns undefined for unknown route", () => {
    const result = deriveRequestedAction("POST", "/api/unknown/path");
    expect(result).toBeUndefined();
  });

  test("returns undefined for wrong HTTP method on known path", () => {
    const result = deriveRequestedAction("GET", "/api/mcp/ws/workspace-context");
    expect(result).toBeUndefined();
  });

  // -- Workspace parameter extraction --

  test("matches routes with various workspace slugs", () => {
    const result = deriveRequestedAction("POST", "/api/mcp/my-complex-workspace-123/notes");
    expect(result).toEqual({ type: "brain_action", action: "create", resource: "note" });
  });
});
