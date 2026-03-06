import { tool } from "ai";
import { z } from "zod";
import { runArchitectAgent } from "../../agents/architect/agent";
import { logError } from "../../http/observability";
import { requireToolContext } from "./helpers";
import type { ChatAgentToolDeps } from "./types";

export function createInvokeArchitectAgentTool(deps: ChatAgentToolDeps) {
  return tool({
    description:
      "Invoke the Architect subagent — an opinionated co-designer that probes ideas, challenges assumptions, captures decisions, and suggests work items. Use when the user is exploring a new idea, brainstorming, or needs help thinking through a product/project concept.",
    inputSchema: z.object({
      intent: z
        .enum(["design", "brainstorm", "challenge", "synthesize"])
        .describe(
          "design: user has an idea to flesh out (target user, differentiation, tech stack). brainstorm: user is exploring possibilities without commitment. challenge: user has a plan that should be stress-tested. synthesize: enough discussed, time to summarize decisions and gaps.",
        ),
      context: z.string().min(1).describe("Conversation context for the Architect agent"),
      project: z.string().optional().describe("Optional project scope"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      try {
        return await runArchitectAgent({
          deps: { ...deps, architectModel: deps.architectModel },
          context,
          intent: input.intent,
          conversationContext: input.context,
          ...(input.project ? { project: input.project } : {}),
          onToken: deps.onSubagentToken,
        });
      } catch (error) {
        logError("tool.invoke_architect_agent.failed", "Architect agent invocation failed", error, {
          intent: input.intent,
          workspace: context.workspaceRecord.toString(),
          conversation: context.conversationRecord.toString(),
        });
        throw error;
      }
    },
  });
}
