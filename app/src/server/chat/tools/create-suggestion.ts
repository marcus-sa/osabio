import { tool } from "ai";
import { z } from "zod";
import { SUGGESTION_CATEGORIES } from "../../../shared/contracts";
import { createEmbeddingVector } from "../../graph/embeddings";
import { isEntityInWorkspace, parseRecordIdString } from "../../graph/queries";
import { createSuggestion } from "../../suggestion/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createCreateSuggestionTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Create a suggestion for the user — a proactive, actionable proposal with rationale. Use when you identify optimizations, risks, opportunities, conflicts, missing elements, or potential pivots that the user should consider. Observations are for agent-to-agent signals; suggestions are agent-to-human proposals.",
    inputSchema: z.object({
      text: z.string().min(1).describe("The suggestion itself — what you propose the user should consider or do"),
      category: z
        .enum(SUGGESTION_CATEGORIES)
        .describe(
          "optimization: improve existing approach. risk: potential problem to address. opportunity: beneficial possibility. conflict: contradictory elements detected. missing: gap in current plan. pivot: fundamental direction change worth considering.",
        ),
      rationale: z.string().min(1).describe("Why you are making this suggestion — the reasoning and evidence behind it"),
      confidence: z.number().min(0).max(1).describe("How confident you are in this suggestion (0-1)"),
      target_entity_id: z
        .string()
        .optional()
        .describe("Optional target entity this suggestion is about (format: table:id, e.g. project:uuid or feature:uuid)"),
      evidence_entity_ids: z
        .array(z.string())
        .optional()
        .describe("Optional entity IDs that support the rationale (format: table:id). Can include observations, decisions, tasks, etc."),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      const targetTables = ["project", "feature", "task", "question", "decision"] as const;
      const targetRecord = input.target_entity_id
        ? parseRecordIdString(input.target_entity_id, [...targetTables])
        : undefined;

      if (targetRecord) {
        const scoped = await isEntityInWorkspace(deps.surreal, context.workspaceRecord, targetRecord);
        if (!scoped) {
          throw new Error("target entity is outside the current workspace scope");
        }
      }

      const evidenceTables = ["workspace", "project", "person", "feature", "task", "decision", "question", "observation"] as const;
      const evidenceRecords = input.evidence_entity_ids?.map((id) =>
        parseRecordIdString(id, [...evidenceTables]),
      );

      const embedding = await createEmbeddingVector(deps.embeddingModel, input.text, deps.embeddingDimension);
      if (!embedding) {
        throw new Error("failed to create embedding for create_suggestion");
      }

      const suggestionRecord = await createSuggestion({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        text: input.text,
        category: input.category,
        rationale: input.rationale,
        suggestedBy: context.actor,
        confidence: input.confidence,
        now: new Date(),
        sourceMessageRecord: context.currentMessageRecord,
        ...(targetRecord ? { targetRecord } : {}),
        ...(evidenceRecords ? { evidenceRecords } : {}),
        embedding,
      });

      return {
        suggestion_id: `suggestion:${suggestionRecord.id as string}`,
        text: input.text,
        category: input.category,
        rationale: input.rationale,
        confidence: input.confidence,
        status: "pending",
        ...(input.target_entity_id ? { target: input.target_entity_id } : {}),
      };
    },
  });
}
