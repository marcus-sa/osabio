import { stepCountIs, streamText, type ModelMessage } from "ai";
import { RecordId, Surreal } from "surrealdb";
import type { ExtractedEntity, ExtractedRelationship, OnboardingState } from "../../shared/contracts";
import { logInfo, logError } from "../http/observability";
import { buildChatContext, buildSystemPrompt, type ChatContext } from "./context";
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
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
};

export async function runChatAgent(input: {
  surreal: Surreal;
  model: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  analyticsSurreal: Surreal;
  embeddingModel: any;
  embeddingDimension: number;
  extractionModelId: string;
  extractionModel: any;
  extractionStoreThreshold: number;
  conversationRecord: RecordId<"conversation", string>;
  workspaceRecord: RecordId<"workspace", string>;
  currentMessageRecord: RecordId<"message", string>;
  latestUserText: string;
  workspaceOwnerRecord?: RecordId<"identity", string>;
  identityRecord: RecordId<"identity", string>;
  userMessageEmbedding?: number[];
  inheritedEntityIds?: RecordId[];
  discussesRecord?: RecordId;
  messages: ConversationMessage[];
  isOnboarding?: boolean;
  onboardingState?: OnboardingState;
  workspaceName: string;
  workspaceDescription?: string;
  onToken: (token: string) => Promise<void> | void;
  onReasoning?: (token: string) => Promise<void> | void;
}): Promise<ChatAgentResult> {
  const context = await buildChatContext({
    surreal: input.surreal,
    conversationRecord: input.conversationRecord,
    workspaceRecord: input.workspaceRecord,
    ...(input.workspaceDescription ? { workspaceDescription: input.workspaceDescription } : {}),
    ...(input.userMessageEmbedding ? { userMessageEmbedding: input.userMessageEmbedding } : {}),
    ...(input.inheritedEntityIds && input.inheritedEntityIds.length > 0
      ? { inheritedEntityIds: input.inheritedEntityIds }
      : {}),
    ...(input.discussesRecord ? { discussesRecord: input.discussesRecord } : {}),
  });

  const system = buildSystemPrompt(context, {
    isOnboarding: input.isOnboarding,
    onboardingState: input.onboardingState,
    workspaceName: input.workspaceName,
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
      analyticsAgentModel: input.analyticsAgentModel,
      analyticsSurreal: input.analyticsSurreal,
      embeddingModel: input.embeddingModel,
      embeddingDimension: input.embeddingDimension,
      extractionModelId: input.extractionModelId,
      extractionModel: input.extractionModel,
      extractionStoreThreshold: input.extractionStoreThreshold,
    }),
    experimental_context: {
      actor: "chat_agent",
      humanPresent: true,
      workspaceRecord: input.workspaceRecord,
      conversationRecord: input.conversationRecord,
      currentMessageRecord: input.currentMessageRecord,
      latestUserText: input.latestUserText,
      ...(input.workspaceOwnerRecord ? { workspaceOwnerRecord: input.workspaceOwnerRecord } : {}),
      identityRecord: input.identityRecord,
    },
    stopWhen: stepCountIs(5),
  });

  let text = "";
  const collectedEntities: CollectedEntity[] = [];
  const collectedRelationships: CollectedRelationship[] = [];
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for await (const part of result.fullStream) {
    if (part.type === "reasoning-delta") {
      await input.onReasoning?.(part.text);
      continue;
    }

    if (part.type === "text-delta") {
      text = `${text}${part.text}`;
      await input.onToken(part.text);
      continue;
    }

    if (part.type === "tool-call") {
      logInfo("chat.agent.tool_call", "Chat agent invoked tool", part);
      toolCalls.push({ name: part.toolName, args: (part as any).input as Record<string, unknown> });
    }

    if (part.type === "tool-result") {
      logInfo("chat.agent.tool_result", "Chat agent tool returned", part);
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

    if (part.type === "error") {
      logError("chat.agent.stream_error", "Chat agent stream error", part.error, {});
    }
  }

  if (text.trim().length === 0) {
    text = await result.text;
  }

  // Post-process: inject entity:// links for entity names mentioned in the response.
  const linked = injectEntityLinks(text, context);
  if (linked !== text) {
    // Re-send the full linked text as a replacement.
    // The SSE stream already sent raw text; the persisted version will have links.
    text = linked;
  }

  return {
    text: text.trim(),
    collectedEntities,
    collectedRelationships,
    toolCalls,
  };
}

export const runGraphAwareChat = runChatAgent;

type KnownEntity = { entityId: string; kind: string; name: string };

/**
 * Replace entity name mentions in response text with markdown links:
 *   "Model for Extraction Pipeline" → "[Model for Extraction Pipeline](entity://decision:uuid)"
 *
 * Matches longest names first to avoid partial replacement.
 * Only replaces the first occurrence of each entity name.
 */
function injectEntityLinks(text: string, context: ChatContext): string {
  const entities: KnownEntity[] = [];

  for (const project of context.workspaceSummary.projects) {
    entities.push({ entityId: `project:${project.id}`, kind: "project", name: project.name });
  }
  for (const decision of context.workspaceSummary.recentDecisions) {
    entities.push({ entityId: `decision:${decision.id}`, kind: "decision", name: decision.name });
  }
  for (const question of context.workspaceSummary.openQuestions) {
    entities.push({ entityId: `question:${question.id}`, kind: "question", name: question.name });
  }

  // Sort longest name first so "Agent-Native Business OS" matches before "Agent"
  entities.sort((a, b) => b.name.length - a.name.length);

  const replaced = new Set<string>();
  let result = text;

  for (const entity of entities) {
    if (entity.name.length < 3) continue;
    if (replaced.has(entity.entityId)) continue;

    // Case-insensitive match, but only replace the first occurrence.
    // Skip if the name is already inside a markdown link.
    const idx = result.toLowerCase().indexOf(entity.name.toLowerCase());
    if (idx === -1) continue;

    // Check if already inside a markdown link: [...](...)
    const before = result.slice(0, idx);
    if (before.lastIndexOf("[") > before.lastIndexOf("]")) continue;

    const matched = result.slice(idx, idx + entity.name.length);
    const link = `[${matched}](#entity/${entity.entityId})`;
    result = `${result.slice(0, idx)}${link}${result.slice(idx + entity.name.length)}`;
    replaced.add(entity.entityId);
  }

  return result;
}
