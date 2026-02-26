/// <reference types="bun-types" />

import { randomUUID } from "node:crypto";
import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import appHtml from "./src/client/index.html";
import { RecordId, Surreal } from "surrealdb";
import { z } from "zod";

type EntityKind = "task" | "decision" | "question";
type RelationshipKind = "BELONGS_TO" | "DEPENDS_ON";

type ExtractedEntity = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};

type ExtractedRelationship = {
  id: string;
  type: RelationshipKind;
  fromText: string;
  toText: string;
  confidence: number;
  sourceMessageId: string;
};

type ChatMessageRequest = {
  clientMessageId: string;
  conversationId?: string;
  text: string;
};

type ChatMessageResponse = {
  messageId: string;
  conversationId: string;
  streamUrl: string;
};

type TokenEvent = {
  type: "token";
  messageId: string;
  token: string;
};

type AssistantMessageEvent = {
  type: "assistant_message";
  messageId: string;
  text: string;
};

type ExtractionEvent = {
  type: "extraction";
  messageId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
};

type DoneEvent = {
  type: "done";
  messageId: string;
};

type ErrorEvent = {
  type: "error";
  messageId: string;
  error: string;
};

type StreamEvent = TokenEvent | AssistantMessageEvent | ExtractionEvent | DoneEvent | ErrorEvent;

type StreamState = {
  queue: StreamEvent[];
  controller?: ReadableStreamDefaultController<Uint8Array>;
  finished: boolean;
  keepAliveId?: ReturnType<typeof setInterval>;
};

type SearchEntityResponse = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};

