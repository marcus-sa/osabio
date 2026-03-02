import { createAcknowledgeObservationTool } from "./acknowledge-observation";
import { createCheckConstraintsTool } from "./check-constraints";
import { createConfirmDecisionTool } from "./confirm-decision";
import { createCreateObservationTool } from "./create-observation";
import { createCreateProvisionalDecisionTool } from "./create-provisional-decision";
import { createGetConversationHistoryTool } from "./get-conversation-history";
import { createGetEntityDetailTool } from "./get-entity-detail";
import { createGetProjectStatusTool } from "./get-project-status";
import { createInvokePmAgentTool } from "./invoke-pm-agent";
import { createResolveObservationTool } from "./resolve-observation";
import { createResolveDecisionTool } from "./resolve-decision";
import { createSearchEntitiesTool } from "./search-entities";
import { createShowRelationshipGraphTool } from "./show-relationship-graph";
import type { OrchestratorToolDeps } from "./types";

export function createOrchestratorTools(deps: OrchestratorToolDeps) {
  return {
    search_entities: createSearchEntitiesTool(deps),
    get_entity_detail: createGetEntityDetailTool(deps),
    get_project_status: createGetProjectStatusTool(deps),
    get_conversation_history: createGetConversationHistoryTool(deps),
    resolve_decision: createResolveDecisionTool(deps),
    check_constraints: createCheckConstraintsTool(deps),
    create_provisional_decision: createCreateProvisionalDecisionTool(deps),
    confirm_decision: createConfirmDecisionTool(deps),
    create_observation: createCreateObservationTool(deps),
    acknowledge_observation: createAcknowledgeObservationTool(deps),
    resolve_observation: createResolveObservationTool(deps),
    invoke_pm_agent: createInvokePmAgentTool(deps),
    show_relationship_graph: createShowRelationshipGraphTool(deps),
  };
}

export const createChatTools = createOrchestratorTools;

export type { ChatToolDeps, ChatToolExecutionContext, OrchestratorToolDeps } from "./types";
