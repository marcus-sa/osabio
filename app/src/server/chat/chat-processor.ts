import { RecordId } from "surrealdb";
import type { ExtractedEntity, ExtractedRelationship, OnboardingAction } from "../../shared/contracts";
import { loadAssistantConversationContext } from "../extraction/context-loaders";
import { loadBranchChain, loadMessagesWithInheritance } from "./branch-chain";
import { ingestAttachment } from "../extraction/document-ingestion";
import { createEmbedding, persistEmbeddings } from "../extraction/embedding-writeback";
import { appendExtractedTools } from "../extraction/persist-extraction";
import type { ConversationRow, GraphEntityRecord, IncomingAttachment, WorkspaceRow } from "../extraction/types";
import { elapsedMs, logError, logInfo, userFacingError } from "../http/observability";
import { transitionOnboardingState } from "../onboarding/onboarding-state";
import type { ServerDependencies } from "../runtime/types";
import { runChatAgent } from "./handler";
import { getWorkspaceOwnerRecord } from "../graph/queries";
import { refreshConversationTouchedBy, maybeUpgradeConversationTitle } from "../workspace/conversation-sidebar";
import { loadWorkspaceProjects } from "../workspace/workspace-scope";

export async function processChatMessage(input: {
  deps: ServerDependencies;
  conversationId: string;
  messageId: string;
  workspaceRecord: RecordId<"workspace", string>;
  userMessageRecord: RecordId<"message", string>;
  userText: string;
  attachment?: IncomingAttachment;
  onboardingAction?: OnboardingAction;
  identityRecord: RecordId<"identity", string>;
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

    // Check if this conversation is a branch and load inherited context
    const branchChain = await loadBranchChain(input.deps.surreal, input.conversationId);
    const isBranch = branchChain.length > 0;

    let inheritedEntityIds: RecordId[] | undefined;
    let assistantContextRows: Array<{ id: RecordId<"message", string>; role: "user" | "assistant"; text: string; createdAt: Date | string }>;

    if (isBranch) {
      // For branches, load full message history including inherited messages
      const allMessages = await loadMessagesWithInheritance(input.deps.surreal, input.conversationId, 30);
      assistantContextRows = allMessages
        .map((m) => ({
          id: new RecordId("message", m.id),
          role: m.role,
          text: m.text,
          createdAt: m.createdAt,
        }))
        .slice(-10);

      // Derive inherited entity IDs from extraction_relations on inherited messages
      const inheritedMsgIds = allMessages
        .filter((m) => m.inherited)
        .map((m) => new RecordId("message", m.id));

      if (inheritedMsgIds.length > 0) {
        const [entityRows] = await input.deps.surreal
          .query<[Array<{ out: RecordId }>]>(
            "SELECT DISTINCT out FROM extraction_relation WHERE `in` IN $msgIds LIMIT 30;",
            { msgIds: inheritedMsgIds },
          )
          .collect<[Array<{ out: RecordId }>]>();
        inheritedEntityIds = entityRows.map((r) => r.out);
      }
    } else {
      assistantContextRows = await loadAssistantConversationContext(input.deps.surreal, input.conversationId);
    }

    // Embed user message early: used for context enrichment and persisted to the message record
    const userMessageEmbedding = await createEmbedding(input.deps.embeddingModel, input.deps.config.embeddingDimension, input.userText);
    if (userMessageEmbedding) {
      void input.deps.surreal
        .query("UPDATE $record MERGE { embedding: $embedding };", {
          record: input.userMessageRecord,
          embedding: userMessageEmbedding,
        })
        .catch(() => undefined);
    }

    const workspaceProjects = await loadWorkspaceProjects(input.deps.surreal, input.workspaceRecord);
    const workspaceProjectNames = workspaceProjects.map((project) => project.name);
    const persistedEntities: ExtractedEntity[] = [];
    const persistedRelationships: ExtractedRelationship[] = [];
    const embeddingTargets: Array<{ record: GraphEntityRecord; text: string }> = [];
    const extractedTools: string[] = [];
    const unresolvedAssigneeNames = new Set<string>();

    // Attachment extraction stays automatic — document ingestion is intentional
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
        workspaceName: workspace.name,
        projectNames: workspaceProjectNames,
        now,
        onChunkResult: (chunkResult) => {
          if (chunkResult.entities.length > 0 || chunkResult.relationships.length > 0) {
            input.deps.sse.emitEvent(input.messageId, {
              type: "extraction",
              messageId: input.messageId,
              entities: chunkResult.entities,
              relationships: chunkResult.relationships,
            });
          }
        },
      });

      persistedEntities.push(...ingestion.entities);
      persistedRelationships.push(...ingestion.relationships);
      embeddingTargets.push(...ingestion.embeddingTargets);
      extractedTools.push(...ingestion.tools);
      for (const unresolvedName of ingestion.unresolvedAssigneeNames) {
        unresolvedAssigneeNames.add(unresolvedName);
      }
    }

    if (extractedTools.length > 0) {
      await appendExtractedTools(input.deps.surreal, input.workspaceRecord, extractedTools, now);
    }

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

    // Always run chat agent — it handles both onboarding and post-onboarding
    const workspaceOwnerRecord = await getWorkspaceOwnerRecord({
      surreal: input.deps.surreal,
      workspaceRecord: input.workspaceRecord,
    });

    const graphAwareResponse = await runChatAgent({
      surreal: input.deps.surreal,
      model: input.deps.chatAgentModel,
      pmAgentModel: input.deps.pmAgentModel,
      analyticsAgentModel: input.deps.analyticsAgentModel,
      analyticsSurreal: input.deps.analyticsSurreal,
      embeddingModel: input.deps.embeddingModel,
      embeddingDimension: input.deps.config.embeddingDimension,
      extractionModelId: input.deps.config.extractionModelId,
      extractionModel: input.deps.extractionModel,
      extractionStoreThreshold: input.deps.config.extractionStoreThreshold,
      conversationRecord,
      workspaceRecord: input.workspaceRecord,
      currentMessageRecord: input.userMessageRecord,
      latestUserText: input.userText,
      isOnboarding: onboardingAfter !== "complete",
      onboardingState: onboardingAfter,
      workspaceName: workspace.name,
      ...(workspace.description ? { workspaceDescription: workspace.description } : {}),
      ...(workspaceOwnerRecord ? { workspaceOwnerRecord } : {}),
      identityRecord: input.identityRecord,
      ...(userMessageEmbedding ? { userMessageEmbedding } : {}),
      ...(inheritedEntityIds && inheritedEntityIds.length > 0 ? { inheritedEntityIds } : {}),
      ...(conversation.discusses ? { discussesRecord: conversation.discusses } : {}),
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
      onReasoning: async (token) => {
        input.deps.sse.emitEvent(input.messageId, {
          type: "reasoning",
          messageId: input.messageId,
          token,
        });
      },
    });

    let assistantText = graphAwareResponse.text.trim();
    persistedEntities.push(...graphAwareResponse.collectedEntities);
    persistedRelationships.push(...graphAwareResponse.collectedRelationships);

    const unresolvedAssigneeSuggestions = [...unresolvedAssigneeNames].map(
      (name) => `You mentioned ${name} - want to add them to workspace people?`,
    );
    const assistantSuggestions = sanitizeAssistantSuggestions(unresolvedAssigneeSuggestions, 3);

    // Post-response hooks (entities now created during chat agent execution)
    await refreshConversationTouchedBy(input.deps.surreal, conversationRecord);
    await maybeUpgradeConversationTitle(input.deps.surreal, conversationRecord);

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
