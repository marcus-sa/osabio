import { tool } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { getProjectStatus } from "../graph/queries";
import { getProjectStatusSchema } from "../mcp/osabio-tool-definitions";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

/** Core logic — shared by AI SDK tool wrapper and proxy handler. */
export async function executeGetProjectStatus(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectInput: string,
) {
  return getProjectStatus({ surreal, workspaceRecord, projectInput });
}

export function createGetProjectStatusTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Get the current status of a project including active tasks, recent decisions, open questions, and features.",
    inputSchema: getProjectStatusSchema,
    execute: async (input, options) => {
      const context = requireToolContext(options);
      return executeGetProjectStatus(deps.surreal, context.workspaceRecord, input.projectId);
    },
  });
}
