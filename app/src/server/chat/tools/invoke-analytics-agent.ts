import { tool } from "ai";
import { z } from "zod";
import { runAnalyticsAgent } from "../../agents/analytics/agent";
import { requireToolContext } from "./helpers";
import type { ChatAgentToolDeps } from "./types";

export function createInvokeAnalyticsAgentTool(deps: ChatAgentToolDeps) {
  return tool({
    description:
      "Invoke the analytics agent for questions about patterns, metrics, trends, provenance, or aggregations across the knowledge graph. Use existing tools (search_entities, get_entity_detail, get_project_status) for questions about specific entities.",
    inputSchema: z.object({
      question: z.string().min(1).describe("The analytical question to answer"),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      return runAnalyticsAgent({
        analyticsSurreal: deps.analyticsSurreal,
        analyticsAgentModel: deps.analyticsAgentModel,
        context,
        question: input.question,
      });
    },
  });
}
