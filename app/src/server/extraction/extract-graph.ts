import { generateObject } from "ai";
import {
  extractionResultSchema,
  type ExtractionPromptOutput,
} from "./schema";
import { buildExtractionSystemPrompt } from "./prompt";
import type { ExtractionGraphContextRow, MessageContextRow } from "./types";
import { elapsedMs, logError, logInfo } from "../http/observability";

export async function extractStructuredGraph(input: {
  extractionModel: any;
  conversationHistory: MessageContextRow[];
  currentMessage?: MessageContextRow;
  graphContext: ExtractionGraphContextRow[];
  sourceText: string;
  onboarding: boolean;
  heading?: string;
}): Promise<ExtractionPromptOutput> {
  const startedAt = performance.now();
  logInfo("extraction.generate.started", "Structured extraction started", {
    onboarding: input.onboarding,
    hasHeading: input.heading !== undefined,
    contextMessageCount: input.conversationHistory.length,
    hasCurrentMessage: input.currentMessage !== undefined,
    graphContextCount: input.graphContext.length,
    sourceLength: input.sourceText.length,
  });

  try {
    const extractionOutput = await generateObject({
      model: input.extractionModel,
      schema: extractionResultSchema,
      system: buildExtractionSystemPrompt({ onboarding: input.onboarding }),
      prompt: [
        "Conversation history (reference resolution only):",
        formatExtractionConversationHistory(input.conversationHistory),
        "",
        "Current message (extract only from this text when message metadata exists):",
        formatExtractionCurrentMessage(input.currentMessage, input.sourceText),
        "",
        "Existing graph context (semantic index of prior extracted entities):",
        formatExtractionGraphContext(input.graphContext),
        input.heading ? `Section heading: ${input.heading}` : "",
        "",
        "Current source text:",
        input.sourceText,
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    });

    const output = extractionOutput.object as ExtractionPromptOutput;
    logInfo("extraction.generate.completed", "Structured extraction completed", {
      onboarding: input.onboarding,
      entityCount: output.entities.length,
      relationshipCount: output.relationships.length,
      toolCount: output.tools.length,
      durationMs: elapsedMs(startedAt),
    });

    return output;
  } catch (error) {
    logError("extraction.generate.failed", "Structured extraction failed", error, {
      onboarding: input.onboarding,
      durationMs: elapsedMs(startedAt),
    });
    throw error;
  }
}

function formatExtractionConversationHistory(rows: MessageContextRow[]): string {
  if (rows.length === 0) {
    return "(no prior messages)";
  }

  return rows.map((row) => `[message:${row.id.id as string}] ${row.role.toUpperCase()}: ${row.text}`).join("\n");
}

function formatExtractionCurrentMessage(currentMessage: MessageContextRow | undefined, sourceText: string): string {
  if (!currentMessage) {
    return `(no message metadata; source text: ${sourceText})`;
  }

  return `[message:${currentMessage.id.id as string}] ${currentMessage.role.toUpperCase()}: ${currentMessage.text}`;
}

function formatExtractionGraphContext(rows: ExtractionGraphContextRow[]): string {
  if (rows.length === 0) {
    return "(no prior extracted entities)";
  }

  return rows
    .map((row) => {
      const table = row.id.tb;
      return `[entity:${table}:${row.id.id as string}] ${row.kind}: ${row.text} (confidence ${row.confidence.toFixed(2)}, source message ${row.sourceMessage.id as string})`;
    })
    .join("\n");
}
