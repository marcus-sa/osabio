import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { buildChatContext, buildSystemPrompt } from "../../app/src/server/chat/context";

describe("chat context", () => {
  it("returns an empty-safe context shape", async () => {
    const context = await buildChatContext({
      surreal: {} as any,
      conversationRecord: new RecordId("conversation", "c-empty"),
      workspaceRecord: new RecordId("workspace", "w-empty"),
      loaders: {
        listConversationEntities: async () => [],
        listWorkspaceProjectSummaries: async () => [],
        listWorkspaceRecentDecisions: async () => [],
        listWorkspaceOpenQuestions: async () => [],
        listWorkspaceOpenObservations: async () => [],
        listWorkspacePendingSuggestions: async () => [],
        loadOnboardingSummary: async () => "Projects: none\nPeople: none\nDecisions: none\nOpen questions: none",
        loadActiveLearnings: async () => ({ learnings: [], constraintBudgetExceeded: false }),
      },
    });

    expect(context).toEqual({
      conversationEntities: [],
      workspaceSummary: {
        projects: [],
        recentDecisions: [],
        openQuestions: [],
        openObservations: [],
        pendingSuggestions: [],
      },
      onboardingSummary: "Projects: none\nPeople: none\nDecisions: none\nOpen questions: none",
    });

    const systemPrompt = buildSystemPrompt(context);
    expect(systemPrompt.includes("- none")).toBe(true);
    expect(systemPrompt.includes("## Response Format")).toBe(true);
  });

  it("returns populated conversation entities and workspace summaries", async () => {
    const context = await buildChatContext({
      surreal: {} as any,
      conversationRecord: new RecordId("conversation", "c-populated"),
      workspaceRecord: new RecordId("workspace", "w-populated"),
      loaders: {
        listConversationEntities: async () => [
          {
            id: "d-1",
            kind: "decision",
            name: "Use token bucket for rate limiting",
            confidence: 0.94,
            sourceMessageId: "m-1",
          },
        ],
        listWorkspaceProjectSummaries: async () => [
          {
            id: "p-1",
            name: "Brain",
            activeTaskCount: 7,
          },
        ],
        listWorkspaceRecentDecisions: async () => [
          {
            id: "d-1",
            name: "Use token bucket for rate limiting",
            status: "provisional",
            project: "Brain",
          },
        ],
        listWorkspaceOpenQuestions: async () => [
          {
            id: "q-1",
            name: "How should retries be tuned?",
            project: "Brain",
          },
        ],
        listWorkspaceOpenObservations: async () => [
          {
            id: "o-1",
            text: "Auth implementation may delay launch by two weeks",
            severity: "warning",
            status: "open",
            category: "engineering",
            sourceAgent: "engineering_agent",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        listWorkspacePendingSuggestions: async () => [],
        loadOnboardingSummary: async () => "Projects: Brain\nPeople: none\nDecisions: none\nOpen questions: none",
        loadActiveLearnings: async () => ({ learnings: [], constraintBudgetExceeded: false }),
      },
    });

    expect(context.conversationEntities).toHaveLength(1);
    expect(context.workspaceSummary.projects[0]?.activeTaskCount).toBe(7);
    expect(context.workspaceSummary.recentDecisions[0]?.status).toBe("provisional");
    expect(context.workspaceSummary.openQuestions[0]?.name).toContain("retries");
    expect(context.workspaceSummary.openObservations[0]?.severity).toBe("warning");

    const systemPrompt = buildSystemPrompt(context);
    expect(systemPrompt.includes("Projects:")).toBe(true);
    expect(systemPrompt.includes("Decisions:")).toBe(true);
    expect(systemPrompt.includes("## Domain Separation")).toBe(true);
  });
});
