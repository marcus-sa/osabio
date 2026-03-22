import { tool } from "ai";
import { z } from "zod";
import {
  createDecisionRecord,
  createExtractionProvenanceEdge,
  resolveWorkspaceFeatureRecord,
  resolveWorkspaceProjectRecord,
} from "../graph/queries";
import { requireAuthorizedContext } from "../iam/authority";
import type { ChatToolDeps } from "./types";

export function createCreateProvisionalDecisionTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Create a provisional decision when no existing answer exists. Use after resolve_decision returns unresolved and the user wants to proceed.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Concise decision name"),
      rationale: z.string().min(1).describe("Why this decision was made"),
      context: z
        .object({
          project: z.string().optional(),
          feature: z.string().optional(),
        })
        .optional(),
      options_considered: z.array(z.string().min(1)).optional(),
    }),
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_decision", deps);
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

      const decisionRecord = await createDecisionRecord({
        surreal: deps.surreal,
        summary: input.name,
        status: "provisional",
        now,
        workspaceRecord: context.workspaceRecord,
        sourceMessageRecord: context.currentMessageRecord,
        rationale: input.rationale,
        ...(input.options_considered && input.options_considered.length > 0
          ? { optionsConsidered: input.options_considered }
          : {}),
        decidedByName: "chat_agent",
        ...(projectRecord ? { projectRecord } : {}),
        ...(featureRecord ? { featureRecord } : {}),
      });

      await createExtractionProvenanceEdge({
        surreal: deps.surreal,
        sourceRecord: context.currentMessageRecord,
        targetRecord: decisionRecord,
        now,
        confidence: 0.9,
        model: deps.extractionModelId,
        fromText: input.name,
        evidence: context.latestUserText,
        evidenceSourceRecord: context.currentMessageRecord,
      });

      return {
        decision_id: `decision:${decisionRecord.id as string}`,
        status: "provisional",
        review_required: true,
      };
    },
  });
}
