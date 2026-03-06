import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import { collectSseEvents, createTestUser, fetchJson, setupSmokeSuite } from "./smoke-test-kit";

type AssistantMessageEvent = {
  type: "assistant_message";
  messageId: string;
  text: string;
};

type ExtractionEvent = {
  type: "extraction";
  messageId: string;
  entities: Array<{ kind: string; text: string }>;
  relationships: Array<{ kind: string }>;
};

type StreamEvent =
  | AssistantMessageEvent
  | ExtractionEvent
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupSmokeSuite("extraction_quality");

describe("extraction quality smoke", () => {
  it("filters placeholders and avoids unresolved person node creation", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "extraction");

    const create = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: `Extraction Quality Smoke ${Date.now()}`,
      }),
    });

    const workspaceRecord = new RecordId("workspace", create.workspaceId);

    const initialPeople = await loadWorkspacePeople(surreal, workspaceRecord);
    expect(initialPeople.length).toBe(1);

    const placeholderEvents = await sendChatAndCollectEvents(baseUrl, {
      workspaceId: create.workspaceId,
      conversationId: create.conversationId,
      text: "I'll describe my project",
      headers: user.headers,
    });

    const placeholderExtraction = placeholderEvents.find((event) => event.type === "extraction");
    expect(placeholderExtraction).toBeDefined();
    if (!placeholderExtraction || placeholderExtraction.type !== "extraction") {
      throw new Error("Placeholder turn missing extraction event");
    }

    const hasPlaceholderProject = placeholderExtraction.entities.some(
      (entity) => entity.kind === "project" && normalizeName(entity.text) === "my project",
    );
    expect(hasPlaceholderProject).toBe(false);

    const projects = await loadWorkspaceProjects(surreal, workspaceRecord);
    const persistedPlaceholderProject = projects.some((project) => normalizeName(project.name) === "my project");
    expect(persistedPlaceholderProject).toBe(false);

    const unknownPersonEvents = await sendChatAndCollectEvents(baseUrl, {
      workspaceId: create.workspaceId,
      conversationId: create.conversationId,
      text: "Person: Sarah. Decision: Use TypeScript for backend implementation.",
      headers: user.headers,
    });
    expect(unknownPersonEvents.some((event) => event.type === "assistant_message")).toBe(true);

    const peopleAfterUnknown = await loadWorkspacePeople(surreal, workspaceRecord);
    const hasSarahNode = peopleAfterUnknown.some((person) => normalizeName(person.name) === "sarah");
    expect(hasSarahNode).toBe(false);
    expect(peopleAfterUnknown.length).toBe(initialPeople.length);

    const knownPersonEvents = await sendChatAndCollectEvents(baseUrl, {
      workspaceId: create.workspaceId,
      conversationId: create.conversationId,
      text: "Marcus decided to use SurrealDB for graph persistence.",
      headers: user.headers,
    });

    const assistantEvent = knownPersonEvents.find((event) => event.type === "assistant_message");
    expect(assistantEvent).toBeDefined();
    if (!assistantEvent || assistantEvent.type !== "assistant_message") {
      throw new Error("Known-person turn missing assistant_message");
    }

    // Chat agent should respond meaningfully (not just silently)
    expect(assistantEvent.text.length).toBeGreaterThan(0);

    const peopleAfterKnown = await loadWorkspacePeople(surreal, workspaceRecord);
    expect(peopleAfterKnown.length).toBe(initialPeople.length);
  }, 180_000);
});

async function loadWorkspacePeople(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<Array<{ id: RecordId<"person", string>; name: string }>> {
  const [rows] = await surreal
    .query<[Array<{ id: RecordId<"person", string>; name: string }>]>(
      "SELECT id, name FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"person", string>; name: string }>]>();

  return rows;
}

async function loadWorkspaceProjects(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<Array<{ id: RecordId<"project", string>; name: string }>> {
  const [rows] = await surreal
    .query<[Array<{ id: RecordId<"project", string>; name: string }>]>(
      "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"project", string>; name: string }>]>();

  return rows;
}

async function sendChatAndCollectEvents(
  baseUrl: string,
  input: {
    workspaceId: string;
    conversationId: string;
    text: string;
    headers?: Record<string, string>;
  },
): Promise<StreamEvent[]> {
  const message = await fetchJson<{ streamUrl: string }>(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...input.headers },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      text: input.text,
    }),
  });

  return await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 120_000);
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
