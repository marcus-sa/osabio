import { type RecordId, type Surreal } from "surrealdb";
import type { ObservationSummary, OnboardingState } from "../../shared/contracts";
import {
  listConversationEntities,
  listWorkspaceOpenQuestions,
  listWorkspaceProjectSummaries,
  listWorkspaceRecentDecisions,
  readEntityName,
  type ConversationEntity,
  type WorkspaceDecisionSummary,
  type WorkspaceProjectSummary,
  type WorkspaceQuestionSummary,
} from "../graph/queries";
import { listWorkspaceOpenObservations } from "../observation/queries";
import { loadOnboardingSummary } from "../onboarding/onboarding-state";
import { chatComponentSystemPrompt } from "./chat-component-system-prompt";
import type { GraphEntityRecord } from "../extraction/types";

export type DiscussedEntityContext = {
  kind: string;
  name: string;
  status?: string;
};

export type ChatContext = {
  conversationEntities: ConversationEntity[];
  workspaceSummary: {
    projects: WorkspaceProjectSummary[];
    recentDecisions: WorkspaceDecisionSummary[];
    openQuestions: WorkspaceQuestionSummary[];
    openObservations: ObservationSummary[];
  };
  onboardingSummary?: string;
  discussedEntity?: DiscussedEntityContext;
};

type ChatContextLoaders = {
  listConversationEntities: typeof listConversationEntities;
  listWorkspaceProjectSummaries: typeof listWorkspaceProjectSummaries;
  listWorkspaceRecentDecisions: typeof listWorkspaceRecentDecisions;
  listWorkspaceOpenQuestions: typeof listWorkspaceOpenQuestions;
  listWorkspaceOpenObservations: typeof listWorkspaceOpenObservations;
  loadOnboardingSummary: typeof loadOnboardingSummary;
};

export async function buildChatContext(input: {
  surreal: Surreal;
  conversationRecord: RecordId<"conversation", string>;
  workspaceRecord: RecordId<"workspace", string>;
  loaders?: ChatContextLoaders;
  inheritedEntityIds?: RecordId[];
  discussesRecord?: RecordId;
}): Promise<ChatContext> {
  const loaders = input.loaders ?? {
    listConversationEntities,
    listWorkspaceProjectSummaries,
    listWorkspaceRecentDecisions,
    listWorkspaceOpenQuestions,
    listWorkspaceOpenObservations,
    loadOnboardingSummary,
  };

  const [conversationEntities, projects, recentDecisions, openQuestions, openObservations, onboardingSummary] = await Promise.all([
    loaders.listConversationEntities({
      surreal: input.surreal,
      conversationRecord: input.conversationRecord,
      workspaceRecord: input.workspaceRecord,
      limit: 60,
      ...(input.inheritedEntityIds && input.inheritedEntityIds.length > 0
        ? { inheritedEntityIds: input.inheritedEntityIds }
        : {}),
    }),
    loaders.listWorkspaceProjectSummaries({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 20,
    }),
    loaders.listWorkspaceRecentDecisions({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 12,
    }),
    loaders.listWorkspaceOpenQuestions({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 12,
    }),
    loaders.listWorkspaceOpenObservations({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 10,
    }),
    loaders.loadOnboardingSummary(input.surreal, input.workspaceRecord),
  ]);

  let discussedEntity: DiscussedEntityContext | undefined;
  if (input.discussesRecord) {
    const entityRecord = input.discussesRecord as GraphEntityRecord;
    const name = await readEntityName(input.surreal, entityRecord);
    if (name) {
      const row = await input.surreal.select<Record<string, unknown>>(entityRecord);
      discussedEntity = {
        kind: entityRecord.table.name,
        name,
        ...(row && typeof row.status === "string" ? { status: row.status } : {}),
      };
    }
  }

  return {
    conversationEntities,
    workspaceSummary: {
      projects,
      recentDecisions,
      openQuestions,
      openObservations,
    },
    onboardingSummary,
    discussedEntity,
  };
}

function formatConversationEntities(entities: ConversationEntity[]): string {
  if (entities.length === 0) {
    return "- none";
  }

  return entities
    .slice(0, 20)
    .map((entity) => `- ${entity.kind}: ${entity.name} (confidence ${entity.confidence.toFixed(2)})`)
    .join("\n");
}

function formatProjectList(projects: WorkspaceProjectSummary[]): string {
  if (projects.length === 0) {
    return "- none";
  }

  return projects
    .slice(0, 15)
    .map((project) => `- ${project.name} [id: ${project.id}] active tasks: ${project.activeTaskCount}`)
    .join("\n");
}

function formatDecisionList(decisions: WorkspaceDecisionSummary[]): string {
  if (decisions.length === 0) {
    return "- none";
  }

  return decisions
    .slice(0, 15)
    .map((decision) => {
      const project = decision.project ? ` project: ${decision.project}` : "";
      return `- ${decision.name} [id: ${decision.id}] status: ${decision.status}${project}`;
    })
    .join("\n");
}

function formatQuestionList(questions: WorkspaceQuestionSummary[]): string {
  if (questions.length === 0) {
    return "- none";
  }

  return questions
    .slice(0, 15)
    .map((question) => {
      const project = question.project ? ` project: ${question.project}` : "";
      return `- ${question.name} [id: ${question.id}]${project}`;
    })
    .join("\n");
}

