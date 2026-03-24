import { tool } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { z } from "zod";
import { getEntityDetail, parseRecordIdString, type GraphEntityTable } from "../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

/** Core logic — shared by AI SDK tool wrapper and proxy handler. */
export async function executeGetEntityDetail(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  entityId: string,
) {
  const entityRecord = parseRecordIdString(
    entityId,
    ["workspace", "project", "person", "feature", "task", "decision", "question"],
  ) as unknown as ReturnType<typeof parseRecordIdString<GraphEntityTable>>;

  return getEntityDetail({ surreal, workspaceRecord, entityRecord });
}

export function createGetEntityDetailTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Get full details about a specific entity including relationships, provenance, and related entities.",
    inputSchema: z.object({
      entityId: z.string().min(1).describe("Entity record ID, e.g. decision:abc123"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);
      return executeGetEntityDetail(deps.surreal, context.workspaceRecord, input.entityId);
    },
  });
}