type ConversationRow = {
  id: RecordId<"conversation", string>;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MessageContextRow = {
  id: RecordId<"message", string>;
  role: "user" | "assistant";
  text: string;
  createdAt: Date | string;
};

type EntityRow = {
  id: RecordId<"entity", string>;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessage: RecordId<"message", string>;
  createdAt: Date | string;
};

const extractionResultSchema = z.object({
  entities: z.array(
    z.object({
      kind: z.enum(["task", "decision", "question"]),
      text: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  relationships: z.array(
    z.object({
      type: z.enum(["BELONGS_TO", "DEPENDS_ON"]),
      fromText: z.string().min(1),
      toText: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const encoder = new TextEncoder();
const streams = new Map<string, StreamState>();

const openAiApiKey = Bun.env.OPENAI_API_KEY;
if (!openAiApiKey || openAiApiKey.trim().length === 0) {
  throw new Error("OPENAI_API_KEY is required");
}

const extractionThresholdValue = Bun.env.EXTRACTION_CONFIDENCE_THRESHOLD ?? "0.75";
const extractionThreshold = Number(extractionThresholdValue);
if (!Number.isFinite(extractionThreshold) || extractionThreshold < 0 || extractionThreshold > 1) {
  throw new Error("EXTRACTION_CONFIDENCE_THRESHOLD must be a number between 0 and 1");
}

const assistantModelId = Bun.env.ASSISTANT_MODEL ?? "gpt-4.1-mini";
const extractionModelId = Bun.env.EXTRACTION_MODEL ?? "gpt-4.1-mini";

const surrealUrl = Bun.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = Bun.env.SURREAL_USERNAME ?? "root";
const surrealPassword = Bun.env.SURREAL_PASSWORD ?? "root";
const surrealNamespace = Bun.env.SURREAL_NAMESPACE ?? "brain";
const surrealDatabase = Bun.env.SURREAL_DATABASE ?? "app";

const surreal = new Surreal();
await surreal.connect(surrealUrl);
await surreal.signin({ username: surrealUsername, password: surrealPassword });
await surreal.use({ namespace: surrealNamespace, database: surrealDatabase });

const schemaSql = await Bun.file(new URL("../schema/surreal-schema.surql", import.meta.url)).text();
if (schemaSql.trim().length === 0) {
  throw new Error("schema/surreal-schema.surql is empty");
}
await surreal.query(schemaSql).collect();

const openai = createOpenAI({ apiKey: openAiApiKey });

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? "3000"),
  routes: {
    "/healthz": {
      GET: () => jsonResponse({ status: "ok" }, 200),
    },
    "/api/chat/messages": {
      POST: (request) => handlePostChatMessage(request),
    },
    "/api/chat/stream/:messageId": {
      GET: (request) => handleChatStream(request.params.messageId),
    },
    "/api/entities/search": {
      GET: (request) => handleEntitySearch(new URL(request.url)),
    },
    "/": appHtml,
    "/*": appHtml,
  },
});

console.log(`Brain app running at http://127.0.0.1:${server.port}`);

async function handlePostChatMessage(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const parsed = parseChatMessageRequest(body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const conversationId = parsed.data.conversationId ?? randomUUID();
  const messageId = randomUUID();

  try {
    const now = new Date();
    const conversationRecord = new RecordId("conversation", conversationId);
    const existingConversation = await surreal.select<ConversationRow>(conversationRecord);

    if (existingConversation) {
      await surreal.update(conversationRecord).merge({
        updatedAt: now,
      });
    } else {
      await surreal.create(conversationRecord).content({
        createdAt: now,
        updatedAt: now,
      });
    }

    const userMessageRecord = new RecordId("message", randomUUID());
    await surreal.create(userMessageRecord).content({
      conversation: conversationRecord,
      role: "user",
      text: parsed.data.text,
      createdAt: now,
      clientMessageId: parsed.data.clientMessageId,
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "failed to persist user message";
    return jsonError(errorText, 500);
  }

  streams.set(messageId, {
    queue: [],
    finished: false,
  });

  void processChatMessage(conversationId, messageId, parsed.data.text);

  const response: ChatMessageResponse = {
    messageId,
    conversationId,
    streamUrl: `/api/chat/stream/${messageId}`,
  };

  return jsonResponse(response, 200);
}

function handleChatStream(messageId: string): Response {
  const state = streams.get(messageId);
  if (!state) {
    return jsonError("stream not found", 404);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      state.controller = controller;

      for (const event of state.queue) {
        controller.enqueue(encodeSse(event));
      }
      state.queue = [];

      if (state.finished) {
        controller.close();
        cleanupStream(messageId);
        return;
      }

      state.keepAliveId = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
    },
    cancel() {
      cleanupStream(messageId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleEntitySearch(url: URL): Promise<Response> {
  const query = url.searchParams.get("q")?.trim().toLowerCase();
  if (!query) {
    return jsonError("q is required", 400);
  }

  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = Number(rawLimit ?? "10");
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return jsonError("limit must be a positive number", 400);
  }

  const limit = Math.min(parsedLimit, 100);

  const [rows] = await surreal
    .query<[EntityRow[]]>(
      "SELECT id, kind, text, confidence, sourceMessage, createdAt FROM entity ORDER BY createdAt DESC LIMIT 300;",
    )
    .collect<[EntityRow[]]>();

  const responseRows = rows
    .filter((row) => row.text.toLowerCase().includes(query))
    .slice(0, limit)
    .map((row) => ({
      id: row.id.id as string,
      kind: row.kind,
      text: row.text,
      confidence: row.confidence,
      sourceMessageId: row.sourceMessage.id as string,
    } satisfies SearchEntityResponse));

  return jsonResponse(responseRows, 200);
}

async function processChatMessage(
  conversationId: string,
  messageId: string,
  promptText: string,
): Promise<void> {
  try {
    const contextRows = await loadConversationContext(conversationId);

    const assistantResponse = await generateText({
      model: openai(assistantModelId),
      system:
        "You are helping a product team capture actionable project state. Respond concisely with clear next actions.",
      prompt: [
        "Conversation context:",
        formatContextRows(contextRows),
        "",
        "Latest user message:",
        promptText,
      ].join("\n"),
    });

    const assistantText = assistantResponse.text.trim();
    if (assistantText.length === 0) {
      throw new Error("assistant response was empty");
    }

    for (const token of assistantText.split(" ")) {
      emitEvent(messageId, {
        type: "token",
        messageId,
        token: `${token} `,
      });
      await Bun.sleep(25);
    }

    const extractionOutput = await generateObject({
      model: openai(extractionModelId),
      schema: extractionResultSchema,
      system: [
        "Extract structured business entities and relationships from the conversation.",
        "Return only high-confidence extractions.",
        "Entity kinds: task, decision, question.",
        "Relationship types: BELONGS_TO, DEPENDS_ON.",
        "Confidence values must be between 0 and 1.",
      ].join(" "),
      prompt: [
        "Conversation context:",
        formatContextRows(contextRows),
        "",
        "Latest user message:",
        promptText,
        "",
        "Assistant response:",
        assistantText,
      ].join("\n"),
    });

    const filteredEntities = extractionOutput.object.entities
      .filter((entity) => entity.confidence >= extractionThreshold)
      .map((entity) => ({
        id: randomUUID(),
        kind: entity.kind,
        text: entity.text,
        confidence: entity.confidence,
        sourceMessageId: messageId,
      } satisfies ExtractedEntity));

    const filteredRelationships = extractionOutput.object.relationships
      .filter((relationship) => relationship.confidence >= extractionThreshold)
      .map((relationship) => ({
        id: randomUUID(),
        type: relationship.type,
        fromText: relationship.fromText,
        toText: relationship.toText,
        confidence: relationship.confidence,
        sourceMessageId: messageId,
      } satisfies ExtractedRelationship));

    const now = new Date();
    const assistantMessageRecord = new RecordId("message", messageId);
    const conversationRecord = new RecordId("conversation", conversationId);

    const transaction = await surreal.beginTransaction();
    try {
      await transaction.create(assistantMessageRecord).content({
        conversation: conversationRecord,
        role: "assistant",
        text: assistantText,
        createdAt: now,
      });

      for (const entity of filteredEntities) {
        await transaction.create(new RecordId("entity", entity.id)).content({
          kind: entity.kind,
          text: entity.text,
          confidence: entity.confidence,
          sourceMessage: assistantMessageRecord,
          createdAt: now,
        });
      }

      for (const relationship of filteredRelationships) {
        await transaction.create(new RecordId("relationship", relationship.id)).content({
          type: relationship.type,
          fromText: relationship.fromText,
          toText: relationship.toText,
          confidence: relationship.confidence,
          sourceMessage: assistantMessageRecord,
          createdAt: now,
        });
      }

      await transaction.update(conversationRecord).merge({
        updatedAt: now,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.cancel();
      throw error;
    }

    emitEvent(messageId, {
      type: "extraction",
      messageId,
      entities: filteredEntities,
      relationships: filteredRelationships,
    });

    emitEvent(messageId, {
      type: "assistant_message",
      messageId,
      text: assistantText,
    });

    emitEvent(messageId, {
      type: "done",
      messageId,
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "chat processing failed";
    emitEvent(messageId, {
      type: "error",
      messageId,
      error: errorText,
    });
  }
}

async function loadConversationContext(conversationId: string): Promise<MessageContextRow[]> {
  const conversationRecord = new RecordId("conversation", conversationId);
  const [rows] = await surreal
    .query<[MessageContextRow[]]>(
      "SELECT id, role, text, createdAt FROM message WHERE conversation = $conversation ORDER BY createdAt DESC LIMIT 8;",
      {
        conversation: conversationRecord,
      },
    )
    .collect<[MessageContextRow[]]>();

  return [...rows].reverse();
}

function formatContextRows(rows: MessageContextRow[]): string {
  if (rows.length === 0) {
    return "(no prior messages)";
  }

  return rows
    .map((row) => `${row.role.toUpperCase()}: ${row.text}`)
    .join("\n");
}

function emitEvent(messageId: string, event: StreamEvent) {
  const state = streams.get(messageId);
  if (!state) {
    throw new Error("stream missing in state");
  }

  if (state.controller) {
    state.controller.enqueue(encodeSse(event));
  } else {
    state.queue.push(event);
  }

  if (event.type === "done" || event.type === "error") {
    state.finished = true;
    if (state.controller) {
      state.controller.close();
      cleanupStream(messageId);
    }
  }
}

function cleanupStream(messageId: string) {
  const state = streams.get(messageId);
  if (!state) {
    return;
  }

  if (state.keepAliveId) {
    clearInterval(state.keepAliveId);
  }

  streams.delete(messageId);
}

function encodeSse(event: StreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function parseChatMessageRequest(body: unknown):
  | { ok: true; data: ChatMessageRequest }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object" };
  }

  const payload = body as Partial<ChatMessageRequest>;

  if (!payload.clientMessageId || payload.clientMessageId.trim().length === 0) {
    return { ok: false, error: "clientMessageId is required" };
  }

  if (!payload.text || payload.text.trim().length === 0) {
    return { ok: false, error: "text is required" };
  }

  if (payload.conversationId && payload.conversationId.trim().length === 0) {
    return { ok: false, error: "conversationId must not be empty when provided" };
  }

  return {
    ok: true,
    data: {
      clientMessageId: payload.clientMessageId,
      conversationId: payload.conversationId,
      text: payload.text.trim(),
    },
  };
}

function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function jsonResponse(payload: object, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
