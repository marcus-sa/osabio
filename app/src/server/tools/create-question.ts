import { tool } from "ai";
import { z } from "zod";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES } from "../../shared/contracts";
import {
  createExtractionProvenanceEdge,
  createQuestionRecord,
  resolveWorkspaceFeatureRecord,
  resolveWorkspaceProjectRecord,
} from "../graph/queries";
import { requireAuthorizedContext } from "../iam/authority";
import type { ChatToolDeps } from "./types";

export function createCreateQuestionTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Create a question entity for open questions that require a choice or pending decision — e.g. \"should we use X or Y?\", \"which approach for Z?\". Do NOT use for informational queries like \"what is blocking X?\" or \"how does Y work?\" — answer those directly or use other tools.",
    inputSchema: z.object({
      text: z.string().min(1).describe("The question text"),
      category: z.enum(ENTITY_CATEGORIES).optional().describe("Question category"),
      priority: z.enum(ENTITY_PRIORITIES).optional().describe("critical: blocking/urgent. high: important, needs attention soon. medium: normal priority. low: nice-to-have, deferred."),
      context: z
        .object({
          project: z.string().optional(),
          feature: z.string().optional(),
        })
        .optional(),
      assigned_to: z.string().optional().describe("Person name to assign the question to"),
    }),
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_question", deps);
      const now = new Date();

      const projectRecord = input.context?.project
        ? await resolveWorkspaceProjectRecord({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
            projectInput: input.context.project,
          })
        : undefined;

      const featureRecord = input.context?.feature
        ? await resolveWorkspaceFeatureRecord({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
            featureInput: input.context.feature,
          })
        : undefined;

      const questionRecord = await createQuestionRecord({
        surreal: deps.surreal,
        text: input.text,
        status: "open",
        now,
        workspaceRecord: context.workspaceRecord,
        sourceMessageRecord: context.currentMessageRecord,
        ...(input.category ? { category: input.category } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assigned_to ? { assignedToName: input.assigned_to } : {}),
        ...(projectRecord ? { projectRecord } : {}),
        ...(featureRecord ? { featureRecord } : {}),
      });

      await createExtractionProvenanceEdge({
        surreal: deps.surreal,
        sourceRecord: context.currentMessageRecord,
        targetRecord: questionRecord,
        now,
        confidence: 0.9,
        model: deps.extractionModelId,
        fromText: input.text,
        evidence: context.latestUserText,
        evidenceSourceRecord: context.currentMessageRecord,
      });

      return {
        question_id: `question:${questionRecord.id as string}`,
        status: "open",
      };
    },
  });
}
