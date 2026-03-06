import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { collectSseEvents, createTestUser, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "token"; messageId: string; token: string }
  | { type: "assistant_message"; messageId: string; text: string }
  | {
      type: "extraction";
      messageId: string;
      entities: Array<{ id: string; kind: string; text: string }>;
      relationships: Array<{ id: string; kind: string }>;
    }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupSmokeSuite("phase1");

describe("phase1 smoke", () => {
  it("chat pipeline streams tokens, extraction, and assistant message", async () => {
    const { baseUrl } = getRuntime();

    const health = await fetchJson<{ status: string }>(`${baseUrl}/healthz`);
    expect(health.status).toBe("ok");

    const user = await createTestUser(baseUrl, "phase1");

    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: `Phase1 Smoke ${Date.now()}`,
      }),
    });

    const chatResponse = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "We need to ship an OAuth callback handler this week and decide on OpenRouter embeddings vs a fallback provider.",
      }),
    });

    expect(chatResponse.messageId.length).toBeGreaterThan(0);
    expect(chatResponse.userMessageId.length).toBeGreaterThan(0);
    expect(chatResponse.conversationId).toBe(workspace.conversationId);
    expect(chatResponse.workspaceId).toBe(workspace.workspaceId);
    expect(chatResponse.streamUrl.length).toBeGreaterThan(0);

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${chatResponse.streamUrl}`, 120_000);
    const eventTypes = events.map((event) => event.type);

    // Core SSE pipeline: tokens stream, extraction event fires, assistant responds, done signals completion
    expect(eventTypes.includes("token")).toBe(true);
    expect(eventTypes.includes("extraction")).toBe(true);
    expect(eventTypes.includes("assistant_message")).toBe(true);
    expect(eventTypes[eventTypes.length - 1]).toBe("done");

    // Assistant should provide a meaningful response
    const assistantEvent = events.find((event) => event.type === "assistant_message");
    if (!assistantEvent || assistantEvent.type !== "assistant_message") {
      throw new Error("Missing assistant_message event");
    }
    expect(assistantEvent.text.length).toBeGreaterThan(0);
  }, 180_000);
});
