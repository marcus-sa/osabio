import { tool } from "ai";
import { z } from "zod";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES, type EntityCategory } from "../../../shared/contracts";
import { createEmbeddingVector } from "../../graph/embeddings";
import { resolveWorkspaceProjectRecord, searchEntitiesByEmbedding } from "../../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

type SuggestedWorkItem = {
  kind: "task" | "feature" | "project";
  title: string;
  rationale: string;
  category?: EntityCategory;
  project?: string;
  priority?: string;
  possible_duplicate?: {
    id: string;
    name: string;
    similarity: number;
  };
};

type UpdatedWorkItem = {
  existing_id: string;
  title: string;
  changes: string;
};

type DiscardedWorkItem = {
  title: string;
  reason: string;
};

const CLOSED_STATUSES = new Set(["done", "completed", "closed", "resolved", "superseded"]);

export function createSuggestWorkItemsTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Process a batch of proposed work items and return issue-style PM triage buckets: suggestions, updated, discarded.",
    inputSchema: z.object({
      items: z.array(
        z.object({
          kind: z.enum(["task", "feature", "project"]).describe("Work item kind"),
          title: z.string().min(1).describe("Concise work item title"),
          rationale: z.string().min(1).describe("Why this work item is needed"),
          category: z.enum(ENTITY_CATEGORIES).optional().describe("Optional work item category"),
          project: z.string().optional().describe("Optional project scope"),
          priority: z.enum(ENTITY_PRIORITIES).optional().describe("critical: blocking/urgent. high: important. medium: normal. low: nice-to-have."),
        }),
      ).min(1).max(25),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);
      const suggestions: SuggestedWorkItem[] = [];
      const updated: UpdatedWorkItem[] = [];
      const discarded: DiscardedWorkItem[] = [];

      for (const item of input.items) {
        const suggestion: SuggestedWorkItem = {
          kind: item.kind,
          title: item.title,
          rationale: item.rationale,
          ...(item.category ? { category: item.category } : {}),
          ...(item.project ? { project: item.project } : {}),
          ...(item.priority ? { priority: item.priority } : {}),
        };

        const embedding = await createEmbeddingVector(deps.embeddingModel, item.title, deps.embeddingDimension);
        if (!embedding) {
          throw new Error("failed to create embedding for suggest_work_items");
        }

        const projectRecord = item.project
          ? await resolveWorkspaceProjectRecord({
              surreal: deps.surreal,
              workspaceRecord: context.workspaceRecord,
              projectInput: item.project,
            })
          : undefined;

        const candidates = await searchEntitiesByEmbedding({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          queryEmbedding: embedding,
          kinds: [item.kind],
          ...(projectRecord ? { projectRecord } : {}),
          limit: 5,
        });

        const top = candidates[0];
        if (!top) {
          suggestions.push(suggestion);
          continue;
        }

        const normalizedTopStatus = top.status ? top.status.trim().toLowerCase() : undefined;
        if (normalizedTopStatus && CLOSED_STATUSES.has(normalizedTopStatus)) {
          suggestions.push(suggestion);
          continue;
        }

        if (top.score > 0.97) {
          discarded.push({
            title: item.title,
            reason: `Exact duplicate of existing item ${top.kind}:${top.id} (${top.name})`,
          });
          continue;
        }

        if (top.score >= 0.8) {
          updated.push({
            existing_id: `${top.kind}:${top.id}`,
            title: top.name,
            changes: `Merge context from suggested item '${item.title}'`,
          });
          continue;
        }

        suggestions.push(suggestion);
      }

      return {
        suggestions,
        updated,
        discarded,
      };
    },
  });
}
