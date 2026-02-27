import { describe, expect, it } from "bun:test";
import {
  groupConversationsByProject,
  type ConversationGroupInput,
} from "../../app/src/server/workspace/conversation-sidebar";

describe("touched_by derivation logic", () => {
  const now = new Date().toISOString();

  it("entity_count represents unique entity IDs, not raw edge count", () => {
    // When two different conversations reference the same project with different entity counts,
    // the grouping should use the per-conversation entity_count (unique entities per project)
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Discussion",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 3 }, // 3 unique entities
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);
    expect(result.groups.get("proj-a")).toHaveLength(1);
  });

  it("handles a conversation touching the same project through different entity kinds", () => {
    // Even if entity_count comes from tasks, features, and decisions all pointing to same project,
    // it should still be counted as one project touch
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Mixed entities",
        updatedAt: now,
        touchedBy: [{ projectId: "proj-a", entityCount: 7 }],
      },
    ];

    const result = groupConversationsByProject(conversations);
    expect(result.groups.get("proj-a")).toHaveLength(1);
    expect(result.groups.get("proj-a")![0].title).toBe("Mixed entities");
  });

  it("correctly computes majority with asymmetric entity distribution", () => {
    // Project A has 5 entities, Project B has 4 entities
    // 5 > 9/2 = 4.5, so Project A has strict majority
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Slightly dominant",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 5 },
          { projectId: "proj-b", entityCount: 4 },
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);
    expect(result.groups.get("proj-a")).toHaveLength(1);
    expect(result.unlinked).toHaveLength(0);
  });

  it("one entity over half is enough for majority", () => {
    // 3 > 5/2 = 2.5, strict majority
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Slight edge",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 3 },
          { projectId: "proj-b", entityCount: 2 },
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);
    expect(result.groups.get("proj-a")).toHaveLength(1);
  });

  it("boundary: entity_count 2 vs 2 is not a majority", () => {
    // 2 > 4/2 = 2, not strictly greater
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Tied",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 2 },
          { projectId: "proj-b", entityCount: 2 },
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);
    expect(result.unlinked).toHaveLength(1);
  });

  it("single project with entity_count 1 has majority (1 > 1/2)", () => {
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "One entity",
        updatedAt: now,
        touchedBy: [{ projectId: "proj-a", entityCount: 1 }],
      },
    ];

    const result = groupConversationsByProject(conversations);
    expect(result.groups.get("proj-a")).toHaveLength(1);
  });
});
