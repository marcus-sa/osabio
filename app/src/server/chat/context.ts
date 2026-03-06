import { type RecordId, type Surreal } from "surrealdb";
import type { ObservationSummary, OnboardingState, SuggestionSummary } from "../../shared/contracts";
import {
  listConversationEntities,
  listWorkspaceOpenQuestions,
  listWorkspaceProjectSummaries,
  listWorkspaceRecentDecisions,
  readEntityName,
  searchEntitiesByEmbedding,
  type ConversationEntity,
  type RankedEntity,
  type WorkspaceDecisionSummary,
  type WorkspaceProjectSummary,
  type WorkspaceQuestionSummary,
} from "../graph/queries";
import { listWorkspaceOpenObservations } from "../observation/queries";
import { listWorkspacePendingSuggestions } from "../suggestion/queries";
import { loadOnboardingSummary } from "../onboarding/onboarding-state";
import type { GraphEntityRecord } from "../extraction/types";

export type DiscussedEntityContext = {
  kind: string;
  name: string;
  status?: string;
};

export type ChatContext = {
  conversationEntities: ConversationEntity[];
  relevantEntities?: RankedEntity[];
  workspaceDescription?: string;
  workspaceSummary: {
    projects: WorkspaceProjectSummary[];
    recentDecisions: WorkspaceDecisionSummary[];
    openQuestions: WorkspaceQuestionSummary[];
    openObservations: ObservationSummary[];
    pendingSuggestions: SuggestionSummary[];
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
  listWorkspacePendingSuggestions: typeof listWorkspacePendingSuggestions;
  loadOnboardingSummary: typeof loadOnboardingSummary;
};

export async function buildChatContext(input: {
  surreal: Surreal;
  conversationRecord: RecordId<"conversation", string>;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceDescription?: string;
  loaders?: ChatContextLoaders;
  inheritedEntityIds?: RecordId[];
  discussesRecord?: RecordId;
  userMessageEmbedding?: number[];
}): Promise<ChatContext> {
  const loaders = input.loaders ?? {
    listConversationEntities,
    listWorkspaceProjectSummaries,
    listWorkspaceRecentDecisions,
    listWorkspaceOpenQuestions,
    listWorkspaceOpenObservations,
    listWorkspacePendingSuggestions,
    loadOnboardingSummary,
  };

  const [conversationEntities, projects, recentDecisions, openQuestions, openObservations, pendingSuggestions, onboardingSummary] = await Promise.all([
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
    loaders.listWorkspacePendingSuggestions({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 10,
    }),
    loaders.loadOnboardingSummary(input.surreal, input.workspaceRecord),
  ]);

  // Cross-conversation entity enrichment: find workspace entities relevant to the user's message
  let relevantEntities: RankedEntity[] | undefined;
  if (input.userMessageEmbedding) {
    const queryEmbedding = input.userMessageEmbedding;
    const conversationEntityIds = new Set(
      conversationEntities.map((e) => e.id),
    );
    const ranked = await searchEntitiesByEmbedding({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      queryEmbedding,
      limit: 15,
    });
    const filtered = ranked.filter((e) => !conversationEntityIds.has(e.id));
    if (filtered.length > 0) {
      relevantEntities = filtered.slice(0, 10);
    }
  }

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
    relevantEntities,
    ...(input.workspaceDescription ? { workspaceDescription: input.workspaceDescription } : {}),
    workspaceSummary: {
      projects,
      recentDecisions,
      openQuestions,
      openObservations,
      pendingSuggestions,
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


function formatRelevantEntities(entities: RankedEntity[]): string {
  return entities
    .map((e) => `- ${e.kind}: ${e.name} (relevance ${e.score.toFixed(2)})`)
    .join("\n");
}

function formatWorkspaceSummary(context: ChatContext): string {
  const { projects, recentDecisions, openQuestions, openObservations, pendingSuggestions } = context.workspaceSummary;

  const lines: string[] = [];

  // Projects: keep names since they're needed for routing
  if (projects.length === 0) {
    lines.push("- Projects: none");
  } else {
    lines.push(`- Projects: ${projects.map((p) => p.name).join(", ")}`);
  }

  // Decisions: count by status
  if (recentDecisions.length === 0) {
    lines.push("- Decisions: none");
  } else {
    const statusCounts = new Map<string, number>();
    for (const d of recentDecisions) {
      statusCounts.set(d.status, (statusCounts.get(d.status) ?? 0) + 1);
    }
    const breakdown = [...statusCounts.entries()].map(([s, c]) => `${c} ${s}`).join(", ");
    lines.push(`- Decisions: ${recentDecisions.length} (${breakdown})`);
  }

  // Questions: just count
  lines.push(`- Open questions: ${openQuestions.length}`);

  // Observations: count by severity
  if (openObservations.length === 0) {
    lines.push("- Observations: none");
  } else {
    const severityCounts = new Map<string, number>();
    for (const o of openObservations) {
      severityCounts.set(o.severity, (severityCounts.get(o.severity) ?? 0) + 1);
    }
    const breakdown = [...severityCounts.entries()].map(([s, c]) => `${c} ${s}`).join(", ");
    lines.push(`- Observations: ${openObservations.length} (${breakdown})`);
  }

  // Suggestions: count by category
  if (pendingSuggestions.length === 0) {
    lines.push("- Suggestions: none");
  } else {
    const categoryCounts = new Map<string, number>();
    for (const s of pendingSuggestions) {
      categoryCounts.set(s.category, (categoryCounts.get(s.category) ?? 0) + 1);
    }
    const breakdown = [...categoryCounts.entries()].map(([c, n]) => `${n} ${c}`).join(", ");
    lines.push(`- Suggestions: ${pendingSuggestions.length} (${breakdown})`);
  }

  return lines.join("\n");
}

type SystemPromptOptions = {
  isOnboarding?: boolean;
  onboardingState?: OnboardingState;
};

export function buildSystemPrompt(context: ChatContext, options?: SystemPromptOptions): string {
  const sections: string[] = [
    "You are the Chat agent for Brain — an agent-native business operating system.",
    "You are a **thin orchestrator**: your job is to decide which tools and subagents to invoke, control sequencing, and synthesize user-facing responses.",
    "",
    "## Core Behavior: Act, Don't Describe",
    "When the user describes work to be done, **use your tools to create entities in the graph immediately**. Do NOT:",
    "- List what you *could* do and ask for permission",
    "- Write prose descriptions of features/tasks without creating them",
    "- Ask \"would you like me to help break these down?\" — just break them down",
    "- Explain that \"the data model already has X\" — if the user describes structure, they mean THEIR domain, not Brain's internals",
    "- Suggest generic next steps without executing them",
    "",
    "When the user says \"yes\" to creating work items, dispatch the PM agent or use create_work_item. When they describe a decision, use create_provisional_decision. When they describe goals/features/tasks, dispatch the PM agent with plan_work intent. Your value is in *doing*, not *describing what you could do*.",
    "",
    "## Domain Separation",
    "The user's business — whatever they are building, planning, or discussing — is NOT Brain itself.",
    "Even if the user's domain uses identical terms (entities, graphs, tasks, features, hierarchy), treat ALL user input as business content to capture in the graph.",
    "When the user says \"I want entities: X → Y → Z\" or describes a hierarchy, they are describing THEIR domain model — dispatch the PM agent to plan it as work items.",
    "Never explain Brain's data model, architecture, or current entity types unless the user explicitly asks \"how does Brain work?\" or similar.",
    "",
    "## What This System Is",
    "Brain replaces the human as shared memory between agents. Instead of re-explaining context every session, agents read from and write to a knowledge graph. The graph captures every decision, constraint, task, and relationship — so any agent (or the human) can query it and get full context instantly.",
    "",
    "The user sets strategy and constraints. Agents execute. The graph is shared memory. The feed is where the user governs (reviews pending decisions, resolves conflicts, approves work).",
    "",
    "## Data Model (Internal Reference)",
    "This section describes how YOU store data. Do not explain this to the user — just use it to pick the right tools.",
    "The graph has these entity types:",
    "",
    "**Work hierarchy:** Project → Feature → Task",
    "- **Project**: a named initiative with status, description, and embedding. Linked to workspace via `has_project` edge.",
    "- **Feature**: a capability or deliverable within a project. Linked via `has_feature` edge.",
    "- **Task**: an actionable work item. Can belong to a feature (`has_task`) or directly to a project (`belongs_to`). Has status (open/done/etc), priority, category, optional owner and deadline.",
    "",
    "**Cross-cutting entities** (can attach to any level via `belongs_to`):",
    "- **Decision**: a choice that was made. Status lifecycle: extracted → proposed → provisional → confirmed → superseded. Can conflict with other decisions (`conflicts_with` edge).",
    "- **Question**: an open question requiring a choice. Not for informational queries — only for pending decisions.",
    "- **Observation**: a lightweight signal (info/warning/conflict) written by agents. Lifecycle: open → acknowledged → resolved. Used for cross-project intelligence (\"this billing decision conflicts with your auth rate limiting\").",
    "- **Suggestion**: a proactive agent-to-human proposal. Categories: optimization, risk, opportunity, conflict, missing, pivot. Lifecycle: pending → accepted/dismissed/deferred → converted. Built on accumulated observations via `suggestion_evidence` edges. Use `create_suggestion` for actionable proposals with rationale.",
    "",
    "**Other entities:** Person (with ownership edges), Meeting, Document, Git Commit, Pull Request.",
    "",
    "**Key relationships (graph edges):**",
    "- `has_project`: workspace → project",
    "- `has_feature`: project → feature",
    "- `has_task`: feature → task",
    "- `belongs_to`: task|decision|question → feature|project",
    "- `depends_on`: task|feature → task|feature (blocks/needs/soft)",
    "- `conflicts_with`: decision|feature ↔ decision|feature",
    "- `owns`: person → task|project|feature",
    "- `observes`: observation → project|feature|task|decision|question",
    "- `suggests_for`: suggestion → project|feature|task|question|decision",
    "- `suggestion_evidence`: suggestion → observation|decision|task|feature|project|question|person|workspace",
    "- `superseded_by`: decision → decision",
    "",
    "## How Data Enters the Graph",
    "1. **Agent tools** (primary path): you and other agents write structured data (decisions, observations, work items) directly to the graph via tools. When the user mentions entities, projects, tasks, or decisions, use your tools to create them — there is no automatic extraction.",
    "2. **User acceptance**: when you suggest work items, the user can accept them into the graph with one click.",
    "",
    "When the user describes work, use your tools to create the actual entities.",
    "",
    "## Architecture: Graph as Communication Bus",
    "All agent-to-agent communication happens through the knowledge graph. You do NOT pass data between agents directly.",
    "- Each agent reads the graph for context it needs.",
    "- Each agent writes its outputs (entities, observations, decisions) directly to the graph.",
    "- Subsequent agents read the graph and see prior agents' work.",
    "- You synthesize the user-facing response from graph state and tool results.",
    "",
    "Never assume data from other workspaces.",
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
      const topicList = context.workspaceDescription
        ? "projects and product areas, people, decisions, tools, bottlenecks."
        : "business/venture, projects, people, decisions, tools, bottlenecks.";
      sections.push(
        "## Onboarding Mode",
        "You are onboarding a newly created workspace.",
        ...(context.workspaceDescription
          ? [`The workspace is described as: "${context.workspaceDescription}"`, "Do not ask what the business is — focus on discovering projects and product areas within it."]
          : [
            "When the workspace has no description yet and no existing projects, the user's first statements likely describe the business/domain context, NOT specific projects.",
            "Ask the user to clarify whether they are describing the overall workspace or naming specific projects before creating project entities.",
            "Only dispatch PM agent with plan_work intent when the user explicitly names specific projects or product areas.",
          ]),
        "Ask one natural question at a time like a smart colleague, never as a form.",
        `Cover these topics over 5-7 turns: ${topicList}`,
        "Keep acknowledgment to one sentence max. Ask exactly one concrete follow-up question.",
        "",
        "When the user describes their workspace, create entities directly:",
        "- Projects → dispatch PM agent with plan_work intent (only after intent is clear — see above)",
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
    "## When to Create Suggestions",
    "Suggestions are proactive agent-to-human proposals. Use `create_suggestion` when you or a subagent notice:",
    "- An optimization opportunity (\"task X could be merged with Y\")",
    "- A risk or missing element (\"no task covers deployment rollback\")",
    "- A conflict between entities (\"decision A contradicts decision B\")",
    "- A pivot or strategic opportunity based on accumulated signals",
    "Observations are agent-to-agent signals (\"I noticed X\"). Suggestions are agent-to-human proposals (\"You should do Y, because of observations A, B, C\").",
    "Link `evidence_entity_ids` to the observations and entities that support the rationale.",
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
  );

  if (context.relevantEntities && context.relevantEntities.length > 0) {
    sections.push(
      "## Related Context",
      "Workspace entities relevant to this message (from other conversations):",
      formatRelevantEntities(context.relevantEntities),
      "",
    );
  }

  sections.push(
    "## Workspace Overview",
    "Use list_workspace_entities to retrieve full entity listings. Summary:",
    formatWorkspaceSummary(context),
    "",
    "## Tool Results",
    "Tool results are rendered directly in the chat UI as typed components.",
    "When mentioning entities in prose, use markdown links with #entity/ prefix (e.g. [Task Name](#entity/task:id)).",
    "",
  );

  return sections.join("\n");
}
