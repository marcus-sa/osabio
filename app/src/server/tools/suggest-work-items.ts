import { tool } from "ai";
import { z } from "zod";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES, type EntityCategory } from "../../shared/contracts";
import { searchEntitiesByBm25 } from "../graph/bm25-search";
import { requireAuthorizedContext } from "../iam/authority";
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
          kind: z.enum(["task", "feature", "project"]).describe("project: named product area (MUST exist before features/tasks). feature: capability within an existing project. task: concrete executable work."),
          title: z.string().min(1).describe("Concise work item title"),
          rationale: z.string().min(1).describe("Why this work item is needed"),
          category: z.enum(ENTITY_CATEGORIES).optional().describe("Optional work item category"),
          project: z.string().optional().describe("Optional project scope"),
          priority: z.enum(ENTITY_PRIORITIES).optional().describe("critical: blocking/urgent. high: important. medium: normal. low: nice-to-have."),
        }),
      ).min(1).max(25),
    }),
    execute: async (input, options) => {
      const { context } = await requireAuthorizedContext(options, "create_suggestion", deps);
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

        // BM25 text search for duplicate detection -- replaces embedding similarity
        const candidates = await searchEntitiesByBm25({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          query: item.title,
          kinds: [item.kind],
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

        // BM25 duplicate detection: exact title match = discard, partial match = merge
        const normalizedTopName = top.name.trim().toLowerCase();
        const normalizedTitle = item.title.trim().toLowerCase();

        if (normalizedTopName === normalizedTitle) {
          discarded.push({
            title: item.title,
            reason: `Exact duplicate of existing item ${top.kind}:${top.id} (${top.name})`,
          });
          continue;
        }

        // BM25 match means significant keyword overlap -- suggest merge
        updated.push({
          existing_id: `${top.kind}:${top.id}`,
          title: top.name,
          changes: `Merge context from suggested item '${item.title}'`,
        });
      }

      return {
        suggestions,
        updated,
        discarded,
      };
    },
  });
}
