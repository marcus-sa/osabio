import type { SourceKind } from "../../shared/contracts";
import { log } from "../telemetry/logger";

export function resolveValidatedResolvedFromMessageId(input: {
  resolvedFromMessageId?: string;
  sourceKind: SourceKind;
  sourceMessageId?: string;
  extractionHistoryMessageIds: Set<string>;
}): string | undefined {
  const resolvedFromMessageId = input.resolvedFromMessageId?.trim();
  if (!resolvedFromMessageId) {
    return undefined;
  }

  if (input.sourceKind !== "message") {
    throw new Error("resolvedFromMessageId is only valid for message extraction sources");
  }

  if (!input.sourceMessageId || input.sourceMessageId.trim().length === 0) {
    throw new Error("resolvedFromMessageId requires sourceMessageId");
  }

  if (resolvedFromMessageId === input.sourceMessageId) {
    log.warn("extraction.provenance.self_reference", "LLM returned resolvedFromMessageId matching current source message; discarding", {
      resolvedFromMessageId,
      sourceMessageId: input.sourceMessageId,
    });
    return undefined;
  }

  if (!input.extractionHistoryMessageIds.has(resolvedFromMessageId)) {
    log.warn("extraction.provenance.unknown_message", "LLM returned resolvedFromMessageId not in conversation history; discarding", {
      resolvedFromMessageId,
    });
    return undefined;
  }

  return resolvedFromMessageId;
}
