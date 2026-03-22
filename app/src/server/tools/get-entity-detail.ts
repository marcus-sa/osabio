import { tool } from "ai";
import { z } from "zod";
import { getEntityDetail, parseRecordIdString, type GraphEntityTable } from "../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createGetEntityDetailTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Get full details about a specific entity including relationships, provenance, and related entities.",
    inputSchema: z.object({
      entityId: z.string().min(1).describe("Entity record ID, e.g. decision:abc123"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);
      const entityRecord = parseRecordIdString(
        input.entityId,
        ["workspace", "project", "person", "feature", "task", "decision", "question"],
      ) as unknown as ReturnType<typeof parseRecordIdString<GraphEntityTable>>;

      const detail = await getEntityDetail({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        entityRecord,
      });

      return detail;
    },
  });
}
