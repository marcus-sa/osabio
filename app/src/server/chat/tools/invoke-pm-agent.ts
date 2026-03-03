import { tool } from "ai";
import { z } from "zod";
import { runPmAgent } from "../../agents/pm/agent";
import { requireToolContext } from "./helpers";
import type { OrchestratorToolDeps } from "./types";

export function createInvokePmAgentTool(deps: OrchestratorToolDeps) {
  return tool({
    description:
      "Invoke the PM subagent — the single authority on tasks, features, and project status.",
    inputSchema: z.object({
      intent: z
        .enum(["plan_work", "check_status", "organize", "track_dependencies"])
        .describe(
          "plan_work: user discusses goals, features, or work to be done. check_status: user asks about progress, blockers, or project status. organize: user wants to restructure or re-prioritize. track_dependencies: user asks about blocked items or dependency chains.",
        ),
      context: z.string().min(1).describe("Conversation context for the PM agent"),
      project: z.string().optional().describe("Optional project scope"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      return runPmAgent({
        deps,
        context,
        intent: input.intent,
        conversationContext: input.context,
        ...(input.project ? { project: input.project } : {}),
      });
    },
  });
}
