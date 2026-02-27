import { RecordId } from "surrealdb";
import type { ExtractedEntity, ExtractedRelationship, OnboardingAction, OnboardingSeedItem } from "../../shared/contracts";
import { buildExtractionComponentBlock } from "../extraction/components";
import { loadAssistantConversationContext, loadConversationGraphContext, loadExtractionConversationContext } from "../extraction/context-loaders";
import { ingestAttachment } from "../extraction/document-ingestion";
import { persistEmbeddings } from "../extraction/embedding-writeback";
import { extractStructuredGraph } from "../extraction/extract-graph";
import { appendExtractedTools, persistExtractionOutput } from "../extraction/persist-extraction";
import type { ConversationRow, GraphEntityRecord, IncomingAttachment, SourceRecord, WorkspaceRow } from "../extraction/types";
import { elapsedMs, logError, logInfo, userFacingError } from "../http/observability";
import { transitionOnboardingState } from "../onboarding/onboarding-state";
import { generateOnboardingAssistantReply } from "../onboarding/onboarding-reply";
import type { ServerDependencies } from "../runtime/types";
import { runGraphAwareChat } from "./handler";
import { getWorkspaceOwnerRecord } from "../graph/queries";
import { refreshConversationTouchedBy, maybeUpgradeConversationTitle } from "../workspace/conversation-sidebar";