function formatObservationList(observations: ObservationSummary[]): string {
  if (observations.length === 0) {
    return "- none";
  }

  return observations
    .slice(0, 10)
    .map((observation) => {
      const category = observation.category ? `, ${observation.category}` : "";
      return `- [${observation.severity}] ${observation.text} (by ${observation.sourceAgent}, ${observation.status}${category})`;
    })
    .join("\n");
}

type SystemPromptOptions = {
  isOnboarding?: boolean;
  onboardingState?: OnboardingState;
};

export function buildSystemPrompt(context: ChatContext, options?: SystemPromptOptions): string {
  const sections: string[] = [
    "You are the Chat agent for a workspace-aware project intelligence system.",
    "You are a **thin orchestrator**: your job is to decide which tools and subagents to invoke, control sequencing, and synthesize user-facing responses.",
    "You have access to a workspace-scoped knowledge graph stored in SurrealDB.",
    "Never assume data from other workspaces.",
    "",
    "## Architecture: Graph as Communication Bus",
    "All agent-to-agent communication happens through the knowledge graph. You do NOT pass data between agents directly.",
    "- Each agent reads the graph for context it needs.",
    "- Each agent writes its outputs (entities, observations, decisions) directly to the graph.",
    "- Subsequent agents read the graph and see prior agents' work.",
    "- You synthesize the user-facing response from graph state and tool results.",
    "",
  ];

  // Onboarding mode instructions
  if (options?.isOnboarding && options.onboardingState !== "complete") {
    if (options.onboardingState === "summary_pending") {
      sections.push(
        "## Onboarding Mode — Summary",
        "The workspace onboarding is wrapping up. Summarize what has been captured so far and ask the user to confirm or add anything else.",
        "",
        "Current workspace state:",
        context.onboardingSummary ?? "No entities captured yet.",
        "",
      );
    } else {
      sections.push(
        "## Onboarding Mode",
        "You are onboarding a newly created workspace.",
        "Ask one natural question at a time like a smart colleague, never as a form.",
        "Cover these topics over 5-7 turns: business/venture, projects, people, decisions, tools, bottlenecks.",
        "Keep acknowledgment to one sentence max. Ask exactly one concrete follow-up question.",
        "",
        "When the user describes their workspace, create entities directly:",
        "- Projects → dispatch PM agent with plan_work intent",
        "- Decisions → use create_provisional_decision",
        "- Open questions requiring a choice → use create_question (not for informational queries)",
        "- People mentioned → note in your response (person creation is handled separately)",
        "",
        "Current workspace state:",
        context.onboardingSummary ?? "No entities captured yet.",
        "",
      );
    }
  }

  sections.push(
    "## When to Create Decisions",
    "Commitment/selection language: \"let's go with\", \"we decided\", \"we'll use\", \"going with\", \"settled on\".",
    "Decision vs feature: choice language (X instead of Y) = decision; description language (we need X) = feature.",
    "",
    "## When to Create Questions",
    "Only for open questions that require a choice or pending decision: \"should we use X or Y?\", \"which approach for Z?\".",
    "Do NOT create question entities for informational queries (\"what is blocking X?\", \"how does Y work?\", \"what's the status?\") — answer those directly.",
    "One question per topic; if question includes options (X or Y), create one question entity.",
    "",
    "## When NOT to Create Entities",
    "- Casual conversation, greetings, clarifications, status queries",
    "- Vague references: \"my project\", \"the feature\", \"the thing\"",
    "- User is brainstorming/exploring — wait for convergence",
    "",
  );

  if (context.discussedEntity) {
    const entity = context.discussedEntity;
    sections.push(
      "## Discussed Entity",
      "The user opened this conversation to discuss a specific entity.",
      `- Kind: ${entity.kind}`,
      `- Name: ${entity.name}`,
      ...(entity.status ? [`- Status: ${entity.status}`] : []),
      "Acknowledge this entity in your first response and help the user with their question about it.",
      "",
    );
  }

  sections.push(
    "## This Conversation",
    "Entities in this conversation:",
    formatConversationEntities(context.conversationEntities),
    "",
    "## Workspace Overview",
    "Projects:",
    formatProjectList(context.workspaceSummary.projects),
    "",
    "Recent decisions:",
    formatDecisionList(context.workspaceSummary.recentDecisions),
    "",
    "Open questions:",
    formatQuestionList(context.workspaceSummary.openQuestions),
    "",
    "## Active Observations",
    "Observations are cross-cutting signals from agents about risks, conflicts, and notable facts.",
    "Factor open observations into your reasoning and responses.",
    formatObservationList(context.workspaceSummary.openObservations),
    "",
    "## UI Components",
    "Render structured component blocks when displaying work items or entity extractions.",
    chatComponentSystemPrompt,
    "",
    "### Rendering PM Suggestions",
    "When invoke_pm_agent returns suggestions, render them as a WorkItemSuggestionList:",
    '```component WorkItemSuggestionList { "title": "Suggested Work Items", "items": [{"kind": "task", "title": "...", "rationale": "..."}] }```',
    "Include all fields from the PM result: kind, title, rationale, project, priority, category.",
    "If a suggestion has a possible_duplicate, include possibleDuplicateId, possibleDuplicateName, possibleDuplicateSimilarity.",
    "",
    "### Rendering Relationship Graphs",
    "When show_relationship_graph returns data, render its result directly as an InlineRelationshipGraph component block.",
    "The tool result contains component and props fields -- pass the props as-is to the component.",
    '```component InlineRelationshipGraph { "title": "Relationships: ...", "nodes": [...], "edges": [...], "focusNodeIds": [...] }```',
    "",
  );

  return sections.join("\n");
}
