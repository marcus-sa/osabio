import { tool } from "ai";
import { z } from "zod";
import {
  getFocusedGraphView,
  parseRecordIdString,
  type GraphEntityTable,
  type GraphViewRawResult,
} from "../../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

function titleCase(s: string): string {
  return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function mergeGraphResults(results: GraphViewRawResult[]): GraphViewRawResult {
  const entityMap = new Map<string, GraphViewRawResult["entities"][number]>();
  const edgeMap = new Map<string, GraphViewRawResult["edges"][number]>();

  for (const result of results) {
    for (const entity of result.entities) {
      entityMap.set(entity.id, entity);
    }
    for (const edge of result.edges) {
      edgeMap.set(edge.id, edge);
    }
  }

  return {
    entities: Array.from(entityMap.values()),
    edges: Array.from(edgeMap.values()),
  };
}

const ENTITY_TABLES: GraphEntityTable[] = ["workspace", "project", "person", "feature", "task", "decision", "question"];

export function createShowRelationshipGraphTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Show an interactive relationship graph for entities, visualizing their neighborhood connections. Use when users ask about how entities relate or when showing connections would help explain context. Returns an InlineRelationshipGraph component block.",
    inputSchema: z.object({
      entity_ids: z
        .array(z.string().min(1).describe("Entity record ID, e.g. decision:abc123"))
        .min(1)
        .max(10)
        .describe("Entity IDs to show neighborhoods for (1-10)"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      const entityRecords = input.entity_ids.map((id) =>
        parseRecordIdString(id, ENTITY_TABLES) as ReturnType<typeof parseRecordIdString<GraphEntityTable>>,
      );

      const rawResults = await Promise.all(
        entityRecords.map((record) =>
          getFocusedGraphView({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
            centerEntityRecord: record,
            depth: 1,
          }),
        ),
      );

      const merged = mergeGraphResults(rawResults);

      const focusNodeIds = entityRecords.map((r) => r.id as string);

      const nodes = merged.entities.map((entity) => ({
        id: entity.id,
        label: entity.name.length > 32 ? entity.name.slice(0, 32) + "\u2026" : entity.name,
        kind: entity.kind,
      }));

      const edges = merged.edges.map((edge) => ({
        id: edge.id,
        source: edge.fromId,
        target: edge.toId,
        label: titleCase(edge.kind.replace(/_/g, " ")),
        type: edge.kind,
      }));

      const entityNames = input.entity_ids
        .map((id) => {
          const entity = merged.entities.find((e) => e.id === id.split(":")[1]);
          return entity?.name ?? id;
        })
        .join(", ");

      return {
        component: "InlineRelationshipGraph",
        props: {
          title: `Relationships: ${entityNames}`,
          nodes,
          edges,
          focusNodeIds,
        },
      };
    },
  });
}
