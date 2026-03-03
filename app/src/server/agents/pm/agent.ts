import { ToolLoopAgent, Output, stepCountIs } from "ai";
import { z } from "zod";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES, type ExtractedEntity, type ExtractedRelationship } from "../../../shared/contracts";
import type { ChatToolDeps, ChatToolExecutionContext } from "../../chat/tools/types";
import { buildPmSystemPrompt } from "./prompt";
import { createPmTools } from "./tools";

const workItemSuggestionSchema = z
  .object({
    kind: z.enum(["task", "feature", "project"]),
    title: z.string().min(1),
    rationale: z.string().min(1),
    category: z.enum(["none", ...ENTITY_CATEGORIES]),
    project: z.enum(["none"]).or(z.string().min(1)),
    priority: z.enum(["none", ...ENTITY_PRIORITIES]),
    possible_duplicate: z.enum(["none"]).or(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        similarity: z.number().min(0).max(1),
      }),
    ),
  })
  .transform((v) => ({
    ...v,
    category: v.category === "none" ? undefined : v.category,
    project: v.project === "none" ? undefined : v.project,
    priority: v.priority === "none" ? undefined : v.priority,
    possible_duplicate: v.possible_duplicate === "none" ? undefined : v.possible_duplicate,
  }));

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

export type PmAgentOutput = PmAgentResult & {
  extracted_entities: ExtractedEntity[];
  extracted_relationships: ExtractedRelationship[];
};

export type PmAgentInput = {
  deps: ChatToolDeps & { pmAgentModel: any };
  context: ChatToolExecutionContext;
  intent: "plan_work" | "check_status" | "organize" | "track_dependencies";
  conversationContext: string;
  project?: string;
};

const INTENT_INSTRUCTIONS: Record<PmAgentInput["intent"], string> = {
  check_status: "Primary action: call get_project_status when a project scope is available.",
  plan_work: "Primary action: propose tasks/features/projects with suggest_work_items or create_work_item, deduping each item.",
  track_dependencies: "Primary action: identify blockers/dependencies and create observations for high-risk paths.",
  organize: "Primary action: organize work into clear, deduplicated next steps.",
};

export async function runPmAgent(input: PmAgentInput): Promise<PmAgentOutput> {
  const system = await buildPmSystemPrompt({
    surreal: input.deps.surreal,
    workspaceRecord: input.context.workspaceRecord,
  });

  const agent = new ToolLoopAgent({
    id: "pm-agent",
    model: input.deps.pmAgentModel,
    instructions: system,
    tools: createPmTools(input.deps),
    output: Output.object({ schema: pmAgentResultSchema }),
    experimental_context: input.context,
    stopWhen: stepCountIs(6),
  });

  const result = await agent.generate({
    prompt: [
      "You are handling a PM request.",
      `Intent: ${input.intent}`,
      input.project ? `Project hint: ${input.project}` : "Project hint: not provided",
      INTENT_INSTRUCTIONS[input.intent],
      "Context:",
      input.conversationContext,
    ].join("\n"),
  });

  if (!result.output) {
    throw new Error("pm agent did not produce structured output");
  }

  const extracted_entities: ExtractedEntity[] = [];
  const extracted_relationships: ExtractedRelationship[] = [];

  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      const res = toolResult.output as Record<string, unknown> | undefined;
      if (res) {
        if (Array.isArray(res.extracted_entities)) {
          extracted_entities.push(...(res.extracted_entities as ExtractedEntity[]));
        }
        if (Array.isArray(res.extracted_relationships)) {
          extracted_relationships.push(...(res.extracted_relationships as ExtractedRelationship[]));
        }
      }
    }
  }

  return {
    ...result.output,
    extracted_entities,
    extracted_relationships,
  };
}
