import { tool } from "ai";
import { RecordId } from "surrealdb";
import { z } from "zod";
import { ENTITY_CATEGORIES } from "../../../shared/contracts";
import { createEmbeddingVector } from "../../graph/embeddings";
import { isEntityInWorkspace, parseRecordIdString } from "../../graph/queries";
import { createObservation } from "../../observation/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createCreateObservationTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Create an observation in the workspace graph. Use proactively when you notice cross-cutting concerns — risks, conflicts, gaps, or notable facts — even if the user didn't ask.",
    inputSchema: z.object({
      text: z.string().min(1).describe("Observation text"),
      severity: z
        .enum(["info", "warning", "conflict"])
        .describe(
          "info: awareness-level signals. warning: risks to address soon. conflict: contradictions needing human resolution.",
        ),
      category: z.enum(ENTITY_CATEGORIES).optional().describe("Optional observation category"),
      related_entity_id: z
        .string()
        .optional()
        .describe("Optional related entity id (project/feature/task/decision/question)"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      const relatedRecord = input.related_entity_id
        ? parseRecordIdString(
            input.related_entity_id,
            ["project", "feature", "task", "decision", "question"],
          ) as RecordId<"project" | "feature" | "task" | "decision" | "question", string>
        : undefined;

      if (relatedRecord) {
        const scoped = await isEntityInWorkspace(deps.surreal, context.workspaceRecord, relatedRecord);
        if (!scoped) {
          throw new Error("related entity is outside the current workspace scope");
        }
      }

      const embedding = await createEmbeddingVector(deps.embeddingModel, input.text, deps.embeddingDimension);
      if (!embedding) {
        throw new Error("failed to create embedding for create_observation");
      }

      const observationRecord = await createObservation({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        text: input.text,
        severity: input.severity,
        ...(input.category ? { category: input.category } : {}),
        sourceAgent: context.actor,
        now: new Date(),
        sourceMessageRecord: context.currentMessageRecord,
        ...(relatedRecord ? { relatedRecord } : {}),
        embedding,
      });

      return {
        observation_id: `observation:${observationRecord.id as string}`,
        severity: input.severity,
        status: "open",
      };
    },
  });
}
