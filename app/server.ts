/// <reference types="bun-types" />

import { randomUUID } from "node:crypto";
import { embed, generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import appHtml from "./src/client/index.html";
import type {
  ChatMessageResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  EntityKind,
  ExtractedEntity,
  ExtractedRelationship,
  OnboardingSeedItem,
  OnboardingState,
  SearchEntityResponse,
  SourceKind,
  StreamEvent,
  WorkspaceBootstrapMessage,
  WorkspaceBootstrapResponse,
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

type ExtractableEntityKind = Exclude<EntityKind, "workspace">;
type GraphEntityTable = "workspace" | "project" | "person" | "feature" | "task" | "decision" | "question";
type GraphEntityRecord = RecordId<GraphEntityTable, string>;
type SourceRecord = RecordId<"message" | "document_chunk", string>;

type ExtractionPromptEntity = {
  tempId: string;
  kind: ExtractableEntityKind;
  text: string;
  confidence: number;
};

type ExtractionPromptRelationship = {
  kind: string;
  fromTempId: string;
  toTempId: string;
  confidence: number;
  fromText: string;
  toText: string;
};

type ExtractionPromptOutput = {
  entities: ExtractionPromptEntity[];
  relationships: ExtractionPromptRelationship[];
  tools: string[];
};

type StreamState = {
  queue: StreamEvent[];
  controller?: ReadableStreamDefaultController<Uint8Array>;
  finished: boolean;
  keepAliveId?: ReturnType<typeof setInterval>;
};

type WorkspaceRow = {
  id: RecordId<"workspace", string>;
  name: string;
  status: string;
  onboarding_complete: boolean;
  onboarding_turn_count: number;
  onboarding_summary_pending: boolean;
};

type ConversationRow = {
  id: RecordId<"conversation", string>;
  createdAt: Date | string;
  updatedAt: Date | string;
  workspace: RecordId<"workspace", string>;
  source?: string;
};

type MessageContextRow = {
  id: RecordId<"message", string>;
  role: "user" | "assistant";
  text: string;
  createdAt: Date | string;
  suggestions?: string[];
};

type SearchEntityRow = {
  id: RecordId<"task" | "decision" | "question", string>;
  kind: "task" | "decision" | "question";
  text: string;
  confidence: number;
  sourceMessage: RecordId<"message", string>;
};

type HasProjectRow = {
  id: RecordId<"has_project", string>;
};

type HasFeatureRow = {
  id: RecordId<"has_feature", string>;
};

type MemberOfRow = {
  id: RecordId<"member_of", string>;
};

type ProjectScopeRow = {
  id: RecordId<"project", string>;
  name: string;
};

type CandidateEntityRow = {
  id: GraphEntityRecord;
  text: string;
  embedding?: number[];
};

type ProvenanceEdgeRow = {
  id: RecordId<"extraction_relation", string>;
  in: SourceRecord;
  out: GraphEntityRecord;
  confidence: number;
  extracted_at: Date | string;
};

type IncomingAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
};

type ParsedIncomingMessage = {
  clientMessageId: string;
  workspaceId: string;
  conversationId?: string;
  text: string;
  attachment?: IncomingAttachment;
};

type PersistExtractionResult = {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  seeds: OnboardingSeedItem[];
  embeddingTargets: Array<{ record: GraphEntityRecord; text: string }>;
  tools: string[];
};

type OnboardingCounts = {
  projectCount: number;
  personCount: number;
  decisionCount: number;
  questionCount: number;
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const allowedUploadExtensions = new Set(["md", "txt"]);

const extractionResultSchema = z.object({
  entities: z.array(
    z.object({
      tempId: z.string().min(1),
      kind: z.enum(["project", "person", "feature", "task", "decision", "question"]),
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
      fromText: z.string().min(1),
      toText: z.string().min(1),
    }),
  ),
  tools: z.array(z.string().min(1)),
});

const assistantReplySchema = z.object({
  message: z.string().min(1),
  suggestions: z.array(z.string().min(1)).max(3),
});

const encoder = new TextEncoder();
const streams = new Map<string, StreamState>();

const openRouterApiKey = Bun.env.OPENROUTER_API_KEY;
if (!openRouterApiKey || openRouterApiKey.trim().length === 0) {
  throw new Error("OPENROUTER_API_KEY is required");
}

const extractionStoreThreshold = parseUnitInterval(
  Bun.env.EXTRACTION_STORE_THRESHOLD ?? Bun.env.EXTRACTION_CONFIDENCE_THRESHOLD ?? "0.6",
  "EXTRACTION_STORE_THRESHOLD",
);
const extractionDisplayThreshold = parseUnitInterval(
  Bun.env.EXTRACTION_DISPLAY_THRESHOLD ?? "0.85",
  "EXTRACTION_DISPLAY_THRESHOLD",
);
if (extractionDisplayThreshold < extractionStoreThreshold) {
  throw new Error("EXTRACTION_DISPLAY_THRESHOLD must be greater than or equal to EXTRACTION_STORE_THRESHOLD");
}

const assistantModelId = Bun.env.ASSISTANT_MODEL ?? "openai/gpt-4.1-mini";
const extractionModelId = Bun.env.EXTRACTION_MODEL ?? "openai/gpt-4.1-mini";
const embeddingModelId = Bun.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
const embeddingDimension = parsePositiveInteger(Bun.env.EMBEDDING_DIMENSION ?? "1536", "EMBEDDING_DIMENSION");
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
await ensureDefaultWorkspaceProjectScope();

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
  idleTimeout: 0,
  routes: {
    "/healthz": {
      GET: () => jsonResponse({ status: "ok" }, 200),
    },
    "/api/workspaces": {
      POST: (request) => handleCreateWorkspace(request),
    },
    "/api/workspaces/:workspaceId/bootstrap": {
      GET: (request) => handleWorkspaceBootstrap(request.params.workspaceId),
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

async function handleCreateWorkspace(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const parsed = parseCreateWorkspaceRequest(body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const now = new Date();
  const workspaceId = randomUUID();
  const conversationId = randomUUID();
  const ownerId = randomUUID();

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const conversationRecord = new RecordId("conversation", conversationId);
  const ownerRecord = new RecordId("person", ownerId);
  const starterMessageRecord = new RecordId("message", randomUUID());
  const starterSuggestions = [
    "I'll describe my project",
    "I have a document to upload",
    "I'm running multiple projects",
  ];

  const starterMessage = [
    `Hey ${parsed.data.ownerDisplayName}!`,
    "I'm ready to help you build out your workspace.",
    "Tell me about what you're working on - what's the main project or business you want to track here?",
    "If you have an existing document (like a plan or spec), you can drop it in and I'll extract everything from it.",
  ].join(" ");

  const transaction = await surreal.beginTransaction();
  try {
    await transaction.create(workspaceRecord).content({
      name: parsed.data.name,
      status: "active",
      onboarding_complete: false,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: now,
      created_at: now,
      updated_at: now,
    });

    const ownerEmbedding = await createEmbedding(parsed.data.ownerDisplayName);
    await transaction.create(ownerRecord).content({
      name: parsed.data.ownerDisplayName,
      ...(ownerEmbedding ? { embedding: ownerEmbedding } : {}),
      created_at: now,
      updated_at: now,
    });

    await transaction.relate(ownerRecord, new RecordId("member_of", randomUUID()), workspaceRecord, {
      role: "owner",
      added_at: now,
    }).output("after");

    await transaction.create(conversationRecord).content({
      createdAt: now,
      updatedAt: now,
      workspace: workspaceRecord,
      source: "onboarding",
    });

    await transaction.create(starterMessageRecord).content({
      conversation: conversationRecord,
      role: "assistant",
      text: starterMessage,
      suggestions: starterSuggestions,
      createdAt: now,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.cancel();
    logServerError("create workspace failed", error);
    const errorText = error instanceof Error ? error.message : "workspace creation failed";
    return jsonError(errorText, 500);
  }

  const response: CreateWorkspaceResponse = {
    workspaceId,
    workspaceName: parsed.data.name,
    conversationId,
    onboardingComplete: false,
  };

  return jsonResponse(response, 200);
}

async function handleWorkspaceBootstrap(workspaceId: string): Promise<Response> {
  try {
    const workspaceRecord = await resolveWorkspaceRecord(workspaceId);
    const workspace = await surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) {
      throw new HttpError(404, `workspace not found: ${workspaceId}`);
    }

    const conversationRecord = await resolveWorkspaceBootstrapConversation(workspaceRecord);
    const [messageRows] = await surreal
      .query<[MessageContextRow[]]>(
        "SELECT id, role, text, createdAt, suggestions FROM message WHERE conversation = $conversation ORDER BY createdAt ASC LIMIT 80;",
        {
          conversation: conversationRecord,
        },
      )
      .collect<[MessageContextRow[]]>();

    const messages = messageRows.map((row) => ({
      id: row.id.id as string,
      role: row.role,
      text: row.text,
      createdAt: toIsoString(row.createdAt),
      ...(row.suggestions && row.suggestions.length > 0 ? { suggestions: row.suggestions } : {}),
    } satisfies WorkspaceBootstrapMessage));

    const seeds = await loadWorkspaceSeeds(workspaceRecord, 40);
    const onboardingState = toOnboardingState(workspace);

    const payload: WorkspaceBootstrapResponse = {
      workspaceId: workspace.id.id as string,
      workspaceName: workspace.name,
      onboardingComplete: workspace.onboarding_complete,
      onboardingState,
      conversationId: conversationRecord.id as string,
      messages,
      seeds,
    };

    return jsonResponse(payload, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }

    logServerError("workspace bootstrap failed", error, { workspaceId });
    const errorText = error instanceof Error ? error.message : "workspace bootstrap failed";
    return jsonError(errorText, 500);
  }
}

async function handlePostChatMessage(request: Request): Promise<Response> {
  let parsed: { ok: true; data: ParsedIncomingMessage } | { ok: false; error: string };
  try {
    parsed = await parseIncomingMessageRequest(request);
  } catch (error) {
    logServerError("parse incoming message failed", error);
    const errorText = error instanceof Error ? error.message : "invalid request body";
    return jsonError(errorText, 400);
  }

  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const conversationId = parsed.data.conversationId ?? randomUUID();
  const messageId = randomUUID();
  const workspaceId = parsed.data.workspaceId;
  const userText = parsed.data.text.trim();
  const messageText = userText.length > 0 ? userText : `Uploaded document: ${parsed.data.attachment?.fileName ?? "attachment"}`;
  const userMessageRecord = new RecordId("message", randomUUID());

  let workspaceRecord: RecordId<"workspace", string>;

  try {
    workspaceRecord = await resolveWorkspaceRecord(workspaceId);
    const workspace = await surreal.select<WorkspaceRow>(workspaceRecord);
    if (!workspace) {
      throw new HttpError(404, `workspace not found: ${workspaceId}`);
    }

    const now = new Date();
    const conversationRecord = new RecordId("conversation", conversationId);
    const existingConversation = await surreal.select<ConversationRow>(conversationRecord);

    const transaction = await surreal.beginTransaction();
    try {
      if (existingConversation) {
        if (!existingConversation.workspace) {
          throw new HttpError(500, "conversation is missing workspace scope");
        }

        if (existingConversation.workspace.id !== workspaceRecord.id) {
          throw new HttpError(400, "conversation scope does not match workspaceId");
        }

        await transaction.update(conversationRecord).merge({
          updatedAt: now,
        });
      } else {
        await transaction.create(conversationRecord).content({
          createdAt: now,
          updatedAt: now,
          workspace: workspaceRecord,
          ...(workspace.onboarding_complete ? {} : { source: "onboarding" }),
        });
      }

      await transaction.create(userMessageRecord).content({
        conversation: conversationRecord,
        role: "user",
        text: messageText,
        createdAt: now,
        clientMessageId: parsed.data.clientMessageId,
      });

      if (!workspace.onboarding_complete) {
        await transaction.update(workspaceRecord).merge({
          onboarding_turn_count: workspace.onboarding_turn_count + 1,
          updated_at: now,
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.cancel();
      throw error;
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }

    logServerError("persist user message failed", error, { conversationId, messageId });
    const errorText = error instanceof Error ? error.message : "failed to persist user message";
    return jsonError(errorText, 500);
  }

  streams.set(messageId, {
    queue: [],
    finished: false,
  });

  void processChatMessage({
    conversationId,
    messageId,
    workspaceRecord,
    userMessageRecord,
    userText: messageText,
    attachment: parsed.data.attachment,
  });

  const response: ChatMessageResponse = {
    messageId,
    userMessageId: userMessageRecord.id as string,
    conversationId,
    workspaceId,
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
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return jsonError("workspaceId is required", 400);
  }

  const projectId = url.searchParams.get("projectId")?.trim();

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
  let workspaceRecord: RecordId<"workspace", string>;
  let projectRecord: RecordId<"project", string> | undefined;

  try {
    workspaceRecord = await resolveWorkspaceRecord(workspaceId);
    if (projectId) {
      projectRecord = await resolveWorkspaceProjectRecord(workspaceRecord, projectId);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }

    logServerError("scope validation failed", error, { workspaceId, projectId });
    const errorText = error instanceof Error ? error.message : "failed to validate scope";
    return jsonError(errorText, 500);
  }

  const [rows] = projectRecord
    ? await surreal
        .query<[SearchEntityRow[]]>(
          "RETURN fn::entity_search_project($query, $limit, $workspace, $project);",
          {
            query,
            limit,
            workspace: workspaceRecord,
            project: projectRecord,
          },
        )
        .collect<[SearchEntityRow[]]>()
    : await surreal
        .query<[SearchEntityRow[]]>(
          "RETURN fn::entity_search_workspace($query, $limit, $workspace);",
          {
            query,
            limit,
            workspace: workspaceRecord,
          },
        )
        .collect<[SearchEntityRow[]]>();

  const responseRows = rows
    .map((row) => ({
      id: row.id.id as string,
      kind: row.kind,
      text: row.text,
      confidence: row.confidence,
      sourceId: row.sourceMessage.id as string,
      sourceKind: "message",
    } satisfies SearchEntityResponse))
    .slice(0, limit);

  return jsonResponse(responseRows, 200);
}

async function processChatMessage(input: {
  conversationId: string;
  messageId: string;
  workspaceRecord: RecordId<"workspace", string>;
  userMessageRecord: RecordId<"message", string>;
  userText: string;
  attachment?: IncomingAttachment;
}): Promise<void> {
  try {
    const now = new Date();
    const conversationRecord = new RecordId("conversation", input.conversationId);
    const workspace = await surreal.select<WorkspaceRow>(input.workspaceRecord);
    if (!workspace) {
      throw new Error("workspace not found");
    }

    const conversation = await surreal.select<ConversationRow>(conversationRecord);
    if (!conversation) {
      throw new Error("conversation not found");
    }

    const contextRows = await loadConversationContext(input.conversationId);
    const persistedEntities: ExtractedEntity[] = [];
    const persistedRelationships: ExtractedRelationship[] = [];
    const seedItems: OnboardingSeedItem[] = [];
    const embeddingTargets: Array<{ record: GraphEntityRecord; text: string }> = [];
    const extractedTools: string[] = [];

    if (input.attachment) {
      const ingestion = await ingestAttachment({
        workspaceRecord: input.workspaceRecord,
        conversationRecord,
        userMessageRecord: input.userMessageRecord,
        attachment: input.attachment,
        now,
      });

      persistedEntities.push(...ingestion.entities);
      persistedRelationships.push(...ingestion.relationships);
      seedItems.push(...ingestion.seeds);
      embeddingTargets.push(...ingestion.embeddingTargets);
      extractedTools.push(...ingestion.tools);
    }

    const textExtraction = await extractStructuredGraph({
      contextRows,
      latestText: input.userText,
      onboarding: !workspace.onboarding_complete,
    });

    const textPersistence = await persistExtractionOutput({
      workspaceRecord: input.workspaceRecord,
      sourceRecord: input.userMessageRecord,
      sourceKind: "message",
      sourceLabel: input.userText.slice(0, 140),
      promptText: input.userText,
      output: textExtraction,
      sourceMessageRecord: input.userMessageRecord,
      now,
    });

    persistedEntities.push(...textPersistence.entities);
    persistedRelationships.push(...textPersistence.relationships);
    seedItems.push(...textPersistence.seeds);
    embeddingTargets.push(...textPersistence.embeddingTargets);
    extractedTools.push(...textPersistence.tools);

    if (extractedTools.length > 0) {
      const dedupedTools = [...new Set(extractedTools.map((tool) => tool.trim()).filter((tool) => tool.length > 0))];
      if (dedupedTools.length > 0) {
        await appendWorkspaceTools(input.workspaceRecord, dedupedTools, now);
      }
    }

    const onboardingBefore = toOnboardingState(workspace);
    const onboardingAfter = await transitionOnboardingState({
      workspaceRecord: input.workspaceRecord,
      workspace,
      userText: input.userText,
      hasAttachment: Boolean(input.attachment),
      now,
    });

    const assistantReply = await generateAssistantReply({
      onboardingState: onboardingAfter,
      contextRows,
      latestUserText: input.userText,
      workspaceRecord: input.workspaceRecord,
    });
    const summaryBlock = buildExtractionSummaryComponentBlock(persistedEntities, persistedRelationships);
    const assistantText = summaryBlock
      ? `${assistantReply.message.trim()}\n\n${summaryBlock}`
      : assistantReply.message.trim();

    for (const token of assistantText.split(" ")) {
      emitEvent(input.messageId, {
        type: "token",
        messageId: input.messageId,
        token: `${token} `,
      });
      await Bun.sleep(25);
    }

    const assistantMessageRecord = new RecordId("message", input.messageId);
    await surreal.create(assistantMessageRecord).content({
      conversation: conversationRecord,
      role: "assistant",
      text: assistantText,
      ...(assistantReply.suggestions.length > 0 ? { suggestions: assistantReply.suggestions } : {}),
      createdAt: now,
    });

    await surreal.update(conversationRecord).merge({
      updatedAt: now,
    });

    void persistEmbeddings(assistantMessageRecord, assistantText, embeddingTargets).catch((error: unknown) => {
      logServerError("embedding persistence failed", error, {
        messageId: assistantMessageRecord.id,
      });
    });

    emitEvent(input.messageId, {
      type: "extraction",
      messageId: input.messageId,
      entities: persistedEntities,
      relationships: persistedRelationships,
    });

    if (seedItems.length > 0) {
      emitEvent(input.messageId, {
        type: "onboarding_seed",
        messageId: input.messageId,
        seeds: seedItems,
      });
    }

    if (onboardingBefore !== onboardingAfter) {
      emitEvent(input.messageId, {
        type: "onboarding_state",
        messageId: input.messageId,
        onboardingState: onboardingAfter,
      });
    }

    emitEvent(input.messageId, {
      type: "assistant_message",
      messageId: input.messageId,
      text: assistantText,
      ...(assistantReply.suggestions.length > 0 ? { suggestions: assistantReply.suggestions } : {}),
    });

    emitEvent(input.messageId, {
      type: "done",
      messageId: input.messageId,
    });
  } catch (error) {
    logServerError("chat processing failed", error, {
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
    const errorText = userFacingError(error, "chat processing failed");
    emitEvent(input.messageId, {
      type: "error",
      messageId: input.messageId,
      error: errorText,
    });
  }
}

async function transitionOnboardingState(input: {
  workspaceRecord: RecordId<"workspace", string>;
  workspace: WorkspaceRow;
  userText: string;
  hasAttachment: boolean;
  now: Date;
}): Promise<OnboardingState> {
  if (input.workspace.onboarding_complete) {
    return "complete";
  }

  if (input.workspace.onboarding_summary_pending) {
    if (shouldFinalizeOnboarding(input.userText, input.hasAttachment)) {
      await surreal.update(input.workspaceRecord).merge({
        onboarding_complete: true,
        onboarding_summary_pending: false,
        onboarding_completed_at: input.now,
        updated_at: input.now,
      });
      return "complete";
    }

    return "summary_pending";
  }

  const counts = await loadOnboardingCounts(input.workspaceRecord);
  const minimumGraphReady =
    counts.projectCount >= 1 && counts.personCount >= 1 && counts.decisionCount + counts.questionCount >= 1;

  if (minimumGraphReady || input.workspace.onboarding_turn_count >= 7) {
    await surreal.update(input.workspaceRecord).merge({
      onboarding_summary_pending: true,
      updated_at: input.now,
    });
    return "summary_pending";
  }

  return "active";
}

function shouldFinalizeOnboarding(userText: string, hasAttachment: boolean): boolean {
  if (hasAttachment) {
    return true;
  }

  const normalized = userText.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  const correctionPattern = /(missing|change|correct|actually|remove|not exactly|update)/;
  if (correctionPattern.test(normalized)) {
    return false;
  }

  const confirmPattern = /(looks good|let'?s go|sounds good|yep|yes|ready|start)/;
  if (confirmPattern.test(normalized)) {
    return true;
  }

  return true;
}

async function generateAssistantReply(input: {
  onboardingState: OnboardingState;
  contextRows: MessageContextRow[];
  latestUserText: string;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<{ message: string; suggestions: string[] }> {
  let systemPrompt =
    "You are helping a product team capture actionable project state. Respond concisely with clear next actions.";

  if (input.onboardingState === "active") {
    const summary = await loadOnboardingSummary(input.workspaceRecord);
    systemPrompt = [
      "You are onboarding a newly created workspace.",
      "Ask one natural question at a time like a smart colleague, never as a form.",
      "Cover these topics over 5-7 turns: business/venture, current projects, people involved, most important decision, tools used, biggest bottleneck.",
      "Confirm captured entities inline in plain language.",
      "Return exactly 3 short clickable follow-up suggestions that move onboarding forward.",
      "Do not dump all questions at once.",
      "Current extracted context:",
      summary,
    ].join(" ");
  }

  if (input.onboardingState === "summary_pending") {
    const summary = await loadOnboardingSummary(input.workspaceRecord);
    systemPrompt = [
      "You are finishing onboarding for a workspace.",
      "Summarize what has been captured in a concise bullet list and ask if anything is missing or incorrect.",
      "End with an invitation to proceed into normal chat.",
      "Return exactly 3 short clickable follow-up suggestions.",
      "Current extracted context:",
      summary,
    ].join(" ");
  }

  const assistantResponse = await generateObject({
    model: assistantModel,
    schema: assistantReplySchema,
    system: systemPrompt,
    prompt: [
      "Return JSON with this shape: { message: string, suggestions: string[] }.",
      "Message must be plain text only. Do not include markdown code fences or component JSON.",
      "Suggestions must be short and actionable. Do not include numbering or punctuation-only entries.",
      "Conversation context:",
      formatContextRows(input.contextRows),
      "",
      "Latest user message:",
      input.latestUserText,
    ].join("\n"),
  });

  const assistantText = assistantResponse.object.message.trim();
  if (assistantText.length === 0) {
    throw new Error("assistant response was empty");
  }

  const suggestions = [...new Set(assistantResponse.object.suggestions.map((value) => value.trim()))]
    .filter((value) => value.length > 0)
    .slice(0, 3);
  if (suggestions.length === 0) {
    throw new Error("assistant suggestions were empty");
  }

  return {
    message: assistantText,
    suggestions,
  };
}

async function ingestAttachment(input: {
  workspaceRecord: RecordId<"workspace", string>;
  conversationRecord: RecordId<"conversation", string>;
  userMessageRecord: RecordId<"message", string>;
  attachment: IncomingAttachment;
  now: Date;
}): Promise<PersistExtractionResult> {
  const documentRecord = new RecordId("document", randomUUID());
  await surreal.create(documentRecord).content({
    workspace: input.workspaceRecord,
    name: input.attachment.fileName,
    mime_type: input.attachment.mimeType,
    size_bytes: input.attachment.sizeBytes,
    uploaded_at: input.now,
  });

  const chunks = splitDocumentIntoChunks(input.attachment.content);
  const persistedEntities: ExtractedEntity[] = [];
  const persistedRelationships: ExtractedRelationship[] = [];
  const seeds: OnboardingSeedItem[] = [];
  const embeddingTargets: Array<{ record: GraphEntityRecord; text: string }> = [];
  const tools: string[] = [];

  for (const chunk of chunks) {
    const chunkRecord = new RecordId("document_chunk", randomUUID());
    const chunkEmbedding = await createEmbedding(chunk.content);

    await surreal.create(chunkRecord).content({
      document: documentRecord,
      workspace: input.workspaceRecord,
      content: chunk.content,
      ...(chunk.heading ? { section_heading: chunk.heading } : {}),
      position: chunk.position,
      ...(chunkEmbedding ? { embedding: chunkEmbedding } : {}),
      created_at: input.now,
    });

    const extraction = await extractStructuredGraph({
      contextRows: [],
      latestText: chunk.content,
      onboarding: true,
      heading: chunk.heading,
    });

    const result = await persistExtractionOutput({
      workspaceRecord: input.workspaceRecord,
      sourceRecord: chunkRecord,
      sourceKind: "document_chunk",
      sourceLabel: chunk.heading ? `${input.attachment.fileName} · ${chunk.heading}` : input.attachment.fileName,
      promptText: chunk.content,
      output: extraction,
      sourceChunkRecord: chunkRecord,
      now: input.now,
    });

    persistedEntities.push(...result.entities);
    persistedRelationships.push(...result.relationships);
    seeds.push(...result.seeds);
    embeddingTargets.push(...result.embeddingTargets);
    tools.push(...result.tools);
  }

  return {
    entities: persistedEntities,
    relationships: persistedRelationships,
    seeds,
    embeddingTargets,
    tools,
  };
}

async function extractStructuredGraph(input: {
  contextRows: MessageContextRow[];
  latestText: string;
  onboarding: boolean;
  heading?: string;
}): Promise<ExtractionPromptOutput> {
  const extractionOutput = await generateObject({
    model: extractionModel,
    schema: extractionResultSchema,
    system: [
      "Extract structured business entities and relationships from the provided text.",
      "Return only high-confidence extractions with explicit entity references.",
      "Entity kinds: project, person, feature, task, decision, question.",
      "Each entity must include a tempId.",
      "Each relationship must reference entities via fromTempId and toTempId.",
      "Each relationship must include fromText and toText snippets from the source text.",
      "Relationship kind is uppercase snake_case when possible (for example DEPENDS_ON, BLOCKS, RELATES_TO).",
      "Capture tools/providers explicitly mentioned in the tools array.",
      "Always include the tools key; use an empty array when no tools are mentioned.",
      "Confidence values must be between 0 and 1.",
      input.onboarding
        ? "Prioritize foundational onboarding entities: projects, people, first decisions, open questions, and constraints."
        : "Prioritize actionable entities and direct relationships.",
    ].join(" "),
    prompt: [
      "Conversation context:",
      formatContextRows(input.contextRows),
      input.heading ? `Section heading: ${input.heading}` : "",
      "",
      "Source text:",
      input.latestText,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  });

  return extractionOutput.object as ExtractionPromptOutput;
}

async function persistExtractionOutput(input: {
  workspaceRecord: RecordId<"workspace", string>;
  sourceRecord: SourceRecord;
  sourceKind: SourceKind;
  sourceLabel?: string;
  promptText: string;
  output: ExtractionPromptOutput;
  sourceMessageRecord?: RecordId<"message", string>;
  sourceChunkRecord?: RecordId<"document_chunk", string>;
  now: Date;
}): Promise<PersistExtractionResult> {
  const entities = dedupeExtractedEntities(input.output.entities);
  const relationships = input.output.relationships
    .filter((relationship) => relationship.confidence >= extractionStoreThreshold)
    .map((relationship) => ({
      ...relationship,
      kind: relationship.kind.trim(),
      fromTempId: relationship.fromTempId.trim(),
      toTempId: relationship.toTempId.trim(),
      fromText: relationship.fromText.trim(),
      toText: relationship.toText.trim(),
    }))
    .filter(
      (relationship) =>
        relationship.kind.length > 0 &&
        relationship.fromTempId.length > 0 &&
        relationship.toTempId.length > 0 &&
        relationship.fromText.length > 0 &&
        relationship.toText.length > 0,
    );

  const persistedEntities: ExtractedEntity[] = [];
  const persistedRelationships: ExtractedRelationship[] = [];
  const seeds: OnboardingSeedItem[] = [];
  const embeddingTargets: Array<{ record: GraphEntityRecord; text: string }> = [];
  const entityByTempId = new Map<string, { record: GraphEntityRecord; text: string; id: string; kind: EntityKind }>();

  const workspaceProjects = await loadWorkspaceProjects(input.workspaceRecord);

  for (const extracted of entities) {
    const persisted = await upsertGraphEntity({
      workspaceRecord: input.workspaceRecord,
      workspaceProjects,
      sourceRecord: input.sourceRecord,
      sourceKind: input.sourceKind,
      promptText: input.promptText,
      extracted,
      sourceMessageRecord: input.sourceMessageRecord,
      sourceChunkRecord: input.sourceChunkRecord,
      now: input.now,
    });

    entityByTempId.set(extracted.tempId, {
      record: persisted.record,
      text: persisted.text,
      id: persisted.record.id as string,
      kind: persisted.kind,
    });

    persistedEntities.push({
      id: persisted.record.id as string,
      kind: persisted.kind,
      text: persisted.text,
      confidence: extracted.confidence,
      sourceKind: input.sourceKind,
      sourceId: input.sourceRecord.id as string,
    });

    seeds.push({
      id: persisted.record.id as string,
      kind: persisted.kind,
      text: persisted.text,
      confidence: extracted.confidence,
      sourceKind: input.sourceKind,
      sourceId: input.sourceRecord.id as string,
      ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
    });

    if (persisted.created) {
      embeddingTargets.push({
        record: persisted.record,
        text: persisted.text,
      });
    }
  }

  for (const relationship of relationships) {
    const from = entityByTempId.get(relationship.fromTempId);
    const to = entityByTempId.get(relationship.toTempId);
    if (!from || !to) {
      continue;
    }

    const relationRecord = new RecordId("entity_relation", randomUUID());
    await surreal.relate(from.record, relationRecord, to.record, {
      kind: relationship.kind,
      confidence: relationship.confidence,
      ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
      ...(input.sourceChunkRecord ? { source_chunk: input.sourceChunkRecord } : {}),
      extracted_at: input.now,
      created_at: input.now,
      from_text: relationship.fromText,
      to_text: relationship.toText,
    }).output("after");

    persistedRelationships.push({
      id: relationRecord.id as string,
      kind: relationship.kind,
      fromId: from.id,
      toId: to.id,
      confidence: relationship.confidence,
      sourceKind: input.sourceKind,
      sourceId: input.sourceRecord.id as string,
      ...(input.sourceMessageRecord ? { sourceMessageId: input.sourceMessageRecord.id as string } : {}),
      fromText: relationship.fromText,
      toText: relationship.toText,
    });
  }

  return {
    entities: persistedEntities,
    relationships: persistedRelationships,
    seeds,
    embeddingTargets,
    tools: input.output.tools.map((tool) => tool.trim()).filter((tool) => tool.length > 0),
  };
}

function dedupeExtractedEntities(entities: ExtractionPromptEntity[]): ExtractionPromptEntity[] {
  const byTempId = new Map<string, ExtractionPromptEntity>();

  for (const entity of entities) {
    const tempId = entity.tempId.trim();
    if (tempId.length === 0) {
      continue;
    }

    const text = entity.text.trim();
    if (text.length === 0) {
      continue;
    }

    if (entity.confidence < extractionStoreThreshold) {
      continue;
    }

    const existing = byTempId.get(tempId);
    if (!existing || entity.confidence > existing.confidence) {
      byTempId.set(tempId, {
        ...entity,
        tempId,
        text,
      });
    }
  }

  return [...byTempId.values()];
}

function buildExtractionSummaryComponentBlock(
  entities: ExtractedEntity[],
  relationships: ExtractedRelationship[],
): string | undefined {
  const summaryEntities = new Map<
    string,
    { kind: ExtractableEntityKind; name: string; confidence: number; status: "captured" }
  >();

  for (const entity of [...entities].sort((a, b) => b.confidence - a.confidence)) {
    if (entity.kind === "workspace" || entity.confidence < extractionDisplayThreshold) {
      continue;
    }

    const name = entity.text.trim();
    if (name.length === 0) {
      continue;
    }

    const key = `${entity.kind}:${normalizeName(name)}`;
    if (!summaryEntities.has(key)) {
      summaryEntities.set(key, {
        kind: entity.kind as ExtractableEntityKind,
        name,
        confidence: entity.confidence,
        status: "captured",
      });
    }
  }

  if (summaryEntities.size === 0) {
    return undefined;
  }

  const relationshipCount = relationships.filter(
    (relationship) => relationship.confidence >= extractionDisplayThreshold,
  ).length;

  const summarySpec = {
    type: "ExtractionSummary",
    props: {
      title: "Captured from your latest message",
      entities: [...summaryEntities.values()].slice(0, 6),
      relationshipCount,
    },
  };

  return ["```component", JSON.stringify(summarySpec, null, 2), "```"].join("\n");
}

async function upsertGraphEntity(input: {
  workspaceRecord: RecordId<"workspace", string>;
  workspaceProjects: ProjectScopeRow[];
  sourceRecord: SourceRecord;
  sourceKind: SourceKind;
  promptText: string;
  extracted: ExtractionPromptEntity;
  sourceMessageRecord?: RecordId<"message", string>;
  sourceChunkRecord?: RecordId<"document_chunk", string>;
  now: Date;
}): Promise<{ record: GraphEntityRecord; text: string; kind: EntityKind; created: boolean }> {
  const candidateEmbedding = await createEmbedding(input.extracted.text);
  const candidates = await loadWorkspaceKindCandidates(input.workspaceRecord, input.extracted.kind);

  let bestCandidate: CandidateEntityRow | undefined;
  let bestSimilarity = -1;

  for (const candidate of candidates) {
    if (!candidate.embedding || !candidateEmbedding) {
      continue;
    }

    const similarity = cosineSimilarity(candidateEmbedding, candidate.embedding);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestCandidate = candidate;
    }
  }

  const fuzzyMatch = bestCandidate
    ? isFuzzyNameMatch(normalizeName(input.extracted.text), normalizeName(bestCandidate.text))
    : false;

  if (bestCandidate && bestSimilarity > 0.95 && fuzzyMatch) {
    await createProvenanceEdge({
      sourceRecord: input.sourceRecord,
      targetRecord: bestCandidate.id,
      confidence: input.extracted.confidence,
      model: extractionModelId,
      now: input.now,
      fromText: input.extracted.text,
    });

    return {
      record: bestCandidate.id,
      text: bestCandidate.text,
      kind: input.extracted.kind,
      created: false,
    };
  }

  const entityRecord = new RecordId(input.extracted.kind, randomUUID()) as GraphEntityRecord;
  await surreal.create(entityRecord).content(
    buildEntityRecordContent(input.extracted.kind, input.extracted.text, input.extracted.confidence, input.now, candidateEmbedding),
  );

  await createProvenanceEdge({
    sourceRecord: input.sourceRecord,
    targetRecord: entityRecord,
    confidence: input.extracted.confidence,
    model: extractionModelId,
    now: input.now,
    fromText: input.extracted.text,
  });

  if (input.extracted.kind === "project") {
    await ensureWorkspaceProjectEdge(input.workspaceRecord, entityRecord as RecordId<"project", string>, input.now);
    input.workspaceProjects.push({
      id: entityRecord as RecordId<"project", string>,
      name: input.extracted.text,
    });
  }

  if (input.extracted.kind === "person") {
    await ensureWorkspaceMemberEdge(
      entityRecord as RecordId<"person", string>,
      input.workspaceRecord,
      input.now,
    );
  }

  if (input.extracted.kind === "feature") {
    const projectRecord = resolveEntityProject(input.extracted.text, input.promptText, input.workspaceProjects);
    if (projectRecord) {
      await ensureProjectFeatureEdge(projectRecord, entityRecord as RecordId<"feature", string>, input.now);
    }
  }

  if (input.extracted.kind === "task" || input.extracted.kind === "decision" || input.extracted.kind === "question") {
    const projectRecord = resolveEntityProject(input.extracted.text, input.promptText, input.workspaceProjects);
    if (projectRecord) {
      await surreal.relate(entityRecord, new RecordId("belongs_to", randomUUID()), projectRecord, {
        added_at: input.now,
      }).output("after");
    }
  }

  if (bestCandidate && bestSimilarity >= 0.8 && bestSimilarity <= 0.95) {
    await surreal.relate(entityRecord, new RecordId("entity_relation", randomUUID()), bestCandidate.id, {
      kind: "POSSIBLE_DUPLICATE",
      confidence: bestSimilarity,
      ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
      ...(input.sourceChunkRecord ? { source_chunk: input.sourceChunkRecord } : {}),
      extracted_at: input.now,
      created_at: input.now,
      from_text: input.extracted.text,
      to_text: bestCandidate.text,
    }).output("after");
  }

  return {
    record: entityRecord,
    text: input.extracted.text,
    kind: input.extracted.kind,
    created: true,
  };
}

async function createProvenanceEdge(input: {
  sourceRecord: SourceRecord;
  targetRecord: GraphEntityRecord;
  confidence: number;
  model: string;
  now: Date;
  fromText: string;
}): Promise<void> {
  await surreal.relate(input.sourceRecord, new RecordId("extraction_relation", randomUUID()), input.targetRecord, {
    confidence: input.confidence,
    extracted_at: input.now,
    created_at: input.now,
    model: input.model,
    from_text: input.fromText,
  }).output("after");
}

function buildEntityRecordContent(
  kind: ExtractableEntityKind,
  text: string,
  confidence: number,
  now: Date,
  embedding?: number[],
): Record<string, unknown> {
  if (kind === "project") {
    return {
      name: text,
      status: "active",
      ...(embedding ? { embedding } : {}),
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "person") {
    return {
      name: text,
      ...(embedding ? { embedding } : {}),
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "feature") {
    return {
      name: text,
      status: "active",
      ...(embedding ? { embedding } : {}),
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "task") {
    return {
      title: text,
      status: "open",
      extraction_confidence: confidence,
      extracted_at: now,
      ...(embedding ? { embedding } : {}),
      created_at: now,
      updated_at: now,
    };
  }

  if (kind === "decision") {
    return {
      summary: text,
      status: "extracted",
      extraction_confidence: confidence,
      extracted_at: now,
      ...(embedding ? { embedding } : {}),
      created_at: now,
      updated_at: now,
    };
  }

  return {
    text,
    status: "open",
    extraction_confidence: confidence,
    extracted_at: now,
    ...(embedding ? { embedding } : {}),
    created_at: now,
    updated_at: now,
  };
}

async function loadWorkspaceKindCandidates(
  workspaceRecord: RecordId<"workspace", string>,
  kind: ExtractableEntityKind,
): Promise<CandidateEntityRow[]> {
  if (kind === "project") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        "SELECT id, name AS text, embedding FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  if (kind === "person") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        "SELECT id, name AS text, embedding FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  if (kind === "feature") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        [
          "SELECT id, name AS text, embedding",
          "FROM feature",
          "WHERE id IN (",
          "  SELECT VALUE out",
          "  FROM has_feature",
          "  WHERE `in` IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
          ");",
        ].join(" "),
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return rows;
  }

  if (kind === "task") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        [
          "SELECT id, title AS text, embedding",
          "FROM task",
          "WHERE id IN (",
          "  SELECT VALUE `in`",
          "  FROM belongs_to",
          "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
          ")",
          "OR source_message IN (",
          "  SELECT VALUE id",
          "  FROM message",
          "  WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
          ");",
        ].join(" "),
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return uniqueCandidateRows(rows);
  }

  if (kind === "decision") {
    const [rows] = await surreal
      .query<[CandidateEntityRow[]]>(
        [
          "SELECT id, summary AS text, embedding",
          "FROM decision",
          "WHERE id IN (",
          "  SELECT VALUE `in`",
          "  FROM belongs_to",
          "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
          ")",
          "OR source_message IN (",
          "  SELECT VALUE id",
          "  FROM message",
          "  WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
          ");",
        ].join(" "),
        { workspace: workspaceRecord },
      )
      .collect<[CandidateEntityRow[]]>();
    return uniqueCandidateRows(rows);
  }

  const [rows] = await surreal
    .query<[CandidateEntityRow[]]>(
      [
        "SELECT id, text AS text, embedding",
        "FROM question",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ")",
        "OR source_message IN (",
        "  SELECT VALUE id",
        "  FROM message",
        "  WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
        ");",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[CandidateEntityRow[]]>();
  return uniqueCandidateRows(rows);
}

function uniqueCandidateRows(rows: CandidateEntityRow[]): CandidateEntityRow[] {
  const byId = new Map<string, CandidateEntityRow>();
  for (const row of rows) {
    byId.set(row.id.id as string, row);
  }
  return [...byId.values()];
}

async function appendWorkspaceTools(
  workspaceRecord: RecordId<"workspace", string>,
  toolsToAdd: string[],
  now: Date,
): Promise<void> {
  const [rows] = await surreal
    .query<[Array<{ tools?: string[] }>]>("SELECT tools FROM $workspace LIMIT 1;", {
      workspace: workspaceRecord,
    })
    .collect<[Array<{ tools?: string[] }>]>();

  const existingTools = rows[0]?.tools ?? [];
  const merged = [...new Set([...existingTools, ...toolsToAdd])];
  await surreal.update(workspaceRecord).merge({
    tools: merged,
    updated_at: now,
  });
}

async function loadOnboardingCounts(workspaceRecord: RecordId<"workspace", string>): Promise<OnboardingCounts> {
  const [projectRows] = await surreal
    .query<[Array<{ id: RecordId<"project", string> }>]>(
      "SELECT id FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"project", string> }>]>();

  const [personRows] = await surreal
    .query<[Array<{ id: RecordId<"person", string> }>]>(
      "SELECT id FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"person", string> }>]>();

  const [decisionRows] = await surreal
    .query<[Array<{ id: RecordId<"decision", string> }>]>(
      [
        "SELECT id",
        "FROM decision",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ");",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ id: RecordId<"decision", string> }>]>();

  const [questionRows] = await surreal
    .query<[Array<{ id: RecordId<"question", string> }>]>(
      [
        "SELECT id",
        "FROM question",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ");",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ id: RecordId<"question", string> }>]>();

  return {
    projectCount: projectRows.length,
    personCount: personRows.length,
    decisionCount: decisionRows.length,
    questionCount: questionRows.length,
  };
}

async function loadOnboardingSummary(workspaceRecord: RecordId<"workspace", string>): Promise<string> {
  const [projectRows] = await surreal
    .query<[Array<{ name: string }>]>(
      "SELECT name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace) LIMIT 8;",
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ name: string }>]>()

  const [personRows] = await surreal
    .query<[Array<{ name: string }>]>(
      "SELECT name FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace) LIMIT 8;",
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ name: string }>]>()

  const [decisionRows] = await surreal
    .query<[Array<{ summary: string; created_at: Date | string }>]>(
      [
        "SELECT summary, created_at",
        "FROM decision",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ")",
        "ORDER BY created_at DESC",
        "LIMIT 8;",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ summary: string; created_at: Date | string }>]>()

  const [questionRows] = await surreal
    .query<[Array<{ text: string; created_at: Date | string }>]>(
      [
        "SELECT text, created_at",
        "FROM question",
        "WHERE id IN (",
        "  SELECT VALUE `in`",
        "  FROM belongs_to",
        "  WHERE out IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ")",
        "ORDER BY created_at DESC",
        "LIMIT 8;",
      ].join(" "),
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ text: string; created_at: Date | string }>]>()

  return [
    `Projects: ${projectRows.map((row) => row.name).join(", ") || "none"}`,
    `People: ${personRows.map((row) => row.name).join(", ") || "none"}`,
    `Decisions: ${decisionRows.map((row) => row.summary).join(" | ") || "none"}`,
    `Open questions: ${questionRows.map((row) => row.text).join(" | ") || "none"}`,
  ].join("\n");
}

function toOnboardingState(workspace: WorkspaceRow): OnboardingState {
  if (workspace.onboarding_complete) {
    return "complete";
  }
  if (workspace.onboarding_summary_pending) {
    return "summary_pending";
  }
  return "active";
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
}

async function loadConversationContext(conversationId: string): Promise<MessageContextRow[]> {
  const conversationRecord = new RecordId("conversation", conversationId);
  const [rows] = await surreal
    .query<[MessageContextRow[]]>(
      "RETURN fn::conversation_recent($conversation, $limit);",
      {
        conversation: conversationRecord,
        limit: 10,
      },
    )
    .collect<[MessageContextRow[]]>();

  return [...rows].reverse();
}

function formatContextRows(rows: MessageContextRow[]): string {
  if (rows.length === 0) {
    return "(no prior messages)";
  }

  return rows.map((row) => `${row.role.toUpperCase()}: ${row.text}`).join("\n");
}

async function loadWorkspaceSeeds(
  workspaceRecord: RecordId<"workspace", string>,
  limit: number,
): Promise<OnboardingSeedItem[]> {
  const [edgeRows] = await surreal
    .query<[ProvenanceEdgeRow[]]>(
      [
        "SELECT id, `in`, out, confidence, extracted_at",
        "FROM extraction_relation",
        "WHERE `in` IN array::concat(",
        "  (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)),",
        "  (SELECT VALUE id FROM document_chunk WHERE workspace = $workspace)",
        ")",
        "ORDER BY extracted_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: workspaceRecord,
        limit,
      },
    )
    .collect<[ProvenanceEdgeRow[]]>();

  const items: OnboardingSeedItem[] = [];

  for (const edge of edgeRows) {
    const entityText = await readEntityText(edge.out);
    if (!entityText) {
      continue;
    }

    const sourceTable = (edge.in as unknown as { tb: string }).tb;
    const entityTable = (edge.out as unknown as { tb: string }).tb;
    const sourceKind = (sourceTable === "document_chunk" ? "document_chunk" : "message") as SourceKind;
    const sourceLabel = await readSourceLabel(edge.in);

    items.push({
      id: edge.out.id as string,
      kind: entityTable as EntityKind,
      text: entityText,
      confidence: edge.confidence,
      sourceKind,
      sourceId: edge.in.id as string,
      ...(sourceLabel ? { sourceLabel } : {}),
    });
  }

  return items;
}

async function readEntityText(record: GraphEntityRecord): Promise<string | undefined> {
  const table = (record as unknown as { tb: string }).tb;

  if (table === "workspace") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"workspace", string>);
    return row?.name;
  }

  if (table === "project") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"project", string>);
    return row?.name;
  }

  if (table === "person") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"person", string>);
    return row?.name;
  }

  if (table === "feature") {
    const row = await surreal.select<{ name: string }>(record as RecordId<"feature", string>);
    return row?.name;
  }

  if (table === "task") {
    const row = await surreal.select<{ title: string }>(record as RecordId<"task", string>);
    return row?.title;
  }

  if (table === "decision") {
    const row = await surreal.select<{ summary: string }>(record as RecordId<"decision", string>);
    return row?.summary;
  }

  const row = await surreal.select<{ text: string }>(record as RecordId<"question", string>);
  return row?.text;
}

async function readSourceLabel(sourceRecord: SourceRecord): Promise<string | undefined> {
  const sourceTable = (sourceRecord as unknown as { tb: string }).tb;
  if (sourceTable === "message") {
    const row = await surreal.select<{ text: string }>(sourceRecord);
    if (!row) {
      return undefined;
    }
    return row.text.slice(0, 140);
  }

  const chunk = await surreal.select<{
    section_heading?: string;
    document: RecordId<"document", string>;
  }>(sourceRecord);

  if (!chunk) {
    return undefined;
  }

  const document = await surreal.select<{ name: string }>(chunk.document);
  if (!document) {
    return chunk.section_heading;
  }

  if (chunk.section_heading) {
    return `${document.name} · ${chunk.section_heading}`;
  }

  return document.name;
}

async function resolveWorkspaceBootstrapConversation(
  workspaceRecord: RecordId<"workspace", string>,
): Promise<RecordId<"conversation", string>> {
  const [onboardingRows] = await surreal
    .query<[Array<{ id: RecordId<"conversation", string> }>]>(
      "SELECT id, createdAt FROM conversation WHERE workspace = $workspace AND source = 'onboarding' ORDER BY createdAt ASC LIMIT 1;",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"conversation", string> }>]>();

  if (onboardingRows.length > 0) {
    return onboardingRows[0].id;
  }

  const [latestRows] = await surreal
    .query<[Array<{ id: RecordId<"conversation", string> }>]>(
      "SELECT id, createdAt FROM conversation WHERE workspace = $workspace ORDER BY createdAt DESC LIMIT 1;",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"conversation", string> }>]>();

  if (latestRows.length > 0) {
    return latestRows[0].id;
  }

  const now = new Date();
  const conversationRecord = new RecordId("conversation", randomUUID());
  await surreal.create(conversationRecord).content({
    createdAt: now,
    updatedAt: now,
    workspace: workspaceRecord,
    source: "onboarding",
  });
  return conversationRecord;
}

async function ensureDefaultWorkspaceProjectScope(): Promise<void> {
  const now = new Date();
  const workspaceRecord = new RecordId("workspace", "default");
  const projectRecord = new RecordId("project", "brain");

  const workspace = await surreal.select<{ id: RecordId<"workspace", string> }>(workspaceRecord);
  if (!workspace) {
    await surreal.create(workspaceRecord).content({
      name: "Marcus's Brain",
      status: "active",
      description: "Default dogfooding workspace",
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: now,
      onboarding_completed_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  const project = await surreal.select<{ id: RecordId<"project", string> }>(projectRecord);
  if (!project) {
    await surreal.create(projectRecord).content({
      name: "AI-Native Business Management Platform",
      status: "active",
      description: "Default dogfooding project",
      created_at: now,
      updated_at: now,
    });
  }

  await ensureWorkspaceProjectEdge(workspaceRecord, projectRecord, now);
}

async function ensureWorkspaceProjectEdge(
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  now: Date,
): Promise<void> {
  const [edgeRows] = await surreal
    .query<[HasProjectRow[]]>(
      "SELECT id FROM has_project WHERE `in` = $workspace AND out = $project LIMIT 1;",
      {
        workspace: workspaceRecord,
        project: projectRecord,
      },
    )
    .collect<[HasProjectRow[]]>();

  if (edgeRows.length === 0) {
    await surreal.relate(workspaceRecord, new RecordId("has_project", randomUUID()), projectRecord, {
      added_at: now,
    }).output("after");
  }
}

async function ensureProjectFeatureEdge(
  projectRecord: RecordId<"project", string>,
  featureRecord: RecordId<"feature", string>,
  now: Date,
): Promise<void> {
  const [edgeRows] = await surreal
    .query<[HasFeatureRow[]]>(
      "SELECT id FROM has_feature WHERE `in` = $project AND out = $feature LIMIT 1;",
      {
        project: projectRecord,
        feature: featureRecord,
      },
    )
    .collect<[HasFeatureRow[]]>();

  if (edgeRows.length === 0) {
    await surreal.relate(projectRecord, new RecordId("has_feature", randomUUID()), featureRecord, {
      added_at: now,
    }).output("after");
  }
}

async function ensureWorkspaceMemberEdge(
  personRecord: RecordId<"person", string>,
  workspaceRecord: RecordId<"workspace", string>,
  now: Date,
): Promise<void> {
  const [edgeRows] = await surreal
    .query<[MemberOfRow[]]>(
      "SELECT id FROM member_of WHERE `in` = $person AND out = $workspace LIMIT 1;",
      {
        person: personRecord,
        workspace: workspaceRecord,
      },
    )
    .collect<[MemberOfRow[]]>();

  if (edgeRows.length === 0) {
    await surreal.relate(personRecord, new RecordId("member_of", randomUUID()), workspaceRecord, {
      added_at: now,
    }).output("after");
  }
}

async function resolveWorkspaceRecord(workspaceId: string): Promise<RecordId<"workspace", string>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const workspace = await surreal.select<{ id: RecordId<"workspace", string> }>(workspaceRecord);
  if (!workspace) {
    throw new HttpError(404, `workspace not found: ${workspaceId}`);
  }
  return workspaceRecord;
}

async function resolveWorkspaceProjectRecord(
  workspaceRecord: RecordId<"workspace", string>,
  projectId: string,
): Promise<RecordId<"project", string>> {
  const projectRecord = new RecordId("project", projectId);
  const project = await surreal.select<{ id: RecordId<"project", string> }>(projectRecord);
  if (!project) {
    throw new HttpError(404, `project not found: ${projectId}`);
  }

  const [edgeRows] = await surreal
    .query<[HasProjectRow[]]>(
      "SELECT id FROM has_project WHERE `in` = $workspace AND out = $project LIMIT 1;",
      {
        workspace: workspaceRecord,
        project: projectRecord,
      },
    )
    .collect<[HasProjectRow[]]>();

  if (edgeRows.length === 0) {
    throw new HttpError(400, "project is not linked to workspace");
  }

  return projectRecord;
}

async function loadWorkspaceProjects(
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ProjectScopeRow[]> {
  const [rows] = await surreal
    .query<[ProjectScopeRow[]]>(
      "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[ProjectScopeRow[]]>();

  return rows;
}

function resolveEntityProject(
  entityText: string,
  promptText: string,
  projects: ProjectScopeRow[],
): RecordId<"project", string> | undefined {
  if (projects.length === 0) {
    return undefined;
  }

  if (projects.length === 1) {
    return projects[0].id;
  }

  const haystack = `${promptText}\n${entityText}`.toLowerCase();
  const matchingProjects = projects.filter((project) => haystack.includes(project.name.toLowerCase()));

  if (matchingProjects.length !== 1) {
    return undefined;
  }

  return matchingProjects[0].id;
}

function splitDocumentIntoChunks(content: string): Array<{ heading?: string; content: string; position: number }> {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    throw new HttpError(400, "uploaded file content is empty");
  }

  const lines = normalized.split("\n");
  const sections: Array<{ heading?: string; text: string }> = [];

  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          text: currentLines.join("\n").trim(),
        });
      }

      currentHeading = headingMatch[2].trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      text: currentLines.join("\n").trim(),
    });
  }

  const maxChunkChars = 2400;
  const chunks: Array<{ heading?: string; content: string; position: number }> = [];
  let position = 0;

  for (const section of sections) {
    if (section.text.length === 0) {
      continue;
    }

    if (section.text.length <= maxChunkChars) {
      chunks.push({
        heading: section.heading,
        content: section.text,
        position,
      });
      position += 1;
      continue;
    }

    let cursor = 0;
    while (cursor < section.text.length) {
      const slice = section.text.slice(cursor, cursor + maxChunkChars).trim();
      if (slice.length > 0) {
        chunks.push({
          heading: section.heading,
          content: slice,
          position,
        });
        position += 1;
      }
      cursor += maxChunkChars;
    }
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "uploaded file produced no extractable chunks");
  }

  return chunks;
}

function emitEvent(messageId: string, event: StreamEvent): void {
  const state = streams.get(messageId);
  if (!state) {
    return;
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

function cleanupStream(messageId: string): void {
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

function parseCreateWorkspaceRequest(body: unknown):
  | { ok: true; data: CreateWorkspaceRequest }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object" };
  }

  const payload = body as Partial<CreateWorkspaceRequest>;

  if (!payload.name || payload.name.trim().length === 0) {
    return { ok: false, error: "name is required" };
  }

  if (!payload.ownerDisplayName || payload.ownerDisplayName.trim().length === 0) {
    return { ok: false, error: "ownerDisplayName is required" };
  }

  return {
    ok: true,
    data: {
      name: payload.name.trim(),
      ownerDisplayName: payload.ownerDisplayName.trim(),
    },
  };
}

async function parseIncomingMessageRequest(
  request: Request,
): Promise<{ ok: true; data: ParsedIncomingMessage } | { ok: false; error: string }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();

    const clientMessageIdValue = formData.get("clientMessageId");
    const workspaceIdValue = formData.get("workspaceId");
    const conversationIdValue = formData.get("conversationId");
    const textValue = formData.get("text");

    if (typeof clientMessageIdValue !== "string" || clientMessageIdValue.trim().length === 0) {
      return { ok: false, error: "clientMessageId is required" };
    }

    if (typeof workspaceIdValue !== "string" || workspaceIdValue.trim().length === 0) {
      return { ok: false, error: "workspaceId is required" };
    }

    const text = typeof textValue === "string" ? textValue.trim() : "";

    const fileValue = formData.get("file");
    let attachment: IncomingAttachment | undefined;
    if (fileValue instanceof File) {
      try {
        attachment = await parseIncomingAttachment(fileValue);
      } catch (error) {
        if (error instanceof HttpError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }
    }

    if (!attachment && text.length === 0) {
      return { ok: false, error: "text is required when no file is uploaded" };
    }

    const conversationId =
      typeof conversationIdValue === "string" && conversationIdValue.trim().length > 0
        ? conversationIdValue.trim()
        : undefined;

    return {
      ok: true,
      data: {
        clientMessageId: clientMessageIdValue.trim(),
        workspaceId: workspaceIdValue.trim(),
        ...(conversationId ? { conversationId } : {}),
        text,
        ...(attachment ? { attachment } : {}),
      },
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON" };
  }

  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object" };
  }

  const payload = body as Partial<ParsedIncomingMessage>;

  if (!payload.clientMessageId || payload.clientMessageId.trim().length === 0) {
    return { ok: false, error: "clientMessageId is required" };
  }

  if (!payload.workspaceId || payload.workspaceId.trim().length === 0) {
    return { ok: false, error: "workspaceId is required" };
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
      clientMessageId: payload.clientMessageId.trim(),
      workspaceId: payload.workspaceId.trim(),
      ...(payload.conversationId ? { conversationId: payload.conversationId.trim() } : {}),
      text: payload.text.trim(),
    },
  };
}

async function parseIncomingAttachment(file: File): Promise<IncomingAttachment> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, `file is too large, max size is ${MAX_UPLOAD_BYTES} bytes`);
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !allowedUploadExtensions.has(extension)) {
    throw new HttpError(400, "only .md and .txt files are supported in phase 1");
  }

  const content = (await file.text()).trim();
  if (content.length === 0) {
    throw new HttpError(400, "uploaded file content is empty");
  }

  return {
    fileName: file.name,
    mimeType: file.type.trim().length > 0 ? file.type : "text/plain",
    sizeBytes: file.size,
    content,
  };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFuzzyNameMatch(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }

  if (a === b) {
    return true;
  }

  return a.includes(b) || b.includes(a);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return -1;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return -1;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parsePositiveInteger(value: string, envName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

function parseUnitInterval(value: string, envName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${envName} must be a number between 0 and 1`);
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
    const allowedEfforts: OpenRouterReasoningEffort[] = ["xhigh", "high", "medium", "low", "minimal", "none"];

    if (!allowedEfforts.includes(effortValue as OpenRouterReasoningEffort)) {
      throw new Error("OPENROUTER_REASONING_EFFORT must be one of xhigh, high, medium, low, minimal, none");
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

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString();
  }

  return value;
}

function userFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const causeMessage = extractCauseMessage(error);
  if (causeMessage && causeMessage !== error.message) {
    return `${error.message}: ${causeMessage}`;
  }

  return error.message;
}

function logServerError(context: string, error: unknown, meta?: Record<string, unknown>): void {
  console.error(`[${context}]`, {
    ...(meta ?? {}),
    error: serializeError(error),
  });
}

function serializeError(error: unknown, depth = 0): Record<string, unknown> | unknown {
  if (depth > 2) {
    return { message: "max depth reached" };
  }

  if (!(error instanceof Error)) {
    return error;
  }

  const candidate = error as Error & {
    cause?: unknown;
    statusCode?: unknown;
    responseBody?: unknown;
    data?: unknown;
    url?: unknown;
  };

  const serialized: Record<string, unknown> = {
    name: candidate.name,
    message: candidate.message,
    stack: candidate.stack,
  };

  if (candidate.statusCode !== undefined) {
    serialized.statusCode = candidate.statusCode;
  }
  if (candidate.url !== undefined) {
    serialized.url = candidate.url;
  }
  if (candidate.responseBody !== undefined) {
    serialized.responseBody = candidate.responseBody;
  }
  if (candidate.data !== undefined) {
    serialized.data = candidate.data;
  }
  if (candidate.cause !== undefined) {
    serialized.cause = serializeError(candidate.cause, depth + 1);
  }

  return serialized;
}

function extractCauseMessage(error: Error & { cause?: unknown }): string | undefined {
  const cause = error.cause;
  if (!cause) {
    return undefined;
  }

  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return undefined;
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
