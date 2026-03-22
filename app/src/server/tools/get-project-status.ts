import { tool } from "ai";
import { z } from "zod";
import { getProjectStatus } from "../graph/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

export function createGetProjectStatusTool(deps: ChatToolDeps) {
  return tool({
    description:
      "Get the current status of a project including active tasks, recent decisions, open questions, and features.",
    inputSchema: z.object({
      projectId: z.string().min(1).describe("Project record ID or project name"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      return getProjectStatus({
        surreal: deps.surreal,
        workspaceRecord: context.workspaceRecord,
        projectInput: input.projectId,
      });
    },
  });
}
