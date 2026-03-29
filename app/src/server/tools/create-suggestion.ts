import { tool } from "ai";
import { isEntityInWorkspace, parseRecordIdString } from "../graph/queries";
import { createSuggestionSchema } from "../mcp/osabio-tool-definitions";
import { createSuggestion } from "../suggestion/queries";
import { requireAuthorizedContext } from "../iam/authority";
import type { ChatToolDeps } from "./types";

export function createCreateSuggestionTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Create a suggestion for the user — a proactive, actionable proposal with rationale. Use when you identify optimizations, risks, opportunities, conflicts, missing elements, or potential pivots that the user should consider. Observations are for agent-to-agent signals; suggestions are agent-to-human proposals.",
    inputSchema: createSuggestionSchema,
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_suggestion", deps);

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
