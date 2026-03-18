/**
 * Live Select Manager: Unit Tests
 *
 * Step: 01-03 (graph-reactive-coordination)
 *
 * Tests pure functions:
 * - Governance table list (no high-volume tables)
 * - Workspace filtering logic (application-side)
 * - Event routing to per-workspace consumers
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  GOVERNANCE_TABLES,
  matchesWorkspace,
  createEventRouter,
  type LiveSelectEvent,
} from "../../app/src/server/reactive/live-select-manager";

// ---------------------------------------------------------------------------
// Governance Table List
// ---------------------------------------------------------------------------
describe("GOVERNANCE_TABLES", () => {
  it("includes all expected governance tables", () => {
    const expected = [
      "decision",
      "task",
      "observation",
      "question",
      "suggestion",
      "learning",
      "agent_session",
    ];
    for (const table of expected) {
      expect(GOVERNANCE_TABLES).toContain(table);
    }
  });

  it("excludes high-volume tables", () => {
    const excluded = ["trace", "message", "extracted_from"];
    for (const table of excluded) {
      expect(GOVERNANCE_TABLES).not.toContain(table);
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace Filtering (Pure Function)
// ---------------------------------------------------------------------------
describe("matchesWorkspace", () => {
  it("returns true when value has matching workspace RecordId", () => {
    const value = {
      workspace: new RecordId("workspace", "ws-123"),
      title: "Some task",
    };
    expect(matchesWorkspace(value, "ws-123")).toBe(true);
  });

  it("returns false when value has different workspace", () => {
    const value = {
      workspace: new RecordId("workspace", "ws-other"),
      title: "Some task",
    };
    expect(matchesWorkspace(value, "ws-123")).toBe(false);
  });

  it("returns false when value has no workspace field", () => {
    const value = { title: "No workspace" };
    expect(matchesWorkspace(value, "ws-123")).toBe(false);
  });

  it("handles workspace as string (surreal SDK may serialize differently)", () => {
    const value = {
      workspace: "workspace:ws-123",
      title: "String workspace",
    };
    expect(matchesWorkspace(value, "ws-123")).toBe(true);
  });

  it("returns false for null/undefined value", () => {
    expect(matchesWorkspace(undefined, "ws-123")).toBe(false);
    expect(matchesWorkspace(null, "ws-123")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event Router (Routes events to per-workspace consumers)
// ---------------------------------------------------------------------------
describe("createEventRouter", () => {
  const makeEvent = (table: string, workspaceId: string): LiveSelectEvent => ({
    table,
    action: "CREATE",
    recordId: `${table}:rec-1`,
    value: { workspace: new RecordId("workspace", workspaceId) },
  });

  it("routes events to registered workspace consumers", () => {
    const router = createEventRouter();
    const received: LiveSelectEvent[] = [];

    router.addConsumer("ws-1", (event) => received.push(event));
    router.route(makeEvent("decision", "ws-1"));

    expect(received.length).toBe(1);
    expect(received[0].table).toBe("decision");
  });

  it("does not route events to consumers of other workspaces", () => {
    const router = createEventRouter();
    const received: LiveSelectEvent[] = [];

    router.addConsumer("ws-1", (event) => received.push(event));
    router.route(makeEvent("decision", "ws-2"));

    expect(received.length).toBe(0);
  });

  it("supports multiple consumers for the same workspace", () => {
    const router = createEventRouter();
    const received1: LiveSelectEvent[] = [];
    const received2: LiveSelectEvent[] = [];

    router.addConsumer("ws-1", (event) => received1.push(event));
    router.addConsumer("ws-1", (event) => received2.push(event));
    router.route(makeEvent("task", "ws-1"));

    expect(received1.length).toBe(1);
    expect(received2.length).toBe(1);
  });

  it("supports removing consumers", () => {
    const router = createEventRouter();
    const received: LiveSelectEvent[] = [];

    const unsubscribe = router.addConsumer("ws-1", (event) => received.push(event));
    router.route(makeEvent("decision", "ws-1"));
    expect(received.length).toBe(1);

    unsubscribe();
    router.route(makeEvent("task", "ws-1"));
    expect(received.length).toBe(1); // no new event
  });

  it("routes to global consumers regardless of workspace", () => {
    const router = createEventRouter();
    const received: LiveSelectEvent[] = [];

    router.addGlobalConsumer((event) => received.push(event));
    router.route(makeEvent("observation", "ws-1"));
    router.route(makeEvent("observation", "ws-2"));

    expect(received.length).toBe(2);
  });
});
