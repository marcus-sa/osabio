import { ToolLoopAgent, Output, stepCountIs } from "ai";
import type { ExtractedEntity, ExtractedRelationship } from "../../../shared/contracts";
import type { ChatToolDeps, ChatToolExecutionContext } from "../../chat/tools/types";
import { buildArchitectSystemPrompt } from "./prompt";
import { createArchitectTools } from "./tools";

export type ArchitectAgentInput = {
  deps: ChatToolDeps & { architectModel: any };
  context: ChatToolExecutionContext;
  intent: "design" | "brainstorm" | "challenge" | "synthesize";
  conversationContext: string;
  project?: string;
  onToken?: (token: string) => Promise<void> | void;
};

export type ArchitectAgentOutput = {
  text: string;
  extracted_entities: ExtractedEntity[];
  extracted_relationships: ExtractedRelationship[];
};

const INTENT_INSTRUCTIONS: Record<ArchitectAgentInput["intent"], string> = {
  design: "The user has an idea to flesh out. Probe for target user, differentiation, tech stack, data model, and risks.",
  brainstorm: "The user is exploring possibilities without commitment. Help them think divergently, then converge on the strongest options.",
  challenge: "The user has a plan that should be stress-tested. Find weaknesses, missing pieces, and risky assumptions.",
  synthesize: "Enough has been discussed. Summarize captured decisions, list open questions, and suggest concrete next steps as work items.",
};

export async function runArchitectAgent(input: ArchitectAgentInput): Promise<ArchitectAgentOutput> {
  const system = await buildArchitectSystemPrompt({
    surreal: input.deps.surreal,
    workspaceRecord: input.context.workspaceRecord,
  });

  const agent = new ToolLoopAgent({
    id: "architect-agent",
    model: input.deps.architectModel,
    instructions: system,
    tools: createArchitectTools(input.deps),
    output: Output.text(),
    experimental_context: { ...input.context, actor: "chat_agent" as const, agentType: "architect" as const },
    stopWhen: stepCountIs(5),
  });

  const result = await agent.stream({
    prompt: [
      "You are handling an Architect request.",
      `Intent: ${input.intent}`,
      input.project ? `Project hint: ${input.project}` : "Project hint: not provided",
      INTENT_INSTRUCTIONS[input.intent],
      "Context:",
      input.conversationContext,
    ].join("\n"),
  });

  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
    await input.onToken?.(chunk);
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

  return { text, extracted_entities, extracted_relationships };
}
