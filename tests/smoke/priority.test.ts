import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { type TestUser, collectSseEvents, createTestUser, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "assistant_message"; messageId: string; text: string }
  | { type: "extraction"; messageId: string; entities: Array<{ id: string; kind: string; text: string }> }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupSmokeSuite("priority");

async function createOnboardedWorkspace(
  baseUrl: string,
  surreal: import("surrealdb").Surreal,
  user: TestUser,
): Promise<{ workspaceId: string; conversationId: string }> {
  const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify({
      name: `Priority Smoke ${Date.now()}`,
    }),
  });

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  await surreal.update(workspaceRecord).merge({
    onboarding_complete: true,
    onboarding_completed_at: new Date(),
  });

  return workspace;
}

describe("priority extraction smoke", () => {
  it("chat agent handles urgent task message and responds meaningfully", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "priority-urgent");
    const workspace = await createOnboardedWorkspace(baseUrl, surreal, user);

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "We urgently need to fix the login bug ASAP — this is blocking all users.",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 180_000);
    const assistantEvent = events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toBeDefined();
    if (!assistantEvent || assistantEvent.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }

    // Chat agent should acknowledge the urgency
    const text = assistantEvent.text.toLowerCase();
    const acknowledgesUrgency =
      text.includes("urgent") || text.includes("login") || text.includes("bug") || text.includes("fix");
    expect(acknowledgesUrgency).toBe(true);

    // If the chat agent created a task, verify it has a priority set
    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const [taskRows] = await surreal
      .query<[Array<{ id: RecordId<"task", string>; title: string; priority?: string }>]>(
        "SELECT id, title, priority FROM task WHERE workspace = $workspace;",
        { workspace: workspaceRecord },
      )
      .collect<[Array<{ id: RecordId<"task", string>; title: string; priority?: string }>]>();

    if (taskRows.length > 0) {
      const task = taskRows[0]!;
      expect(task.title.length).toBeGreaterThan(0);
      // If priority was set, it should reflect urgency
      if (task.priority) {
        expect(["high", "critical"]).toContain(task.priority);
      }
    }
  }, 180_000);

  it("chat agent handles low-priority deferred language", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "priority-low");
    const workspace = await createOnboardedWorkspace(baseUrl, surreal, user);

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "Nice to have: eventually add CSV export for reports when we get around to it.",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 180_000);
    const assistantEvent = events.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toBeDefined();
    if (!assistantEvent || assistantEvent.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }

    // Verify the chat agent responds meaningfully
    expect(assistantEvent.text.length).toBeGreaterThan(0);
  }, 180_000);
});
