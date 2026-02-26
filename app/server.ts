/// <reference types="bun-types" />

import { randomUUID } from "node:crypto";
import appHtml from "./src/client/index.html";

type EntityKind = "task" | "decision" | "question";

type ExtractedEntity = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};

type MessageRecord = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  entities: ExtractedEntity[];
};

type Conversation = {
  id: string;
  messages: MessageRecord[];
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

const encoder = new TextEncoder();

const conversations = new Map<string, Conversation>();
const streams = new Map<string, StreamState>();

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

  const conversation: Conversation = conversations.get(conversationId) ?? {
    id: conversationId,
    messages: [],
  };

  conversation.messages.push({
    id: parsed.data.clientMessageId,
    role: "user",
    text: parsed.data.text,
    createdAt: new Date().toISOString(),
    entities: [],
  });

  conversations.set(conversationId, conversation);
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

function handleEntitySearch(url: URL): Response {
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
  const rows: SearchEntityResponse[] = [];

  for (const conversation of conversations.values()) {
    for (const message of conversation.messages) {
      for (const entity of message.entities) {
        if (entity.text.toLowerCase().includes(query)) {
          rows.push({
            id: entity.id,
            kind: entity.kind,
            text: entity.text,
            confidence: entity.confidence,
            sourceMessageId: entity.sourceMessageId,
          });
        }
      }
    }
  }

  return jsonResponse(rows.slice(0, limit), 200);
}

async function processChatMessage(
  conversationId: string,
  messageId: string,
  promptText: string,
): Promise<void> {
  try {
    const assistantText = `I captured this input: ${promptText}. I will track related tasks, decisions, and questions for this conversation.`;

    for (const token of assistantText.split(" ")) {
      emitEvent(messageId, {
        type: "token",
        messageId,
        token: `${token} `,
      });
      await Bun.sleep(40);
    }

    const entities = extractEntities(promptText, messageId);
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      throw new Error("conversation missing in state");
    }

    conversation.messages.push({
      id: messageId,
      role: "assistant",
      text: assistantText,
      createdAt: new Date().toISOString(),
      entities,
    });

    emitEvent(messageId, {
      type: "extraction",
      messageId,
      entities,
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

function extractEntities(promptText: string, sourceMessageId: string): ExtractedEntity[] {
  const lower = promptText.toLowerCase();
  const entities: ExtractedEntity[] = [];

  if (lower.includes("task") || lower.includes("todo") || lower.includes("need to")) {
    entities.push({
      id: randomUUID(),
      kind: "task",
      text: promptText,
      confidence: 0.91,
      sourceMessageId,
    });
  }

  if (lower.includes("decide") || lower.includes("decision") || lower.includes("we should")) {
    entities.push({
      id: randomUUID(),
      kind: "decision",
      text: promptText,
      confidence: 0.87,
      sourceMessageId,
    });
  }

  if (lower.includes("?") || lower.includes("question") || lower.includes("how should")) {
    entities.push({
      id: randomUUID(),
      kind: "question",
      text: promptText,
      confidence: 0.84,
      sourceMessageId,
    });
  }

  return entities;
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
