import { describe, expect, it } from "bun:test";
import {
  groupConversationsByProject,
  type ConversationGroupInput,
} from "../../app/src/server/workspace/conversation-sidebar";

describe("conversation sidebar grouping", () => {
  const now = new Date().toISOString();

  it("groups a single-project conversation under that project", () => {
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Planning session",
        updatedAt: now,
        touchedBy: [{ projectId: "proj-a", entityCount: 5 }],
      },
    ];

    const result = groupConversationsByProject(conversations);

    expect(result.groups.get("proj-a")).toHaveLength(1);
    expect(result.groups.get("proj-a")![0].id).toBe("conv-1");
    expect(result.unlinked).toHaveLength(0);
  });

  it("puts a conversation with no touched_by edges in unlinked", () => {
    const conversations: ConversationGroupInput[] = [
      { id: "conv-1", title: "Random chat", updatedAt: now, touchedBy: [] },
    ];

    const result = groupConversationsByProject(conversations);

    expect(result.groups.size).toBe(0);
    expect(result.unlinked).toHaveLength(1);
    expect(result.unlinked[0].id).toBe("conv-1");
  });

  it("uses strict majority: top must be > 50%", () => {
    // Exactly 50% is NOT a strict majority
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Split conversation",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 3 },
          { projectId: "proj-b", entityCount: 3 },
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);

    expect(result.groups.size).toBe(0);
    expect(result.unlinked).toHaveLength(1);
  });

  it("groups under dominant project when strict majority exists", () => {
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Mostly project A",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 4 },
          { projectId: "proj-b", entityCount: 3 },
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);

    expect(result.groups.get("proj-a")).toHaveLength(1);
    expect(result.unlinked).toHaveLength(0);
  });

  it("multi-project without majority goes to unlinked", () => {
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Three-way split",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 2 },
          { projectId: "proj-b", entityCount: 2 },
          { projectId: "proj-c", entityCount: 2 },
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);

    expect(result.groups.size).toBe(0);
    expect(result.unlinked).toHaveLength(1);
  });

  it("each conversation appears in exactly one location", () => {
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Grouped",
        updatedAt: now,
        touchedBy: [{ projectId: "proj-a", entityCount: 5 }],
      },
      {
        id: "conv-2",
        title: "Unlinked",
        updatedAt: now,
        touchedBy: [],
      },
      {
        id: "conv-3",
        title: "Also grouped",
        updatedAt: now,
        touchedBy: [
          { projectId: "proj-a", entityCount: 3 },
          { projectId: "proj-b", entityCount: 1 },
        ],
      },
    ];

    const result = groupConversationsByProject(conversations);

    const allIds = [
      ...(result.groups.get("proj-a") ?? []).map((c) => c.id),
      ...result.unlinked.map((c) => c.id),
    ];

    expect(allIds).toHaveLength(3);
    expect(new Set(allIds).size).toBe(3);
  });

  it("uses 'Untitled' fallback when title is missing", () => {
    const conversations: ConversationGroupInput[] = [
      { id: "conv-1", updatedAt: now, touchedBy: [] },
    ];

    const result = groupConversationsByProject(conversations);
    expect(result.unlinked[0].title).toBe("Untitled");
  });

  it("groups multiple conversations under different projects", () => {
    const conversations: ConversationGroupInput[] = [
      {
        id: "conv-1",
        title: "Project A chat",
        updatedAt: now,
        touchedBy: [{ projectId: "proj-a", entityCount: 5 }],
      },
      {
        id: "conv-2",
        title: "Project B chat",
        updatedAt: now,
        touchedBy: [{ projectId: "proj-b", entityCount: 8 }],
      },
    ];

    const result = groupConversationsByProject(conversations);

    expect(result.groups.get("proj-a")).toHaveLength(1);
    expect(result.groups.get("proj-b")).toHaveLength(1);
    expect(result.unlinked).toHaveLength(0);
  });
});
