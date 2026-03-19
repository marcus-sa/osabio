import { tool } from "ai";
import { z } from "zod";
import { searchEntitiesByBm25 } from "../../graph/bm25-search";
import {
  listEntityNeighbors,
  parseRecordIdString,
  type GraphEntityTable,
  type SearchEntityKind,
} from "../../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createSearchEntitiesTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Full-text search across the knowledge graph. Use for finding entities by keyword or topic (e.g. \"authentication decisions\", \"payment tasks\"). For listing entities by kind or status, use list_workspace_entities instead.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query (keywords matched via BM25 full-text search)"),
      kinds: z.array(z.enum(["project", "feature", "task", "decision", "question", "suggestion"]))
        .optional()
        .describe("Optional filter by entity kinds"),
      limit: z.number().int().min(1).max(25).default(10).describe("Maximum number of results"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      const results = await searchEntitiesByBm25({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        query: input.query,
        ...(input.kinds ? { kinds: input.kinds as SearchEntityKind[] } : {}),
        limit: input.limit,
      });

      const enriched = await Promise.all(
        results.map(async (row) => {
          const entityRecord = parseRecordIdString(row.id, [row.kind as GraphEntityTable], row.kind as GraphEntityTable);
          const neighbors = await listEntityNeighbors({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
            entityRecord,
            limit: 8,
          });

          return {
            id: `${row.kind}:${row.id}`,
            kind: row.kind,
            name: row.name,
            confidence: Number(row.score.toFixed(4)),
            ...(row.status ? { status: row.status } : {}),
            related: neighbors.slice(0, 4).map((neighbor) => ({
              id: `${neighbor.kind}:${neighbor.id}`,
              kind: neighbor.kind,
              name: neighbor.name,
              relation: neighbor.relationKind,
            })),
          };
        }),
      );

      return {
        query: input.query,
        results: enriched,
      };
    },
  });
}
