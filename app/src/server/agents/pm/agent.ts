import { ToolLoopAgent, Output, stepCountIs } from "ai";
import { z } from "zod";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES, type ExtractedEntity, type ExtractedRelationship, type SubagentTrace, type SubagentTraceStep } from "../../../shared/contracts";
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
  trace: SubagentTrace;
};

export type PmAgentInput = {
  deps: ChatToolDeps & { pmAgentModel: any };
  context: ChatToolExecutionContext;
  intent: "plan_work" | "check_status" | "organize" | "track_dependencies";
  conversationContext: string;
};

const INTENT_INSTRUCTIONS: Record<PmAgentInput["intent"], string> = {
  check_status: "Primary action: call get_project_status when a project scope is available.",
  plan_work: "Primary action: create tasks/features/projects with create_work_item for each clearly described item. You MUST call create_work_item before generating output. Only use suggest_work_items when items are vague or you need to check for duplicates against many existing entities.",
  track_dependencies: "Primary action: identify blockers/dependencies and create observations for high-risk paths.",
  organize: "Primary action: organize work into clear, deduplicated next steps. When moving items between projects, use search_entities to find existing items, then move_items_to_project to reassign them. Do NOT recreate items that already exist.",
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
    experimental_context: { ...input.context, actor: "pm_agent" as const, humanPresent: input.context.humanPresent ?? true },
    stopWhen: stepCountIs(6),
  });

  const startedAt = performance.now();

  const result = await agent.generate({
    prompt: [
      "You are handling a PM request.",
      `Intent: ${input.intent}`,
      INTENT_INSTRUCTIONS[input.intent],
      "IMPORTANT: You MUST call your tools (create_work_item, suggest_work_items, etc.) BEFORE generating your final output. Do NOT skip tool calls — your output summary must reflect actual tool execution results.",
      "Context:",
      input.conversationContext,
    ].join("\n"),
  });

  const totalDurationMs = Math.round(performance.now() - startedAt);

  if (!result.output) {
    throw new Error("pm agent did not produce structured output");
  }

  const extracted_entities: ExtractedEntity[] = [];
  const extracted_relationships: ExtractedRelationship[] = [];
  const traceSteps: SubagentTraceStep[] = [];

  for (const step of result.steps) {
    if (step.text?.trim()) {
      traceSteps.push({ type: "text", text: step.text.trim() });
    }

    for (const toolResult of step.toolResults) {
      traceSteps.push({
        type: "tool_call",
        toolName: toolResult.toolName,
        argsJson: JSON.stringify(toolResult.input),
        resultJson: JSON.stringify(toolResult.output),
      });

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
    trace: {
      agentId: "pm_agent",
      intent: input.intent,
      steps: traceSteps,
      totalDurationMs,
    },
  };
}
