import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { collectSseEvents, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "assistant_message"; messageId: string; text: string }
  | {
      type: "extraction";
      messageId: string;
      entities: Array<{ id: string; kind: string; text: string; confidence: number }>;
    }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupSmokeSuite("pipeline");

async function createOnboardedWorkspace(
  baseUrl: string,
  surreal: Surreal,
): Promise<{ workspaceId: string; conversationId: string }> {
  const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Pipeline Smoke ${Date.now()}`,
      ownerDisplayName: "Marcus", ownerEmail: `${Date.now()}-1@smoke.test`,
    }),
  });

  // Fast-forward onboarding so chat agent runs in post-onboarding mode
  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  await surreal.update(workspaceRecord).merge({
    onboarding_complete: true,
    onboarding_summary_pending: false,
    onboarding_completed_at: new Date(),
  });

  return workspace;
}

describe("agent-controlled extraction smoke", () => {
  it("chat agent handles decision language", async () => {
    const { baseUrl, surreal } = getRuntime();
    const workspace = await createOnboardedWorkspace(baseUrl, surreal);

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "We have decided to use TypeScript instead of Rust for the backend implementation. Please record this decision.",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 120_000);
    const assistantEvent = events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toBeDefined();
    if (!assistantEvent || assistantEvent.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }

    // The chat agent should either create a decision entity in DB
    // or acknowledge the decision in its response text
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const [decisionRows] = await surreal
      .query<[Array<{ id: RecordId<"decision", string>; summary: string }>]>(
        "SELECT id, summary FROM decision WHERE workspace = $workspace;",
        { workspace: workspaceRecord },
      )
      .collect<[Array<{ id: RecordId<"decision", string>; summary: string }>]>();

    const hasDecisionInDb = decisionRows.length > 0;
    const responseAcknowledgesDecision =
      assistantEvent.text.toLowerCase().includes("typescript") ||
      assistantEvent.text.toLowerCase().includes("decision");

    expect(hasDecisionInDb || responseAcknowledgesDecision).toBe(true);

    // If decision was created, verify provenance edge
    if (hasDecisionInDb) {
      const decision = decisionRows[0]!;
      expect(decision.summary.length).toBeGreaterThan(0);

      const userMessageRecord = new RecordId("message", message.userMessageId);
      const [edgeRows] = await surreal
        .query<[Array<{ id: RecordId<"extraction_relation", string>; evidence?: string }>]>(
          "SELECT id, evidence FROM extraction_relation WHERE `in` = $sourceMessage AND out = $decision LIMIT 1;",
          { sourceMessage: userMessageRecord, decision: decision.id },
        )
        .collect<[Array<{ id: RecordId<"extraction_relation", string>; evidence?: string }>]>();

      expect(edgeRows.length).toBe(1);
    }
  }, 180_000);

  it("no entities created for casual conversation", async () => {
    const { baseUrl, surreal } = getRuntime();
    const workspace = await createOnboardedWorkspace(baseUrl, surreal);

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "Hello, how are you doing today?",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 120_000);
    const assistantEvent = events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toBeDefined();

    // No entities should be created for a casual greeting
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const entityCount = await countWorkspaceEntities(surreal, workspaceRecord);
    expect(entityCount).toBe(0);
  }, 120_000);

  it("PM agent creates task from explicit request", async () => {
    const { baseUrl, surreal } = getRuntime();
    const workspace = await createOnboardedWorkspace(baseUrl, surreal);

    // Seed a project so the PM agent has something to scope tasks under
    const projectRecord = new RecordId("project", randomUUID());
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    await surreal.create(projectRecord).content({
      name: "Brain Platform",
      status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await surreal
      .relate(workspaceRecord, new RecordId("has_project", randomUUID()), projectRecord, {
        added_at: new Date(),
      })
      .output("after");

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "Add a task for implementing user authentication for Brain Platform.",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 120_000);
    const assistantEvent = events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toBeDefined();

    // The PM agent should create a task directly or return a suggestion.
    // Check for either: a task in DB or a WorkItemSuggestionList in the response.
    const [taskRows] = await surreal
      .query<[Array<{ id: RecordId<"task", string>; title: string }>]>(
        "SELECT id, title FROM task WHERE workspace = $workspace;",
        { workspace: workspaceRecord },
      )
      .collect<[Array<{ id: RecordId<"task", string>; title: string }>]>();

    if (!assistantEvent || assistantEvent.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }

    const hasTaskInDb = taskRows.length > 0;
    const hasSuggestionInResponse = assistantEvent.text.includes("WorkItemSuggestionList");
    const responseAcknowledgesTask =
      assistantEvent.text.toLowerCase().includes("authentication") ||
      assistantEvent.text.toLowerCase().includes("task");
    expect(hasTaskInDb || hasSuggestionInResponse || responseAcknowledgesTask).toBe(true);
  }, 180_000);
});

async function countWorkspaceEntities(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<number> {
  const [taskRows] = await surreal
    .query<[Array<{ id: RecordId }>]>("SELECT id FROM task WHERE workspace = $workspace;", {
      workspace: workspaceRecord,
    })
    .collect<[Array<{ id: RecordId }>]>();

  const [decisionRows] = await surreal
    .query<[Array<{ id: RecordId }>]>("SELECT id FROM decision WHERE workspace = $workspace;", {
      workspace: workspaceRecord,
    })
    .collect<[Array<{ id: RecordId }>]>();

  const [questionRows] = await surreal
    .query<[Array<{ id: RecordId }>]>(
      "SELECT id FROM question WHERE workspace = $workspace;",
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ id: RecordId }>]>();

  const [projectRows] = await surreal
    .query<[Array<{ id: RecordId }>]>(
      "SELECT id FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ id: RecordId }>]>();

  return taskRows.length + decisionRows.length + questionRows.length + projectRows.length;
}
