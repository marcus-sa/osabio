import { createAcknowledgeObservationTool } from "./acknowledge-observation";
import { createCheckConstraintsTool } from "./check-constraints";
import { createConfirmDecisionTool } from "./confirm-decision";
import { createCreateObservationTool } from "./create-observation";
import { createCreateSuggestionTool } from "./create-suggestion";
import { createCreateProvisionalDecisionTool } from "./create-provisional-decision";
import { createCreateQuestionTool } from "./create-question";
import { createGetConversationHistoryTool } from "./get-conversation-history";
import { createGetEntityDetailTool } from "./get-entity-detail";
import { createGetProjectStatusTool } from "./get-project-status";
import { createInvokeAnalyticsAgentTool } from "./invoke-analytics-agent";
import { createInvokePmAgentTool } from "./invoke-pm-agent";
import { createListWorkspaceEntitiesTool } from "./list-workspace-entities";
import { createResolveObservationTool } from "./resolve-observation";
import { createResolveDecisionTool } from "./resolve-decision";
import { createSearchEntitiesTool } from "./search-entities";
import { createShowRelationshipGraphTool } from "./show-relationship-graph";
import type { ChatAgentToolDeps } from "./types";

export function createChatAgentTools(deps: ChatAgentToolDeps) {
  return {
    list_workspace_entities: createListWorkspaceEntitiesTool(deps),
    search_entities: createSearchEntitiesTool(deps),
    get_entity_detail: createGetEntityDetailTool(deps),
    get_project_status: createGetProjectStatusTool(deps),
    get_conversation_history: createGetConversationHistoryTool(deps),
    resolve_decision: createResolveDecisionTool(deps),
    check_constraints: createCheckConstraintsTool(deps),
    create_provisional_decision: createCreateProvisionalDecisionTool(deps),
    create_question: createCreateQuestionTool(deps),
    confirm_decision: createConfirmDecisionTool(deps),
    create_observation: createCreateObservationTool(deps),
    create_suggestion: createCreateSuggestionTool(deps),
    acknowledge_observation: createAcknowledgeObservationTool(deps),
    resolve_observation: createResolveObservationTool(deps),
    invoke_pm_agent: createInvokePmAgentTool(deps),
    invoke_analytics_agent: createInvokeAnalyticsAgentTool(deps),
    show_relationship_graph: createShowRelationshipGraphTool(deps),
  };
}

export const createChatTools = createChatAgentTools;

export type { ChatToolDeps, ChatToolExecutionContext, ChatAgentToolDeps } from "./types";