export async function processChatMessage(input: {
  deps: ServerDependencies;
  conversationId: string;
  messageId: string;
  workspaceRecord: RecordId<"workspace", string>;
  userMessageRecord: RecordId<"message", string>;
  userText: string;
  attachment?: IncomingAttachment;
  onboardingAction?: OnboardingAction;
}): Promise<void> {
  const startedAt = performance.now();
  logInfo("chat.message.process.execution.started", "Chat message processing execution started", {
    conversationId: input.conversationId,
    messageId: input.messageId,
    workspaceId: input.workspaceRecord.id as string,
    hasAttachment: input.attachment !== undefined,
  });

  try {
    const now = new Date();
    const conversationRecord = new RecordId("conversation", input.conversationId);
    const workspace = await input.deps.surreal.select<WorkspaceRow>(input.workspaceRecord);
    if (!workspace) {
      throw new Error("workspace not found");
    }

    const conversation = await input.deps.surreal.select<ConversationRow>(conversationRecord);
    if (!conversation) {
      throw new Error("conversation not found");
    }

    const assistantContextRows = await loadAssistantConversationContext(input.deps.surreal, input.conversationId);
    const extractionConversationContext = await loadExtractionConversationContext({
      surreal: input.deps.surreal,
      conversationId: input.conversationId,
      currentMessageRecord: input.userMessageRecord,
    });
    const extractionGraphContext = await loadConversationGraphContext(input.deps.surreal, input.conversationId, 60);
    const persistedEntities: ExtractedEntity[] = [];
    const persistedRelationships: ExtractedRelationship[] = [];
    const seedItems: OnboardingSeedItem[] = [];
    const embeddingTargets: Array<{ record: GraphEntityRecord; text: string }> = [];
    const extractedTools: string[] = [];
    const unresolvedAssigneeNames = new Set<string>();

    if (input.attachment) {
      const ingestion = await ingestAttachment({
        surreal: input.deps.surreal,
        extractionModel: input.deps.extractionModel,
        embeddingModel: input.deps.embeddingModel,
        embeddingDimension: input.deps.config.embeddingDimension,
        extractionStoreThreshold: input.deps.config.extractionStoreThreshold,
        extractionModelId: input.deps.config.extractionModelId,
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
      for (const unresolvedName of ingestion.unresolvedAssigneeNames) {
        unresolvedAssigneeNames.add(unresolvedName);
      }
    }

    const textExtraction = await extractStructuredGraph({
      extractionModel: input.deps.extractionModel,
      conversationHistory: extractionConversationContext.conversationHistory,
      currentMessage: extractionConversationContext.currentMessage,
      graphContext: extractionGraphContext,
      sourceText: input.userText,
      onboarding: !workspace.onboarding_complete,
    });

    const textPersistence = await persistExtractionOutput({
      surreal: input.deps.surreal,
      embeddingModel: input.deps.embeddingModel,
      embeddingDimension: input.deps.config.embeddingDimension,
      extractionModelId: input.deps.config.extractionModelId,
      extractionStoreThreshold: input.deps.config.extractionStoreThreshold,
      workspaceRecord: input.workspaceRecord,
      sourceRecord: input.userMessageRecord as SourceRecord,
      sourceKind: "message",
      sourceLabel: input.userText.slice(0, 140),
      promptText: input.userText,
      output: textExtraction,
      sourceMessageRecord: input.userMessageRecord,
      extractionHistoryMessageIds: extractionConversationContext.conversationHistory.map((row) => row.id.id as string),
      now,
    });

    persistedEntities.push(...textPersistence.entities);
    persistedRelationships.push(...textPersistence.relationships);
    seedItems.push(...textPersistence.seeds);
    embeddingTargets.push(...textPersistence.embeddingTargets);
    extractedTools.push(...textPersistence.tools);
    for (const unresolvedName of textPersistence.unresolvedAssigneeNames) {
      unresolvedAssigneeNames.add(unresolvedName);
    }

    const dedupedTools = [...new Set(extractedTools.map((tool) => tool.trim()).filter((tool) => tool.length > 0))];
    await appendExtractedTools(input.deps.surreal, input.workspaceRecord, extractedTools, now);

    await refreshConversationTouchedBy(input.deps.surreal, conversationRecord);
    await maybeUpgradeConversationTitle(input.deps.surreal, conversationRecord);

    const onboardingBefore = workspace.onboarding_complete
      ? "complete"
      : workspace.onboarding_summary_pending
        ? "summary_pending"
        : "active";

    const onboardingAfter = await transitionOnboardingState({
      surreal: input.deps.surreal,
      workspaceRecord: input.workspaceRecord,
      workspace,
      onboardingAction: input.onboardingAction,
      now,
    });

    let assistantText = "";
    let assistantSuggestions: string[] = [];
    const unresolvedAssigneeSuggestions = [...unresolvedAssigneeNames].map(
      (name) => `You mentioned ${name} - want to add them to workspace people?`,
    );

    if (onboardingAfter === "complete") {
      const workspaceOwnerRecord = await getWorkspaceOwnerRecord({
        surreal: input.deps.surreal,
        workspaceRecord: input.workspaceRecord,
      });

      const graphAwareResponse = await runGraphAwareChat({
        surreal: input.deps.surreal,
        model: input.deps.assistantModel,
        embeddingModel: input.deps.embeddingModel,
        embeddingDimension: input.deps.config.embeddingDimension,
        extractionModelId: input.deps.config.extractionModelId,
        conversationRecord,
        workspaceRecord: input.workspaceRecord,
        currentMessageRecord: input.userMessageRecord,
        latestUserText: input.userText,
        ...(workspaceOwnerRecord ? { workspaceOwnerRecord } : {}),
        messages: assistantContextRows.map((row) => ({
          role: row.role,
          text: row.text,
        })),
        onToken: async (token) => {
          input.deps.sse.emitEvent(input.messageId, {
            type: "token",
            messageId: input.messageId,
            token,
          });
        },
      });

      assistantText = graphAwareResponse.text.trim();
    } else {
      const assistantReply = await generateOnboardingAssistantReply({
        assistantModel: input.deps.assistantModel,
        surreal: input.deps.surreal,
        onboardingState: onboardingAfter,
        contextRows: assistantContextRows,
        latestUserText: input.userText,
        workspaceRecord: input.workspaceRecord,
        latestEntities: persistedEntities.map((entity) => ({
          kind: entity.kind,
          text: entity.text,
          confidence: entity.confidence,
        })),
        latestTools: dedupedTools,
      });

      assistantText = assistantReply.message.trim();
      assistantSuggestions = assistantReply.suggestions;

      for (const token of assistantText.split(" ")) {
        input.deps.sse.emitEvent(input.messageId, {
          type: "token",
          messageId: input.messageId,
          token: `${token} `,
        });
        await Bun.sleep(25);
      }
    }

    assistantSuggestions = sanitizeAssistantSuggestions(
      [...assistantSuggestions, ...unresolvedAssigneeSuggestions],
      3,
    );

    const summaryBlock = buildExtractionComponentBlock(
      persistedEntities,
      persistedRelationships,
      input.deps.config.extractionDisplayThreshold,
    );

    if (summaryBlock) {
      if (onboardingAfter === "complete") {
        const streamChunk = assistantText.length > 0 ? `\n\n${summaryBlock}` : summaryBlock;
        for (const token of streamChunk.split(" ")) {
          input.deps.sse.emitEvent(input.messageId, {
            type: "token",
            messageId: input.messageId,
            token: `${token} `,
          });
        }
      }

      assistantText = assistantText.length > 0 ? `${assistantText}\n\n${summaryBlock}` : summaryBlock;
    }

    if (assistantText.trim().length === 0) {
      assistantText = "I could not generate a response for that request.";
    }

    const assistantMessageRecord = new RecordId("message", input.messageId);
    await input.deps.surreal.create(assistantMessageRecord).content({
      conversation: conversationRecord,
      role: "assistant",
      text: assistantText,
      ...(assistantSuggestions.length > 0 ? { suggestions: assistantSuggestions } : {}),
      createdAt: now,
    });

    await input.deps.surreal.update(conversationRecord).merge({
      updatedAt: now,
    });

    void persistEmbeddings({
      surreal: input.deps.surreal,
      embeddingModel: input.deps.embeddingModel,
      embeddingDimension: input.deps.config.embeddingDimension,
      assistantMessageRecord,
      assistantText,
      entities: embeddingTargets,
    }).catch(() => undefined);

    input.deps.sse.emitEvent(input.messageId, {
      type: "extraction",
      messageId: input.messageId,
      entities: persistedEntities,
      relationships: persistedRelationships,
    });

    if (seedItems.length > 0) {
      input.deps.sse.emitEvent(input.messageId, {
        type: "onboarding_seed",
        messageId: input.messageId,
        seeds: seedItems,
      });
    }

    if (onboardingBefore !== onboardingAfter) {
      input.deps.sse.emitEvent(input.messageId, {
        type: "onboarding_state",
        messageId: input.messageId,
        onboardingState: onboardingAfter,
      });
    }

    input.deps.sse.emitEvent(input.messageId, {
      type: "assistant_message",
      messageId: input.messageId,
      text: assistantText,
      ...(assistantSuggestions.length > 0 ? { suggestions: assistantSuggestions } : {}),
    });

    input.deps.sse.emitEvent(input.messageId, {
      type: "done",
      messageId: input.messageId,
    });

    logInfo("chat.message.process.execution.completed", "Chat message processing execution completed", {
      conversationId: input.conversationId,
      messageId: input.messageId,
      workspaceId: input.workspaceRecord.id as string,
      entityCount: persistedEntities.length,
      relationshipCount: persistedRelationships.length,
      seedCount: seedItems.length,
      durationMs: elapsedMs(startedAt),
    });
  } catch (error) {
    logError("chat.message.process.execution.failed", "Chat message processing execution failed", error, {
      conversationId: input.conversationId,
      messageId: input.messageId,
      workspaceId: input.workspaceRecord.id as string,
      durationMs: elapsedMs(startedAt),
    });
    const errorText = userFacingError(error, "chat processing failed");
    input.deps.sse.emitEvent(input.messageId, {
      type: "error",
      messageId: input.messageId,
      error: errorText,
    });
  }
}

function sanitizeAssistantSuggestions(suggestions: string[], limit: number): string[] {
  return [...new Set(suggestions.map((value) => value.trim()))]
    .filter((value) => value.length > 0 && value.length <= 140)
    .slice(0, limit);
}
