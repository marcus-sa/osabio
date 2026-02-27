import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { collectSseEvents, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type SearchRow = {
  id: string;
  kind: string;
  text: string;
  confidence: number;
  sourceId: string;
};

type StreamEvent =
  | { type: "token"; messageId: string; token: string }
  | { type: "assistant_message"; messageId: string; text: string }
  | {
      type: "extraction";
      messageId: string;
      entities: Array<{
        id: string;
        kind: string;
        text: string;
        confidence: number;
        sourceKind: string;
        sourceId: string;
      }>;
      relationships: Array<{
        id: string;
        kind: string;
        fromId: string;
        toId: string;
        confidence: number;
        sourceMessageId: string;
      }>;
    }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const messageText =
  "Task: ship OAuth callback handler this week. Decision: use OpenRouter embeddings first. Question: do we keep a fallback provider? The OAuth task blocks API integration.";

const getRuntime = setupSmokeSuite("phase1");

describe("phase1 smoke", () => {
  it("streams extraction results and returns searchable entities", async () => {
    const { baseUrl } = getRuntime();

    const health = await fetchJson<{ status: string }>(`${baseUrl}/healthz`);
    expect(health.status).toBe("ok");

    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Phase1 Smoke ${Date.now()}`,
        ownerDisplayName: "Marcus",
      }),
    });

    const chatResponse = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: messageText,
      }),
    });

    expect(chatResponse.messageId.length).toBeGreaterThan(0);
    expect(chatResponse.userMessageId.length).toBeGreaterThan(0);
    expect(chatResponse.conversationId).toBe(workspace.conversationId);
    expect(chatResponse.workspaceId).toBe(workspace.workspaceId);
    expect(chatResponse.streamUrl.length).toBeGreaterThan(0);

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${chatResponse.streamUrl}`, 90_000);
    const eventTypes = events.map((event) => event.type);

    expect(eventTypes.includes("token")).toBe(true);
    expect(eventTypes.includes("extraction")).toBe(true);
    expect(eventTypes.includes("assistant_message")).toBe(true);
    expect(eventTypes[eventTypes.length - 1]).toBe("done");

    const extractionEvent = events.find((event) => event.type === "extraction");
    expect(extractionEvent).toBeDefined();

    if (!extractionEvent || extractionEvent.type !== "extraction") {
      throw new Error("Missing extraction event payload");
    }

    expect(extractionEvent.entities.length).toBeGreaterThan(0);

    const firstEntity = extractionEvent.entities[0];
    if (!firstEntity) {
      throw new Error("Extraction event did not include entities");
    }

    const searchTerm = firstEntity.text
      .split(/\s+/)
      .slice(0, 3)
      .join(" ")
      .trim();
    const query = searchTerm.length > 0 ? searchTerm : "task";

    const rows = await fetchJson<SearchRow[]>(
      `${baseUrl}/api/entities/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspace.workspaceId)}&limit=10`,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.id.length).toBeGreaterThan(0);
      expect(row.kind.length).toBeGreaterThan(0);
      expect(row.text.length).toBeGreaterThan(0);
      expect(typeof row.confidence).toBe("number");
      expect(row.sourceId.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
