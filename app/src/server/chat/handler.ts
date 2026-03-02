import { stepCountIs, streamText, type ModelMessage } from "ai";
import { RecordId, Surreal } from "surrealdb";
import { buildChatContext, buildSystemPrompt } from "./context";
import { createOrchestratorTools } from "./tools";

type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

export async function runOrchestrator(input: {
  surreal: Surreal;
  model: any;
  pmModel: any;
  embeddingModel: any;
  embeddingDimension: number;
  extractionModelId: string;
  conversationRecord: RecordId<"conversation", string>;
  workspaceRecord: RecordId<"workspace", string>;
  currentMessageRecord: RecordId<"message", string>;
  latestUserText: string;
  workspaceOwnerRecord?: RecordId<"person", string>;
  inheritedEntityIds?: RecordId[];
  messages: ConversationMessage[];
  onToken: (token: string) => Promise<void> | void;
}): Promise<{ text: string }> {
  const context = await buildChatContext({
    surreal: input.surreal,
    conversationRecord: input.conversationRecord,
    workspaceRecord: input.workspaceRecord,
    ...(input.inheritedEntityIds && input.inheritedEntityIds.length > 0
      ? { inheritedEntityIds: input.inheritedEntityIds }
      : {}),
  });

  const system = buildSystemPrompt(context);
  const modelMessages: ModelMessage[] = input.messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));

  const result = streamText({
    model: input.model,
    system,
    messages: modelMessages,
    tools: createOrchestratorTools({
      surreal: input.surreal,
      pmModel: input.pmModel,
      embeddingModel: input.embeddingModel,
      embeddingDimension: input.embeddingDimension,
      extractionModelId: input.extractionModelId,
    }),
    experimental_context: {
      actor: "orchestrator",
      workspaceRecord: input.workspaceRecord,
      conversationRecord: input.conversationRecord,
      currentMessageRecord: input.currentMessageRecord,
      latestUserText: input.latestUserText,
      ...(input.workspaceOwnerRecord ? { workspaceOwnerRecord: input.workspaceOwnerRecord } : {}),
    },
    stopWhen: stepCountIs(5),
  });

  let text = "";
  for await (const part of result.fullStream) {
    if (part.type !== "text-delta") {
      continue;
    }

    text = `${text}${part.text}`;
    await input.onToken(part.text);
  }

  if (text.trim().length === 0) {
    text = await result.text;
  }

  return {
    text: text.trim(),
  };
}

export const runGraphAwareChat = runOrchestrator;
