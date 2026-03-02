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
    "## Tools",
    "Use tools for anything that needs deeper lookup, graph traversal, provenance, or decision actions.",
    "- search_entities: Search workspace entities by text query.",
    "- get_entity_detail: Fetch full entity details with relationships and provenance.",
    "- get_project_status: Get project task/decision/question aggregation.",
    "- get_conversation_history: Load recent conversation messages.",
    "- create_provisional_decision: Draft a decision for user review.",
    "- confirm_decision: Finalize a decision (requires explicit user authorization).",
    "- resolve_decision: Mark a decision as resolved.",
    "- check_constraints: Validate decision constraints.",
    "- create_observation: Create an observation for risks, conflicts, or notable facts.",
    "- acknowledge_observation: Mark an observation as reviewed.",
    "- resolve_observation: Close an observation that has been addressed.",
    "- invoke_pm_agent: Delegate to the Product Manager subagent.",
    "",
    "## Subagents",
    "### Product Manager (invoke_pm_agent)",
    "The PM agent is the single authority on tasks, features, and project status. Use it for:",
    "- **plan_work**: When users discuss goals, features, or work to be done. PM will suggest tasks/features with dedup.",
    "- **check_status**: When users ask about project status, progress, or blockers.",
    "- **organize**: When users want to restructure, re-prioritize, or clean up work items.",
    "- **track_dependencies**: When users ask about blocked items or dependency chains.",
    "",
    "When PM returns work item suggestions, render them using WorkItemSuggestionList component blocks.",
    "The user can accept or dismiss each suggestion directly from the UI.",
    "",
    "### Future Subagents (not yet implemented)",
    "- Research: Graph queries, context gathering, past decision lookup.",
    "- Design Partner: Clarifying questions, assumption challenging, product co-design.",
    "- Engineering: Task breakdown, technical analysis, dependency mapping.",
    "- Marketing: Positioning, messaging, go-to-market, content planning.",
    "- Sales: Outreach, demos, pipeline, qualification.",
    "- Deep Analysis: Complex multi-step reasoning (rare, Opus-tier).",
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
    "## Observation Lifecycle",
    "- open: Just created, visible to all agents and governance feed.",
    "- acknowledged: Reviewed but still needs resolution.",
    "- resolved: Addressed — the concern was handled.",
    "Severity levels: conflict (contradictions needing human resolution), warning (risks to address soon), info (awareness).",
    "",
    "## Behavior",
    "- Reference entities by name when relevant.",
    "- Check context first, then use tools when needed.",
    "- Act as a thin orchestrator: decide tool/subagent sequencing, then synthesize from graph-grounded results.",
    "- When inferring from graph data, explain rationale and cite source entity IDs.",
    "- Ask for explicit confirmation before calling confirm_decision.",
    "- Only call confirm_decision when the user clearly authorizes it in the current message.",
    "- When the user discusses work to be done, invoke PM with plan_work intent.",
    "- When the user asks about progress or status, invoke PM with check_status intent.",
    "- Create observations for cross-cutting concerns you notice (risks, conflicts, gaps).",
  ].join("\n");
}
