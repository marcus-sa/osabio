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

const getRuntime = setupSmokeSuite("pipeline");

describe("extraction pipeline smoke", () => {
  it("persists extraction artifacts for a user decision message", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Pipeline Smoke ${Date.now()}`,
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
        text: "I decided to use TypeScript over Rust for backend implementation.",
      }),
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 5_000);
    const extractionEvent = events.find((event) => event.type === "extraction");
    const assistantEvent = events.find((event) => event.type === "assistant_message");

    expect(extractionEvent).toBeDefined();
    expect(assistantEvent).toBeDefined();

    if (!extractionEvent || extractionEvent.type !== "extraction") {
      throw new Error("Expected extraction event in SSE stream");
    }
    expect(extractionEvent.entities.some((entity) => entity.kind === "decision")).toBe(true);

    const userMessageRecord = new RecordId("message", message.userMessageId);
    const [decisionRows] = await surreal
      .query<[Array<{ id: RecordId<"decision", string>; summary: string; embedding?: number[] }>]>(
        "SELECT id, summary, embedding FROM decision WHERE source_message = $sourceMessage;",
        { sourceMessage: userMessageRecord },
      )
      .collect<[Array<{ id: RecordId<"decision", string>; summary: string; embedding?: number[] }>]>();

    expect(decisionRows.length).toBeGreaterThan(0);
    const decision = decisionRows[0];
    if (!decision) {
      throw new Error("Decision record was not persisted");
    }

    expect(decision.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(decision.embedding)).toBe(true);
    expect((decision.embedding ?? []).length).toBeGreaterThan(0);

    const [edgeRows] = await surreal
      .query<[
        Array<{
          id: RecordId<"extraction_relation", string>;
          evidence?: string;
          evidence_source?: RecordId<"message", string>;
          resolved_from?: RecordId<"message", string>;
        }>,
      ]>(
        "SELECT id, evidence, evidence_source, resolved_from FROM extraction_relation WHERE `in` = $sourceMessage AND out = $decision LIMIT 1;",
        { sourceMessage: userMessageRecord, decision: decision.id },
      )
      .collect<[
        Array<{
          id: RecordId<"extraction_relation", string>;
          evidence?: string;
          evidence_source?: RecordId<"message", string>;
          resolved_from?: RecordId<"message", string>;
        }>,
      ]>();

    expect(edgeRows.length).toBe(1);
    const edge = edgeRows[0];
    if (!edge) {
      throw new Error("Expected extraction_relation edge");
    }
    expect(typeof edge.evidence).toBe("string");

    if (!edge.evidence) {
      throw new Error("Expected evidence text on extraction_relation edge");
    }

    const normalizedInput = normalizeText("I decided to use TypeScript over Rust for backend implementation.");
    const normalizedEvidence = normalizeText(edge.evidence);
    expect(normalizedInput.includes(normalizedEvidence)).toBe(true);
    expect(edge.evidence_source?.id as string | undefined).toBe(message.userMessageId);
    expect(edge.resolved_from).toBeUndefined();

    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const [personRows] = await surreal
      .query<[Array<{ id: RecordId<"person", string> }>]>(
        "SELECT id FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
        { workspace: workspaceRecord },
      )
      .collect<[Array<{ id: RecordId<"person", string> }>]>();

    expect(personRows.length).toBe(1);

    if (!assistantEvent || assistantEvent.type !== "assistant_message") {
      throw new Error("Expected assistant_message event in SSE stream");
    }
    expect(assistantEvent.text.includes("```component")).toBe(true);
  }, 30_000);
});

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
