import { tool } from "ai";
import { z } from "zod";
import { createEmbeddingVector } from "../../graph/embeddings";
import {
  listEntityNeighbors,
  parseRecordIdString,
  resolveWorkspaceProjectRecord,
  searchEntitiesByEmbedding,
  type GraphEntityTable,
  type SearchEntityKind,
} from "../../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createSearchEntitiesTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Semantic search across the knowledge graph. Use for finding entities by topic or meaning (e.g. \"authentication decisions\", \"payment tasks\"). For listing entities by kind or status, use list_workspace_entities instead.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Natural language search query"),
      kinds: z.array(z.enum(["project", "feature", "task", "decision", "question", "suggestion"]))
        .optional()
        .describe("Optional filter by entity kinds"),
      project: z.string().optional().describe("Optional project name or project record id"),
      limit: z.number().int().min(1).max(25).default(10).describe("Maximum number of results"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);
      const queryEmbedding = await createEmbeddingVector(deps.embeddingModel, input.query, deps.embeddingDimension);
      if (!queryEmbedding) {
        throw new Error("failed to create query embedding for search_entities");
      }

      const projectRecord = input.project
        ? await resolveWorkspaceProjectRecord({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
            projectInput: input.project,
          })
        : undefined;

      const results = await searchEntitiesByEmbedding({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        queryEmbedding,
        ...(input.kinds ? { kinds: input.kinds as SearchEntityKind[] } : {}),
        ...(projectRecord ? { projectRecord } : {}),
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
