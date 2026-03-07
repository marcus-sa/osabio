import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";

// --- Types for the query result ---

type AgentAttentionSessionRow = {
  id: RecordId<"agent_session", string>;
  orchestrator_status: "idle" | "error";
  task_id?: RecordId<"task", string>;
  task_title?: string;
  error_message?: string;
  started_at: string | Date;
};

// We import the mapping function (will fail until implemented)
import { mapAgentSessionToFeedItem } from "../../app/src/server/feed/feed-queries";

describe("agent session feed items", () => {
  // Acceptance: idle sessions produce review-tier items with Review + Abort
  it("maps idle agent session to review-tier feed item with Review and Abort actions", () => {
    const row: AgentAttentionSessionRow = {
      id: new RecordId("agent_session", "ses-1"),
      orchestrator_status: "idle",
      task_id: new RecordId("task", "t-1"),
      task_title: "Fix login bug",
      started_at: "2026-03-07T10:00:00.000Z",
    };

    const item = mapAgentSessionToFeedItem(row);

    expect(item.tier).toBe("review");
    expect(item.entityKind).toBe("agent_session");
    expect(item.entityName).toBe("Fix login bug");
    expect(item.actions.map((a) => a.action)).toEqual(["review", "abort"]);
    expect(item.actions.map((a) => a.label)).toEqual(["Review", "Abort"]);
    expect(item.status).toBe("idle");
    expect(item.entityId).toBe("agent_session:ses-1");
    expect(item.id).toContain("agent_session:ses-1");
  });

  // Acceptance: error sessions produce blocking-tier items with Discuss + Abort
  it("maps error agent session to blocking-tier feed item with Discuss and Abort actions", () => {
    const row: AgentAttentionSessionRow = {
      id: new RecordId("agent_session", "ses-2"),
      orchestrator_status: "error",
      task_id: new RecordId("task", "t-2"),
      task_title: "Migrate schema",
      error_message: "Permission denied: cannot write to protected branch",
      started_at: "2026-03-07T11:00:00.000Z",
    };

    const item = mapAgentSessionToFeedItem(row);

    expect(item.tier).toBe("blocking");
    expect(item.entityKind).toBe("agent_session");
    expect(item.entityName).toBe("Migrate schema");
    expect(item.actions.map((a) => a.action)).toEqual(["discuss", "abort"]);
    expect(item.actions.map((a) => a.label)).toEqual(["Discuss", "Abort"]);
    expect(item.status).toBe("error");
    expect(item.reason).toContain("Permission denied");
  });

  // Feed items include session id and task title even without task
  it("uses session id as entity name when no task is linked", () => {
    const row: AgentAttentionSessionRow = {
      id: new RecordId("agent_session", "ses-3"),
      orchestrator_status: "idle",
      started_at: "2026-03-07T12:00:00.000Z",
    };

    const item = mapAgentSessionToFeedItem(row);

    expect(item.entityName).toBe("Agent session ses-3");
    expect(item.tier).toBe("review");
  });

  it("includes error message in reason for error sessions", () => {
    const row: AgentAttentionSessionRow = {
      id: new RecordId("agent_session", "ses-4"),
      orchestrator_status: "error",
      task_id: new RecordId("task", "t-4"),
      task_title: "Build API",
      error_message: "Out of memory",
      started_at: "2026-03-07T13:00:00.000Z",
    };

    const item = mapAgentSessionToFeedItem(row);

    expect(item.reason).toContain("Out of memory");
    expect(item.tier).toBe("blocking");
  });
});
