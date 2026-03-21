import { tool } from "ai";
import { z } from "zod";
import { searchEntitiesByBm25 } from "../../graph/bm25-search";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

function normalizeTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2),
  );
}

function hasTokenOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) {
      return true;
    }
  }

  return false;
}

export function createCheckConstraintsTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Check if a proposed action conflicts with existing decisions or constraints. Returns hard conflicts, soft tensions, supporting context, and proceed flag.",
    inputSchema: z.object({
      proposed_action: z.string().min(1).describe("What is being proposed"),
      project: z.string().optional().describe("Optional project scope"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      const candidates = await searchEntitiesByBm25({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        query: input.proposed_action,
        kinds: ["decision"],
        limit: 14,
      });

      const actionTokens = normalizeTokens(input.proposed_action);
      const hardConflicts: Array<{ id: string; name: string; score: number; reason: string }> = [];
      const softTensions: Array<{ id: string; name: string; score: number; reason: string }> = [];
      const supporting: Array<{ id: string; name: string; score: number; reason: string }> = [];

      for (const candidate of candidates) {
        const candidateTokens = normalizeTokens(candidate.name);
        const overlap = hasTokenOverlap(actionTokens, candidateTokens);
        const status = candidate.status?.toLowerCase();

        if (candidate.kind === "decision" && overlap && (status === "contested" || status === "superseded")) {
          hardConflicts.push({
            id: `${candidate.kind}:${candidate.id}`,
            name: candidate.name,
            score: Number(candidate.score.toFixed(4)),
            reason: `Decision is marked ${status}.`,
          });
          continue;
        }

        if (candidate.kind === "decision" && candidate.score >= 0.86 && overlap) {
          supporting.push({
            id: `${candidate.kind}:${candidate.id}`,
            name: candidate.name,
            score: Number(candidate.score.toFixed(4)),
            reason: "High-similarity decision aligns with proposed action.",
          });
          continue;
        }

        if (candidate.score >= 0.72) {
          softTensions.push({
            id: `${candidate.kind}:${candidate.id}`,
            name: candidate.name,
            score: Number(candidate.score.toFixed(4)),
            reason: overlap
              ? "Related decision/question may require consistency checks."
              : "Semantically related context may be affected.",
          });
        }
      }

      return {
        hard_conflicts: hardConflicts,
        soft_tensions: softTensions,
        supporting,
        proceed: hardConflicts.length === 0,
      };
    },
  });
}
