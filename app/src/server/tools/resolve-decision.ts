import { tool } from "ai";
import { z } from "zod";
import {
  createDecisionRecord,
  createExtractionProvenanceEdge,
  getDecisionPrimarySourceMessage,
  parseRecordIdString,
  resolveWorkspaceFeatureRecord,
  resolveWorkspaceProjectRecord,
  type GraphEntityRecord,
} from "../graph/queries";
import { searchEntitiesByBm25 } from "../graph/bm25-search";
import { requireAuthorizedContext } from "../iam/authority";
import type { ChatToolDeps } from "./types";

const resolveDecisionInputSchema = z.object({
  question: z.string().min(1).describe("The decision question"),
  options: z.array(z.string().min(1)).optional().describe("Known options being considered"),
  context: z
    .object({
      project: z.string().optional(),
      feature: z.string().optional(),
    })
    .optional()
    .describe("Optional project/feature scope for searching decisions"),
});

export function createResolveDecisionTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Infer an answer to a decision question from graph context. Returns resolved/inferred/unresolved with rationale and sources.",
    inputSchema: resolveDecisionInputSchema,
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_decision", deps);

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

      const candidates = await searchEntitiesByBm25({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        query: input.question,
        kinds: ["decision"],
        limit: 10,
      });

      const decisionCandidates = candidates.filter((candidate) => candidate.kind === "decision");
      const topDecision = decisionCandidates[0];

      if (topDecision && topDecision.score >= 0.92) {
        const existingDecision = parseRecordIdString(topDecision.id, ["decision"], "decision");
        const resolvedFrom = await getDecisionPrimarySourceMessage({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          decisionRecord: existingDecision,
        });

        await createExtractionProvenanceEdge({
          surreal: deps.surreal,
          sourceRecord: context.currentMessageRecord,
          targetRecord: existingDecision,
          now: new Date(),
          confidence: Math.max(topDecision.score, 0.6),
          model: deps.extractionModelId,
          fromText: input.question,
          evidence: context.latestUserText,
          evidenceSourceRecord: context.currentMessageRecord,
          ...(resolvedFrom ? { resolvedFromRecord: resolvedFrom } : {}),
        });

        return {
          status: "resolved",
          decision: {
            id: `decision:${topDecision.id}`,
            name: topDecision.name,
          },
          confidence: Number(topDecision.score.toFixed(4)),
          sources: [
            {
              id: `decision:${topDecision.id}`,
              name: topDecision.name,
              score: Number(topDecision.score.toFixed(4)),
            },
          ],
        };
      }

      if (topDecision && topDecision.score >= 0.78) {
        const now = new Date();
        const sources = candidates.slice(0, 5);
        const basedOn = sources
          .map((source) => {
            try {
              return parseRecordIdString(source.id, [source.kind as "project" | "feature" | "task" | "decision" | "question"], source.kind as any);
            } catch {
              return undefined;
            }
          })
          .filter((value): value is GraphEntityRecord => value !== undefined);

        const decisionRecord = await createDecisionRecord({
          surreal: deps.surreal,
          summary: input.question,
          status: "inferred",
          now,
          workspaceRecord: context.workspaceRecord,
          sourceMessageRecord: context.currentMessageRecord,
          rationale: `Inferred from existing graph context with ${sources.length} related entities.`,
          ...(input.options && input.options.length > 0 ? { optionsConsidered: input.options } : {}),
          ...(basedOn.length > 0 ? { basedOn } : {}),
          inferredBy: "chat_agent",
          decidedByName: "chat_agent",
          ...(projectRecord ? { projectRecord } : {}),
          ...(featureRecord ? { featureRecord } : {}),
        });

        await createExtractionProvenanceEdge({
          surreal: deps.surreal,
          sourceRecord: context.currentMessageRecord,
          targetRecord: decisionRecord,
          now,
          confidence: Math.max(topDecision.score, 0.6),
          model: deps.extractionModelId,
          fromText: input.question,
          evidence: context.latestUserText,
          evidenceSourceRecord: context.currentMessageRecord,
        });

        return {
          status: "inferred",
          decision: {
            id: `decision:${decisionRecord.id as string}`,
            name: input.question,
          },
          confidence: Number(topDecision.score.toFixed(4)),
          rationale: `Top matching decision: ${topDecision.name}. Related context was strong enough to infer a recommendation.`,
          sources: sources.map((source) => ({
            id: `${source.kind}:${source.id}`,
            name: source.name,
            score: Number(source.score.toFixed(4)),
          })),
        };
      }

      return {
        status: "unresolved",
        relatedContext: candidates.slice(0, 6).map((source) => ({
          id: `${source.kind}:${source.id}`,
          kind: source.kind,
          name: source.name,
          score: Number(source.score.toFixed(4)),
        })),
        suggestProvisional: true,
      };
    },
  });
}
