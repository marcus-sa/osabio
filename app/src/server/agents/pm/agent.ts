import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { ENTITY_CATEGORIES } from "../../../shared/contracts";
import type { ChatToolDeps, ChatToolExecutionContext } from "../../chat/tools/types";
import { buildPmSystemPrompt } from "./prompt";
import { createPmTools } from "./tools";

const workItemSuggestionSchema = z.object({
  kind: z.enum(["task", "feature"]),
  title: z.string().min(1),
  rationale: z.string().min(1),
  category: z.enum(ENTITY_CATEGORIES).optional(),
  project: z.string().optional(),
  priority: z.string().optional(),
  possible_duplicate: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      similarity: z.number().min(0).max(1),
    })
    .optional(),
});

const pmAgentResultSchema = z.object({
  summary: z.string().min(1),
  suggestions: z.array(workItemSuggestionSchema),
  updated: z.array(
    z.object({
      existing_id: z.string().min(1),
      title: z.string().min(1),
      changes: z.string().min(1),
    }),
  ),
  discarded: z.array(
    z.object({
      title: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  observations_created: z.array(z.string().min(1)),
});

export type WorkItemSuggestion = z.infer<typeof workItemSuggestionSchema>;
export type PmAgentResult = z.infer<typeof pmAgentResultSchema>;

export type PmAgentInput = {
  deps: ChatToolDeps & { pmModel: any };
  context: ChatToolExecutionContext;
  intent: "plan_work" | "check_status" | "organize" | "track_dependencies";
  conversationContext: string;
  project?: string;
};

const INTENT_INSTRUCTIONS: Record<PmAgentInput["intent"], string> = {
  check_status: "Primary action: call get_project_status when a project scope is available.",
  plan_work: "Primary action: propose tasks/features with suggest_work_items, deduping each item.",
  track_dependencies: "Primary action: identify blockers/dependencies and create observations for high-risk paths.",
  organize: "Primary action: organize work into clear, deduplicated next steps.",
};

export async function runPmAgent(input: PmAgentInput): Promise<PmAgentResult> {
  const system = await buildPmSystemPrompt({
    surreal: input.deps.surreal,
    workspaceRecord: input.context.workspaceRecord,
  });

  const result = await generateText({
    model: input.deps.pmModel,
    system,
    prompt: [
      "You are handling a PM request.",
      `Intent: ${input.intent}`,
      input.project ? `Project hint: ${input.project}` : "Project hint: not provided",
      INTENT_INSTRUCTIONS[input.intent],
      "Context:",
      input.conversationContext,
    ].join("\n"),
    tools: createPmTools(input.deps),
    output: Output.object({ schema: pmAgentResultSchema }),
    experimental_context: input.context,
    stopWhen: stepCountIs(6),
  });

  if (!result.output) {
    throw new Error("pm agent did not produce structured output");
  }

  return result.output;
}
