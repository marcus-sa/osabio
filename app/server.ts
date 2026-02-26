/// <reference types="bun-types" />

import { randomUUID } from "node:crypto";
import { embed, generateObject, generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import appHtml from "./src/client/index.html";
import type {
  ChatMessageRequest,
  ChatMessageResponse,
  EntityKind,
  ExtractedEntity,
  ExtractedRelationship,
  SearchEntityResponse,
  StreamEvent,
} from "./src/shared/contracts";
import { RecordId, Surreal } from "surrealdb";
import { z } from "zod";

type OpenRouterReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

type OpenRouterReasoningOptions = {
  enabled?: boolean;
  exclude?: boolean;
  max_tokens?: number;
  effort?: OpenRouterReasoningEffort;
};

type GraphEntityRecord = RecordId<"task" | "decision" | "question", string>;

type ExtractionPromptEntity = {
  tempId: string;
  kind: EntityKind;
  text: string;
  confidence: number;
};

type ExtractionPromptRelationship = {
  kind: string;
  fromTempId: string;
  toTempId: string;
  confidence: number;
  fromText?: string;
  toText?: string;
};

type StreamState = {
  queue: StreamEvent[];
  controller?: ReadableStreamDefaultController<Uint8Array>;
  finished: boolean;
  keepAliveId?: ReturnType<typeof setInterval>;
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

type SearchEntityRow = {
  id: RecordId<"task" | "decision" | "question", string>;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessage: RecordId<"message", string>;
};

const extractionResultSchema = z.object({
  entities: z.array(
    z.object({
      tempId: z.string().min(1),
      kind: z.enum(["task", "decision", "question"]),
      text: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  relationships: z.array(
    z.object({
      kind: z.string().min(1),
      fromTempId: z.string().min(1),
      toTempId: z.string().min(1),
      confidence: z.number().min(0).max(1),
      fromText: z.string().min(1).optional(),
      toText: z.string().min(1).optional(),
    }),
  ),
});

const encoder = new TextEncoder();
const streams = new Map<string, StreamState>();

const openRouterApiKey = Bun.env.OPENROUTER_API_KEY;
if (!openRouterApiKey || openRouterApiKey.trim().length === 0) {
  throw new Error("OPENROUTER_API_KEY is required");
}

const extractionThresholdValue = Bun.env.EXTRACTION_CONFIDENCE_THRESHOLD ?? "0.75";
const extractionThreshold = Number(extractionThresholdValue);
if (!Number.isFinite(extractionThreshold) || extractionThreshold < 0 || extractionThreshold > 1) {
  throw new Error("EXTRACTION_CONFIDENCE_THRESHOLD must be a number between 0 and 1");
}

const assistantModelId = Bun.env.ASSISTANT_MODEL ?? "openai/gpt-4.1-mini";
const extractionModelId = Bun.env.EXTRACTION_MODEL ?? "openai/gpt-4.1-mini";
const embeddingModelId = Bun.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
const embeddingDimension = parsePositiveInteger(
  Bun.env.EMBEDDING_DIMENSION ?? "1536",
  "EMBEDDING_DIMENSION",
);
const openRouterReasoning = parseOpenRouterReasoning();

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

const openrouter = createOpenRouter({ apiKey: openRouterApiKey });
const assistantModel = openrouter(assistantModelId, {
  plugins: [{ id: "response-healing" }],
  ...(openRouterReasoning ? { extraBody: { reasoning: openRouterReasoning } } : {}),
});
const extractionModel = openrouter(extractionModelId, {
  plugins: [{ id: "response-healing" }],
  ...(openRouterReasoning ? { extraBody: { reasoning: openRouterReasoning } } : {}),
});
const embeddingModel = openrouter.textEmbeddingModel(embeddingModelId);

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

  const limit = Math.min(Math.floor(parsedLimit), 100);

  const [rows] = await surreal
    .query<[SearchEntityRow[]]>(
      "RETURN fn::entity_search($query, $limit);",
      {
        query,
        limit,
      },
    )
    .collect<[SearchEntityRow[]]>();

  const responseRows = rows
    .map((row) => ({
      id: row.id.id as string,
      kind: row.kind,
      text: row.text,
      confidence: row.confidence,
      sourceMessageId: row.sourceMessage.id as string,
    } satisfies SearchEntityResponse))
    .slice(0, limit);

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
      model: assistantModel,
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
      model: extractionModel,
      schema: extractionResultSchema,
      system: [
        "Extract structured business entities and relationships from the conversation.",
        "Return only high-confidence extractions with explicit entity references.",
        "Entity kinds: task, decision, question.",
        "Each entity must include a tempId.",
        "Each relationship must reference entities via fromTempId and toTempId.",
        "Relationship kind is free-form uppercase snake_case when possible (for example DEPENDS_ON, BLOCKS, RELATES_TO).",
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

    const dedupedEntitiesByTempId = new Map<string, ExtractionPromptEntity>();
    for (const entity of extractionOutput.object.entities as ExtractionPromptEntity[]) {
      const normalizedTempId = entity.tempId.trim();
      if (normalizedTempId.length === 0) {
        continue;
      }

      const existing = dedupedEntitiesByTempId.get(normalizedTempId);
      if (!existing || entity.confidence > existing.confidence) {
        dedupedEntitiesByTempId.set(normalizedTempId, {
          ...entity,
          tempId: normalizedTempId,
          text: entity.text.trim(),
        });
      }
    }

    const filteredEntities = [...dedupedEntitiesByTempId.values()]
      .filter((entity) => entity.confidence >= extractionThreshold)
      .filter((entity) => entity.text.length > 0);

    const filteredRelationships = (extractionOutput.object.relationships as ExtractionPromptRelationship[])
      .filter((relationship) => relationship.confidence >= extractionThreshold)
      .map((relationship) => ({
        ...relationship,
        kind: relationship.kind.trim(),
        fromTempId: relationship.fromTempId.trim(),
        toTempId: relationship.toTempId.trim(),
        fromText: relationship.fromText?.trim(),
        toText: relationship.toText?.trim(),
      }))
      .filter(
        (relationship) =>
          relationship.kind.length > 0 &&
          relationship.fromTempId.length > 0 &&
          relationship.toTempId.length > 0,
      );

    const now = new Date();
    const assistantMessageRecord = new RecordId("message", messageId);
    const conversationRecord = new RecordId("conversation", conversationId);
    const sourceMessageId = assistantMessageRecord.id as string;
    const persistedEntities: ExtractedEntity[] = [];
    const persistedRelationships: ExtractedRelationship[] = [];
    const entitiesByTempId = new Map<string, { record: GraphEntityRecord; text: string; id: string }>();

    const transaction = await surreal.beginTransaction();
    try {
      await transaction.create(assistantMessageRecord).content({
        conversation: conversationRecord,
        role: "assistant",
        text: assistantText,
        createdAt: now,
      });

      for (const entity of filteredEntities) {
        const entityRecord = createGraphEntityRecord(entity.kind, randomUUID());
        const entityId = entityRecord.id as string;

        await transaction.create(entityRecord).content(
          buildEntityRecordContent(entity.kind, entity.text, entity.confidence, assistantMessageRecord, now),
        );

        entitiesByTempId.set(entity.tempId, {
          record: entityRecord,
          text: entity.text,
          id: entityId,
        });

        persistedEntities.push({
          id: entityId,
          kind: entity.kind,
          text: entity.text,
          confidence: entity.confidence,
          sourceMessageId,
        });
      }

      for (const relationship of filteredRelationships) {
        const fromEntity = entitiesByTempId.get(relationship.fromTempId);
        const toEntity = entitiesByTempId.get(relationship.toTempId);

        if (!fromEntity || !toEntity) {
          console.warn(
            `Skipping extracted relationship (${relationship.kind}) because an endpoint tempId was not resolved`,
          );
          continue;
        }

        const relationshipRecord = new RecordId("extraction_relation", randomUUID());
        const fromText = relationship.fromText ?? fromEntity.text;
        const toText = relationship.toText ?? toEntity.text;

        await transaction.create(relationshipRecord).content({
          in: fromEntity.record,
          out: toEntity.record,
          kind: relationship.kind,
          confidence: relationship.confidence,
          source_message: assistantMessageRecord,
          extracted_at: now,
          created_at: now,
          from_text: fromText,
          to_text: toText,
        });

        persistedRelationships.push({
          id: relationshipRecord.id as string,
          kind: relationship.kind,
          fromId: fromEntity.id,
          toId: toEntity.id,
          confidence: relationship.confidence,
          sourceMessageId,
          fromText,
          toText,
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

    void persistEmbeddings(
      assistantMessageRecord,
      assistantText,
      [...entitiesByTempId.values()].map((entity) => ({
        record: entity.record,
        text: entity.text,
      })),
    ).catch((error: unknown) => {
      const errorText = error instanceof Error ? error.message : "embedding persistence failed";
      console.warn(`Embedding persistence failed: ${errorText}`);
    });

    emitEvent(messageId, {
      type: "extraction",
      messageId,
      entities: persistedEntities,
      relationships: persistedRelationships,
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

async function persistEmbeddings(
  assistantMessageRecord: RecordId<"message", string>,
  assistantText: string,
  entities: Array<{ record: GraphEntityRecord; text: string }>,
): Promise<void> {
  const messageEmbedding = await createEmbedding(assistantText);
  if (messageEmbedding) {
    await surreal.update(assistantMessageRecord).merge({ embedding: messageEmbedding });
  }

  for (const entity of entities) {
    const entityEmbedding = await createEmbedding(entity.text);
    if (!entityEmbedding) {
      continue;
    }

    await surreal.update(entity.record).merge({ embedding: entityEmbedding });
  }
}

async function createEmbedding(value: string): Promise<number[] | undefined> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  try {
    const result = await embed({
      model: embeddingModel,
      value: normalized,
    });

    if (result.embedding.length !== embeddingDimension) {
      console.warn(
        `Skipping embedding write because vector dimension ${result.embedding.length} does not match EMBEDDING_DIMENSION=${embeddingDimension}`,
      );
      return undefined;
    }

    return result.embedding;
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "embedding call failed";
    console.warn(`Embedding generation failed: ${errorText}`);
    return undefined;
  }
}

async function loadConversationContext(conversationId: string): Promise<MessageContextRow[]> {
  const conversationRecord = new RecordId("conversation", conversationId);
  const [rows] = await surreal
    .query<[MessageContextRow[]]>(
      "RETURN fn::conversation_recent($conversation, $limit);",
      {
        conversation: conversationRecord,
        limit: 8,
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

function createGraphEntityRecord(kind: EntityKind, id: string): GraphEntityRecord {
  return new RecordId(kind, id) as GraphEntityRecord;
}

function buildEntityRecordContent(
  kind: EntityKind,
  text: string,
  confidence: number,
  sourceMessage: RecordId<"message", string>,
  now: Date,
): Record<string, unknown> {
  if (kind === "task") {
    return {
      title: text,
      status: "open",
      source_message: sourceMessage,
      extraction_confidence: confidence,
      extracted_at: now,
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "decision") {
    return {
      summary: text,
      status: "extracted",
      source_message: sourceMessage,
      extraction_confidence: confidence,
      extracted_at: now,
      created_at: now,
      updated_at: now,
    };
  }

  return {
    text,
    status: "open",
    source_message: sourceMessage,
    extraction_confidence: confidence,
    extracted_at: now,
    created_at: now,
    updated_at: now,
  };
}

function parsePositiveInteger(value: string, envName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

function parseOpenRouterReasoning(): OpenRouterReasoningOptions | undefined {
  const effortValue = Bun.env.OPENROUTER_REASONING_EFFORT;
  const maxTokensValue = Bun.env.OPENROUTER_REASONING_MAX_TOKENS;

  if (!effortValue && !maxTokensValue) {
    return undefined;
  }

  const reasoning: OpenRouterReasoningOptions = {};

  if (effortValue) {
    const allowedEfforts: OpenRouterReasoningEffort[] = [
      "xhigh",
      "high",
      "medium",
      "low",
      "minimal",
      "none",
    ];

    if (!allowedEfforts.includes(effortValue as OpenRouterReasoningEffort)) {
      throw new Error(
        "OPENROUTER_REASONING_EFFORT must be one of xhigh, high, medium, low, minimal, none",
      );
    }
    reasoning.effort = effortValue as OpenRouterReasoningEffort;
  }

  if (maxTokensValue) {
    const parsed = Number(maxTokensValue);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error("OPENROUTER_REASONING_MAX_TOKENS must be a positive number");
    }
    reasoning.max_tokens = parsed;
  }

  return reasoning;
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
