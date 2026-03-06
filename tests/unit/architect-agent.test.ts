import { describe, expect, it } from "bun:test";
import { createArchitectTools } from "../../app/src/server/agents/architect/tools";
import { buildArchitectSystemPrompt } from "../../app/src/server/agents/architect/prompt";
import { buildSystemPrompt, buildChatContext } from "../../app/src/server/chat/context";
import { RecordId } from "surrealdb";

describe("architect agent tools", () => {
  const mockDeps = {
    surreal: {} as any,
    embeddingModel: {} as any,
    embeddingDimension: 1536,
    extractionModelId: "test-model",
    extractionModel: {} as any,
    extractionStoreThreshold: 0.7,
  };

  it("includes the expected tool subset", () => {
    const tools = createArchitectTools(mockDeps);
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("search_entities");
    expect(toolNames).toContain("get_entity_detail");
    expect(toolNames).toContain("get_project_status");
    expect(toolNames).toContain("check_constraints");
    expect(toolNames).toContain("create_provisional_decision");
    expect(toolNames).toContain("create_question");
    expect(toolNames).toContain("create_observation");
    expect(toolNames).toContain("suggest_work_items");
    expect(toolNames).toContain("create_work_item");
    expect(toolNames).toContain("create_suggestion");
    expect(toolNames).toContain("update_question");
  });

  it("excludes subagent dispatch and lifecycle tools", () => {
    const tools = createArchitectTools(mockDeps);
    const toolNames = Object.keys(tools);

    expect(toolNames).not.toContain("invoke_pm_agent");
    expect(toolNames).not.toContain("invoke_analytics_agent");
    expect(toolNames).not.toContain("invoke_architect_agent");
    expect(toolNames).not.toContain("list_workspace_entities");
    expect(toolNames).not.toContain("get_conversation_history");
    expect(toolNames).not.toContain("acknowledge_observation");
    expect(toolNames).not.toContain("resolve_observation");
    expect(toolNames).not.toContain("resolve_decision");
    expect(toolNames).not.toContain("confirm_decision");
    expect(toolNames).not.toContain("show_relationship_graph");
  });

  it("has exactly 11 tools", () => {
    const tools = createArchitectTools(mockDeps);
    expect(Object.keys(tools)).toHaveLength(11);
  });
});

describe("architect system prompt", () => {
  it("builds a non-empty prompt with key behavioral keywords", async () => {
    const collectableQuery = async () => {
      const result = [[]];
      (result as any).collect = async () => [[]];
      return result;
    };
    const mockSurreal = {
      query: (..._args: any[]) => {
        const promise = collectableQuery();
        (promise as any).collect = async () => [[]];
        return promise;
      },
    } as any;

    const prompt = await buildArchitectSystemPrompt({
      surreal: mockSurreal,
      workspaceRecord: new RecordId("workspace", "w-test"),
    });

    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("Architect");
    expect(prompt).toContain("PROBING");
    expect(prompt).toContain("CHALLENGE");
    expect(prompt).toContain("decision");
    expect(prompt).toContain("create_question");
    expect(prompt).toContain("update_question");
    expect(prompt).toContain("suggest_work_items");
    expect(prompt).toContain("Domain Separation");
    expect(prompt).toContain("Graph Awareness");
  });

  it("includes workspace context sections", async () => {
    const collectableQuery = async () => {
      const result = [[]];
      (result as any).collect = async () => [[]];
      return result;
    };
    const mockSurreal = {
      query: (..._args: any[]) => {
        const promise = collectableQuery();
        (promise as any).collect = async () => [[]];
        return promise;
      },
    } as any;

    const prompt = await buildArchitectSystemPrompt({
      surreal: mockSurreal,
      workspaceRecord: new RecordId("workspace", "w-test"),
    });

    expect(prompt).toContain("## Workspace Projects");
    expect(prompt).toContain("## Open Questions");
    expect(prompt).toContain("## Recent Decisions");
    expect(prompt).toContain("## Active Observations");
  });
});

describe("chat agent prompt includes architect dispatch", () => {
  it("includes architect subagent dispatch instructions", async () => {
    const context = await buildChatContext({
      surreal: {} as any,
      conversationRecord: new RecordId("conversation", "c-test"),
      workspaceRecord: new RecordId("workspace", "w-test"),
      loaders: {
        listConversationEntities: async () => [],
        listWorkspaceProjectSummaries: async () => [],
        listWorkspaceRecentDecisions: async () => [],
        listWorkspaceOpenQuestions: async () => [],
        listWorkspaceOpenObservations: async () => [],
        listWorkspacePendingSuggestions: async () => [],
        loadOnboardingSummary: async () => undefined,
      },
    });

    const prompt = buildSystemPrompt(context);

    expect(prompt).toContain("## Subagent: Architect");
    expect(prompt).toContain("invoke_architect_agent");
    expect(prompt).toContain("design:");
    expect(prompt).toContain("brainstorm:");
    expect(prompt).toContain("challenge:");
    expect(prompt).toContain("synthesize:");
  });
});
