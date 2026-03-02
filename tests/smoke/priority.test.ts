import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
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

const getRuntime = setupSmokeSuite("priority");

describe("priority extraction smoke", () => {
  let workspace: { workspaceId: string; conversationId: string };

  it("extracts high or critical priority from urgent task message", async () => {
    const { baseUrl, surreal } = getRuntime();

    workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Priority Smoke ${Date.now()}`,
        ownerDisplayName: "Marcus",
      }),
    });

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "We urgently need to fix the login bug ASAP",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 15_000);
    const extractionEvent = events.find((event) => event.type === "extraction");
    expect(extractionEvent).toBeDefined();

    if (!extractionEvent || extractionEvent.type !== "extraction") {
      throw new Error("Expected extraction event in SSE stream");
    }

    const taskEntity = extractionEvent.entities.find((entity) => entity.kind === "task");
    expect(taskEntity).toBeDefined();

    const userMessageRecord = new RecordId("message", message.userMessageId);
    const [taskRows] = await surreal
      .query<[Array<{ id: RecordId<"task", string>; title: string; priority?: string }>]>(
        "SELECT id, title, priority FROM task WHERE source_message = $sourceMessage;",
        { sourceMessage: userMessageRecord },
      )
      .collect<[Array<{ id: RecordId<"task", string>; title: string; priority?: string }>]>();

    expect(taskRows.length).toBeGreaterThan(0);
    const task = taskRows[0];
    if (!task) {
      throw new Error("Task record was not persisted");
    }

    expect(task.priority).toBeDefined();
    expect(["high", "critical"]).toContain(task.priority);
  }, 30_000);

  it("defaults to medium priority when no urgency signal", async () => {
    const { baseUrl, surreal } = getRuntime();

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "We should implement dark mode for the settings page",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 15_000);
    const extractionEvent = events.find((event) => event.type === "extraction");
    expect(extractionEvent).toBeDefined();

    const userMessageRecord = new RecordId("message", message.userMessageId);
    const [taskRows] = await surreal
      .query<[Array<{ id: RecordId<"task", string>; title: string; priority?: string }>]>(
        "SELECT id, title, priority FROM task WHERE source_message = $sourceMessage;",
        { sourceMessage: userMessageRecord },
      )
      .collect<[Array<{ id: RecordId<"task", string>; title: string; priority?: string }>]>();

    expect(taskRows.length).toBeGreaterThan(0);
    const task = taskRows[0];
    if (!task) {
      throw new Error("Task record was not persisted");
    }

    expect(task.priority).toBe("medium");
  }, 30_000);

  it("extracts low priority from deferred language", async () => {
    const { baseUrl, surreal } = getRuntime();

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "Nice to have: eventually add CSV export for reports when we get around to it",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 15_000);
    const extractionEvent = events.find((event) => event.type === "extraction");
    expect(extractionEvent).toBeDefined();

    const userMessageRecord = new RecordId("message", message.userMessageId);
    const [entityRows] = await surreal
      .query<[Array<{ id: RecordId; title?: string; name?: string; priority?: string }>]>(
        [
          "SELECT id, title, priority FROM task WHERE source_message = $sourceMessage",
          "UNION",
          "SELECT id, name AS title, priority FROM feature WHERE source_message = $sourceMessage;",
        ].join(" "),
        { sourceMessage: userMessageRecord },
      )
      .collect<[Array<{ id: RecordId; title?: string; name?: string; priority?: string }>]>();

    expect(entityRows.length).toBeGreaterThan(0);
    const entity = entityRows[0];
    if (!entity) {
      throw new Error("Entity record was not persisted");
    }

    expect(entity.priority).toBe("low");
  }, 30_000);
});
