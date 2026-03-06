import { tool } from "ai";
import { z } from "zod";
import { RecordId } from "surrealdb";
import { requireAuthorizedContext } from "../../iam/authority";
import type { ChatToolDeps } from "./types";

export function createUpdateQuestionTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Update a question entity's status — mark it as answered when the user provides an answer, or deferred when they postpone it.",
    inputSchema: z.object({
      question_id: z.string().min(1).describe("Question ID in format question:uuid or raw uuid"),
      status: z.enum(["answered", "deferred"]).describe("answered: user provided an answer. deferred: user postponed the question."),
      answer_summary: z.string().optional().describe("Summary of the answer when marking as answered"),
    }),
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "update_question", deps);
      const now = new Date();

      const normalized = input.question_id.trim();
      const rawId = normalized.includes(":")
        ? normalized.split(":", 2)[1]!
        : normalized;
      const questionRecord = new RecordId("question", rawId);

      const existing = await deps.surreal.select<{ status: string; workspace: RecordId }>(questionRecord);
      if (!existing) {
        throw new Error(`question ${input.question_id} not found`);
      }

      const updateFields: Record<string, unknown> = {
        status: input.status,
        updated_at: now,
      };

      if (input.status === "answered") {
        updateFields.answered_at = now;
        updateFields.answered_by_message = context.currentMessageRecord;
        if (input.answer_summary) {
          updateFields.answer_summary = input.answer_summary;
        }
      }

      await deps.surreal.query("UPDATE $question MERGE $fields;", {
        question: questionRecord,
        fields: updateFields,
      });

      return {
        question_id: `question:${rawId}`,
        status: input.status,
      };
    },
  });
}
