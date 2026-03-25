import { tool } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { searchEntitiesByBm25 } from "../graph/bm25-search";
import { searchEntitiesSchema } from "../mcp/brain-tool-definitions";
import {
  listEntityNeighbors,
  parseRecordIdString,
  type GraphEntityTable,
  type SearchEntityKind,
} from "../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

/** Core search logic — shared by AI SDK tool wrapper and proxy handler. */
export async function executeSearchEntities(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  input: { query: string; kinds?: SearchEntityKind[]; limit: number },
) {
  const results = await searchEntitiesByBm25({
    surreal,
    workspaceRecord,
    query: input.query,
    ...(input.kinds ? { kinds: input.kinds } : {}),
    limit: input.limit,
  });

  const enriched = await Promise.all(
    results.map(async (row) => {
      const entityRecord = parseRecordIdString(row.id, [row.kind as GraphEntityTable], row.kind as GraphEntityTable);
      const neighbors = await listEntityNeighbors({
        surreal,
        workspaceRecord,
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

  return { query: input.query, results: enriched };
}

export function createSearchEntitiesTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Full-text search across the knowledge graph. Use for finding entities by keyword or topic (e.g. \"authentication decisions\", \"payment tasks\"). For listing entities by kind or status, use list_workspace_entities instead.",
    inputSchema: searchEntitiesSchema,
    execute: async (input, options) => {
      const context = requireToolContext(options);
      return executeSearchEntities(deps.surreal, context.workspaceRecord, {
        query: input.query,
        kinds: input.kinds as SearchEntityKind[] | undefined,
        limit: input.limit,
      });
    },
  });
}
