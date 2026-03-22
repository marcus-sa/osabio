import { tool } from "ai";
import { z } from "zod";
import { runPmAgent } from "../agents/pm/agent";
import { requireToolContext } from "./helpers";
import type { ChatAgentToolDeps } from "./types";
import { log } from "../telemetry/logger";

export function createInvokePmAgentTool(deps: ChatAgentToolDeps) {
  return tool({
    description:
      "Invoke the PM subagent — the single authority on tasks, features, and project status.",
    inputSchema: z.object({
      intent: z
        .enum(["plan_work", "check_status", "organize", "track_dependencies"])
        .describe(
          "plan_work: user discusses goals, features, or work to be done. check_status: user asks about progress, blockers, or project status. organize: user wants to restructure or re-prioritize. track_dependencies: user asks about blocked items or dependency chains.",
        ),
      context: z.string().min(1).describe("The relevant parts of the user's message for the PM agent. Forward the user's words — do NOT pre-classify what is a project, feature, or task. The PM agent decides entity classification."),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      try {
        return await runPmAgent({
          deps,
          context,
          intent: input.intent,
          conversationContext: input.context,
        });
      } catch (error) {
        log.error("tool.invoke_pm_agent.failed", "PM agent invocation failed", error, {
          intent: input.intent,
          workspace: context.workspaceRecord.toString(),
          conversation: context.conversationRecord.toString(),
        });
        throw error;
      }
    },
  });
}
