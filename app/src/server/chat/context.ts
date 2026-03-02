import { type RecordId, type Surreal } from "surrealdb";
import type { ObservationSummary } from "../../shared/contracts";
import {
  listConversationEntities,
  listWorkspaceOpenQuestions,
  listWorkspaceProjectSummaries,
  listWorkspaceRecentDecisions,
  type ConversationEntity,
  type WorkspaceDecisionSummary,
  type WorkspaceProjectSummary,
  type WorkspaceQuestionSummary,
} from "../graph/queries";
import { listWorkspaceOpenObservations } from "../observation/queries";
import { chatComponentSystemPrompt } from "./chat-component-system-prompt";

export type ChatContext = {
  conversationEntities: ConversationEntity[];
  workspaceSummary: {
    projects: WorkspaceProjectSummary[];
    recentDecisions: WorkspaceDecisionSummary[];
    openQuestions: WorkspaceQuestionSummary[];
    openObservations: ObservationSummary[];
  };
};

type ChatContextLoaders = {
  listConversationEntities: typeof listConversationEntities;
  listWorkspaceProjectSummaries: typeof listWorkspaceProjectSummaries;
  listWorkspaceRecentDecisions: typeof listWorkspaceRecentDecisions;
  listWorkspaceOpenQuestions: typeof listWorkspaceOpenQuestions;
  listWorkspaceOpenObservations: typeof listWorkspaceOpenObservations;
};

export async function buildChatContext(input: {
  surreal: Surreal;
  conversationRecord: RecordId<"conversation", string>;
  workspaceRecord: RecordId<"workspace", string>;
  loaders?: ChatContextLoaders;
  inheritedEntityIds?: RecordId[];
}): Promise<ChatContext> {
  const loaders = input.loaders ?? {
    listConversationEntities,
    listWorkspaceProjectSummaries,
    listWorkspaceRecentDecisions,
    listWorkspaceOpenQuestions,
    listWorkspaceOpenObservations,
  };

  const [conversationEntities, projects, recentDecisions, openQuestions, openObservations] = await Promise.all([
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
  ]);

  return {
    conversationEntities,
    workspaceSummary: {
      projects,
      recentDecisions,
      openQuestions,
      openObservations,
    },
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

export function buildSystemPrompt(context: ChatContext): string {
  return [
    "You are the Orchestrator agent for a workspace-aware project intelligence system.",
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
    "## This Conversation",
    "Entities already extracted from this conversation:",
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
  ].join("\n");
}
