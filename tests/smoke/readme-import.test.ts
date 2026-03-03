import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { collectSseEvents, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type StreamEvent =
  | { type: "assistant_message"; messageId: string; text: string }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupSmokeSuite("readme_import");

describe("README import smoke", () => {
  it("ingests README.md and persists document chunks", async () => {
    const { baseUrl, surreal } = getRuntime();

    const readmeText = await Bun.file(new URL("../../README.md", import.meta.url)).text();
    expect(readmeText.trim().length).toBeGreaterThan(0);

    const create = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `README Smoke ${Date.now()}`,
        ownerDisplayName: "README Smoke Owner",
      }),
    });

    const workspaceRecord = new RecordId("workspace", create.workspaceId);

    const uploadForm = new FormData();
    uploadForm.set("clientMessageId", randomUUID());
    uploadForm.set("workspaceId", create.workspaceId);
    uploadForm.set("conversationId", create.conversationId);
    uploadForm.set("text", "Importing README.md for smoke validation.");
    uploadForm.set("file", new File([readmeText], "README.md", { type: "text/markdown" }));

    const uploadResponse = await fetchJson<{ streamUrl: string }>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      body: uploadForm,
    });

    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${uploadResponse.streamUrl}`, 180_000);
    expect(events.some((event) => event.type === "assistant_message")).toBe(true);
    expect(events.some((event) => event.type === "done")).toBe(true);

    const [documentRows] = await surreal
      .query<[Array<{ id: RecordId<"document", string> }>]>(
        "SELECT id FROM document WHERE workspace = $workspace AND name = $name ORDER BY uploaded_at DESC LIMIT 1;",
        {
          workspace: workspaceRecord,
          name: "README.md",
        },
      )
      .collect<[Array<{ id: RecordId<"document", string> }>]>();

    expect(documentRows.length).toBeGreaterThan(0);
    const documentRecord = documentRows[0];
    if (!documentRecord) {
      throw new Error("README.md document record was not created");
    }

    const [chunkRows] = await surreal
      .query<[Array<{ id: RecordId<"document_chunk", string> }>]>(
        "SELECT id FROM document_chunk WHERE document = $document LIMIT 1;",
        {
          document: documentRecord.id,
        },
      )
      .collect<[Array<{ id: RecordId<"document_chunk", string> }>]>();

    expect(chunkRows.length).toBeGreaterThan(0);
  }, 300_000);
});
