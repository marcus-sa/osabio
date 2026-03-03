import { stepCountIs, streamText, type ModelMessage } from "ai";
import { RecordId, Surreal } from "surrealdb";
import type { ExtractedEntity, ExtractedRelationship, OnboardingState } from "../../shared/contracts";
import { buildChatContext, buildSystemPrompt } from "./context";
import { createChatAgentTools } from "./tools";

type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

type CollectedEntity = ExtractedEntity;
type CollectedRelationship = ExtractedRelationship;

export type ChatAgentResult = {
  text: string;
  collectedEntities: CollectedEntity[];
  collectedRelationships: CollectedRelationship[];
};

export async function runChatAgent(input: {
  surreal: Surreal;
  model: any;
  pmAgentModel: any;
  embeddingModel: any;
  embeddingDimension: number;
  extractionModelId: string;
  extractionModel: any;
  extractionStoreThreshold: number;
  conversationRecord: RecordId<"conversation", string>;
  workspaceRecord: RecordId<"workspace", string>;
  currentMessageRecord: RecordId<"message", string>;
  latestUserText: string;
  workspaceOwnerRecord?: RecordId<"person", string>;
  inheritedEntityIds?: RecordId[];
  discussesRecord?: RecordId;
  messages: ConversationMessage[];
  isOnboarding?: boolean;
  onboardingState?: OnboardingState;
  onToken: (token: string) => Promise<void> | void;
}): Promise<ChatAgentResult> {
  const context = await buildChatContext({
    surreal: input.surreal,
    conversationRecord: input.conversationRecord,
    workspaceRecord: input.workspaceRecord,
    ...(input.inheritedEntityIds && input.inheritedEntityIds.length > 0
      ? { inheritedEntityIds: input.inheritedEntityIds }
      : {}),
    ...(input.discussesRecord ? { discussesRecord: input.discussesRecord } : {}),
  });

  const system = buildSystemPrompt(context, {
    isOnboarding: input.isOnboarding,
    onboardingState: input.onboardingState,
  });
  const modelMessages: ModelMessage[] = input.messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));

  const result = streamText({
    model: input.model,
    system,
    messages: modelMessages,
    tools: createChatAgentTools({
      surreal: input.surreal,
      pmAgentModel: input.pmAgentModel,
      embeddingModel: input.embeddingModel,
      embeddingDimension: input.embeddingDimension,
      extractionModelId: input.extractionModelId,
      extractionModel: input.extractionModel,
      extractionStoreThreshold: input.extractionStoreThreshold,
    }),
    experimental_context: {
      actor: "chat_agent",
      workspaceRecord: input.workspaceRecord,
      conversationRecord: input.conversationRecord,
      currentMessageRecord: input.currentMessageRecord,
      latestUserText: input.latestUserText,
      ...(input.workspaceOwnerRecord ? { workspaceOwnerRecord: input.workspaceOwnerRecord } : {}),
    },
    stopWhen: stepCountIs(5),
  });

  let text = "";
  const collectedEntities: CollectedEntity[] = [];
  const collectedRelationships: CollectedRelationship[] = [];

  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      text = `${text}${part.text}`;
      await input.onToken(part.text);
      continue;
    }

    if (part.type === "tool-result") {
      const toolResult = part.output as Record<string, unknown> | undefined;
      if (toolResult) {
        if (Array.isArray(toolResult.extracted_entities)) {
          collectedEntities.push(...(toolResult.extracted_entities as CollectedEntity[]));
        }
        if (Array.isArray(toolResult.extracted_relationships)) {
          collectedRelationships.push(...(toolResult.extracted_relationships as CollectedRelationship[]));
        }
      }
    }
  }

  if (text.trim().length === 0) {
    text = await result.text;
  }

  return {
    text: text.trim(),
    collectedEntities,
    collectedRelationships,
  };
}

export const runGraphAwareChat = runChatAgent;
