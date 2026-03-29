import { tool } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { ALL_ENTITY_TABLES, getEntityDetail, parseRecordIdString } from "../graph/queries";
import { getEntityDetailSchema } from "../mcp/osabio-tool-definitions";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

/** Core logic — shared by AI SDK tool wrapper and proxy handler. */
export async function executeGetEntityDetail(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  entityId: string,
) {
  const entityRecord = parseRecordIdString(entityId, ALL_ENTITY_TABLES);
  return getEntityDetail({ surreal, workspaceRecord, entityRecord });
}

export function createGetEntityDetailTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Get full details about a specific entity including relationships, provenance, and related entities.",
    inputSchema: getEntityDetailSchema,
    execute: async (input, options) => {
      const context = requireToolContext(options);
      return executeGetEntityDetail(deps.surreal, context.workspaceRecord, input.entityId);
    },
  });
}
