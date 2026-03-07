import { describe, expect, it } from "bun:test";
import {
  extractSessionIdFromEntityId,
  classifyFeedAction,
} from "../../app/src/client/components/feed/feed-action-routing";
import type { GovernanceFeedAction, GovernanceFeedItem } from "../../app/src/shared/contracts";

function makeAgentSessionItem(overrides: Partial<GovernanceFeedItem> = {}): GovernanceFeedItem {
  return {
    id: "agent_session:ses-abc:idle",
    tier: "review",
    entityId: "agent_session:ses-abc",
    entityKind: "agent_session",
    entityName: "Fix login bug",
    reason: "Agent completed work -- review ready",
    status: "idle",
    createdAt: "2026-03-07T10:00:00.000Z",
    actions: [
      { action: "review", label: "Review" },
      { action: "abort", label: "Abort" },
    ],
    ...overrides,
  };
}

function makeDecisionItem(overrides: Partial<GovernanceFeedItem> = {}): GovernanceFeedItem {
  return {
    id: "decision:dec-1:provisional",
    tier: "blocking",
    entityId: "decision:dec-1",
    entityKind: "decision",
    entityName: "Use PostgreSQL",
    reason: "Provisional decision awaiting confirmation",
    status: "provisional",
    createdAt: "2026-03-07T10:00:00.000Z",
    actions: [
      { action: "confirm", label: "Confirm" },
      { action: "discuss", label: "Discuss" },
    ],
    ...overrides,
  };
}

describe("extractSessionIdFromEntityId", () => {
  it("extracts session id from agent_session entity id", () => {
    expect(extractSessionIdFromEntityId("agent_session:ses-abc")).toBe("ses-abc");
  });

  it("extracts session id with uuid format", () => {
    expect(extractSessionIdFromEntityId("agent_session:550e8400-e29b-41d4-a716-446655440000"))
      .toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns undefined for non-agent_session entity ids", () => {
    expect(extractSessionIdFromEntityId("decision:dec-1")).toBeUndefined();
    expect(extractSessionIdFromEntityId("task:t-1")).toBeUndefined();
  });
});

describe("classifyFeedAction", () => {
  it("classifies review action on agent session as navigate_review", () => {
    const item = makeAgentSessionItem();
    const action: GovernanceFeedAction = { action: "review", label: "Review" };

    const result = classifyFeedAction(item, action);

    expect(result.type).toBe("navigate_review");
    if (result.type === "navigate_review") {
      expect(result.sessionId).toBe("ses-abc");
    }
  });

  it("classifies abort action on agent session as abort_session", () => {
    const item = makeAgentSessionItem();
    const action: GovernanceFeedAction = { action: "abort", label: "Abort" };

    const result = classifyFeedAction(item, action);

    expect(result.type).toBe("abort_session");
    if (result.type === "abort_session") {
      expect(result.sessionId).toBe("ses-abc");
    }
  });

  it("classifies discuss action as navigate_discuss regardless of entity kind", () => {
    const agentItem = makeAgentSessionItem({
      actions: [{ action: "discuss", label: "Discuss" }],
    });
    const action: GovernanceFeedAction = { action: "discuss", label: "Discuss" };

    const result = classifyFeedAction(agentItem, action);

    expect(result.type).toBe("navigate_discuss");
  });

  it("classifies discuss on decision item as navigate_discuss", () => {
    const item = makeDecisionItem();
    const action: GovernanceFeedAction = { action: "discuss", label: "Discuss" };

    const result = classifyFeedAction(item, action);

    expect(result.type).toBe("navigate_discuss");
  });

  it("classifies non-agent, non-discuss action as entity_action", () => {
    const item = makeDecisionItem();
    const action: GovernanceFeedAction = { action: "confirm", label: "Confirm" };

    const result = classifyFeedAction(item, action);

    expect(result.type).toBe("entity_action");
  });
});
