import type { ToolExecutionOptions } from "ai";
import { RecordId } from "surrealdb";
import type { ChatToolExecutionContext } from "./types";

export function requireToolContext(options: ToolExecutionOptions): ChatToolExecutionContext {
  const context = options.experimental_context as ChatToolExecutionContext | undefined;
  if (!context) {
    throw new Error("chat tool execution context is missing");
  }

  if (!context.workspaceRecord || !context.currentMessageRecord || !context.conversationRecord) {
    throw new Error("chat tool execution context is malformed");
  }

  return context;
}

export function toDecisionRecordId(value: string): RecordId<"decision", string> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("decision id is required");
  }

  if (normalized.includes(":")) {
    const [table, id] = normalized.split(":", 2);
    if (table !== "decision" || !id) {
      throw new Error("decision id must reference a decision record");
    }
    return new RecordId("decision", id);
  }

  return new RecordId("decision", normalized);
}
