import { ToolLoopAgent, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { Surreal } from "surrealdb";
import type { ChatToolExecutionContext } from "../../chat/tools/types";
import { buildAnalyticsSystemPrompt } from "./prompt";
import { createAnalyticsTools } from "./tools";

const analyticsResultSchema = z.object({
  answer: z.string().min(1).describe("Human-readable answer to the user's question. Write in natural language, not raw data."),
  query_executed: z.string().describe("The SurrealQL query that was executed to obtain the result."),
  result_summary: z.string().describe("Brief human-readable summary of the query results, e.g. '3 tasks found' or 'total of 12 features across 2 projects'."),
});

export type AnalyticsAgentOutput = z.infer<typeof analyticsResultSchema>;

export type AnalyticsAgentInput = {
  analyticsSurreal: Surreal;
  analyticsAgentModel: any;
  context: ChatToolExecutionContext;
  question: string;
};

export async function runAnalyticsAgent(input: AnalyticsAgentInput): Promise<AnalyticsAgentOutput> {
  const system = buildAnalyticsSystemPrompt();

  const agent = new ToolLoopAgent({
    id: "analytics-agent",
    model: input.analyticsAgentModel,
    instructions: system,
    tools: createAnalyticsTools(input.analyticsSurreal),
    output: Output.object({ schema: analyticsResultSchema }),
    experimental_context: input.context,
    stopWhen: stepCountIs(5),
  });

  const result = await agent.generate({
    prompt: input.question,
  });

  if (!result.output) {
    throw new Error("analytics agent did not produce structured output");
  }

  console.log("[analytics] answer:", result.output.answer);
  console.log("[analytics] result_summary:", result.output.result_summary);

  return result.output;
}
