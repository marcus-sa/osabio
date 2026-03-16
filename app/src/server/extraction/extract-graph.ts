import { generateObject } from "ai";
import {
  extractionResultSchema,
  type ExtractionPromptOutput,
} from "./schema";
import { buildExtractionSystemPrompt } from "./prompt";
import type { ExtractionGraphContextRow, MessageContextRow } from "./types";
import { elapsedMs, logError, logInfo } from "../http/observability";
import { createTelemetryConfig, recordLlmMetrics, recordLlmError } from "../telemetry/ai-telemetry";
import { FUNCTION_IDS } from "../telemetry/function-ids";

export async function extractStructuredGraph(input: {
  extractionModel: any;
  conversationHistory: MessageContextRow[];
  currentMessage?: MessageContextRow;
  graphContext: ExtractionGraphContextRow[];
  sourceText: string;
  onboarding: boolean;
  heading?: string;
  workspaceName?: string;
  projectNames?: string[];
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
      temperature: 0.1,
      experimental_telemetry: createTelemetryConfig(FUNCTION_IDS.EXTRACTION),
      system: buildExtractionSystemPrompt({ onboarding: input.onboarding }),
      prompt: [
        "Conversation history (reference resolution only):",
        formatExtractionConversationHistory(input.conversationHistory),
        "",
        "Current message (extract only from this text when message metadata exists):",
        formatExtractionCurrentMessage(input.currentMessage, input.sourceText),
        "",
        "Resolved-from lineage constraints:",
        formatResolvedFromConstraints(input.currentMessage, input.conversationHistory),
        "",
        "Existing graph context (semantic index of prior extracted entities):",
        formatExtractionGraphContext(input.graphContext),
        "",
        "Workspace scope:",
        formatWorkspaceScope(input.workspaceName, input.projectNames),
        input.heading ? `Section heading: ${input.heading}` : "",
        "",
        "Current source text:",
        input.sourceText,
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    });

    const output = extractionOutput.object as ExtractionPromptOutput;
    const durationMs = elapsedMs(startedAt);
    recordLlmMetrics(FUNCTION_IDS.EXTRACTION, extractionOutput.usage, durationMs);
    logInfo("extraction.generate.completed", "Structured extraction completed", {
      onboarding: input.onboarding,
      entityCount: output.entities.length,
      relationshipCount: output.relationships.length,
      toolCount: output.tools.length,
      durationMs,
    });

    return output;
  } catch (error) {
    recordLlmError(FUNCTION_IDS.EXTRACTION, error instanceof Error ? error.constructor.name : "unknown");
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
      const table = row.id.table.name;
      return `[entity:${table}:${row.id.id as string}] ${row.kind}: ${row.text} (confidence ${row.confidence.toFixed(2)}, source message ${row.sourceMessage.id as string})`;
    })
    .join("\n");
}

function formatWorkspaceScope(workspaceName?: string, projectNames?: string[]): string {
  if (!workspaceName) {
    return "(no workspace context)";
  }

  const lines = [`Workspace: "${workspaceName}"`];
  if (projectNames && projectNames.length > 0) {
    lines.push(`Existing projects: ${projectNames.map((name) => `"${name}"`).join(", ")}`);
  } else {
    lines.push("Existing projects: none");
  }

  return lines.join("\n");
}

function formatResolvedFromConstraints(
  currentMessage: MessageContextRow | undefined,
  conversationHistory: MessageContextRow[],
): string {
  if (!currentMessage) {
    return "Current message id unavailable; omit resolvedFromMessageId.";
  }

  const currentMessageId = currentMessage.id.id as string;
  if (conversationHistory.length === 0) {
    return [
      `Current message id (forbidden for resolvedFromMessageId): ${currentMessageId}`,
      "Allowed resolvedFromMessageId values (history only): none",
      "Omit resolvedFromMessageId.",
    ].join("\n");
  }

  const historyMessageIds = conversationHistory.map((row) => row.id.id as string);
  return [
    `Current message id (forbidden for resolvedFromMessageId): ${currentMessageId}`,
    `Allowed resolvedFromMessageId values (history only): ${historyMessageIds.join(", ")}`,
    "Use one of the allowed ids exactly, or omit resolvedFromMessageId.",
  ].join("\n");
}
