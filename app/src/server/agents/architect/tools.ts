import { createCheckConstraintsTool } from "../../chat/tools/check-constraints";
import { createCreateObservationTool } from "../../chat/tools/create-observation";
import { createCreateProvisionalDecisionTool } from "../../chat/tools/create-provisional-decision";
import { createCreateQuestionTool } from "../../chat/tools/create-question";
import { createCreateSuggestionTool } from "../../chat/tools/create-suggestion";
import { createCreateWorkItemTool } from "../../chat/tools/create-work-item";
import { createGetEntityDetailTool } from "../../chat/tools/get-entity-detail";
import { createGetProjectStatusTool } from "../../chat/tools/get-project-status";
import { createSearchEntitiesTool } from "../../chat/tools/search-entities";
import { createSuggestWorkItemsTool } from "../../chat/tools/suggest-work-items";
import { createUpdateQuestionTool } from "../../chat/tools/update-question";
import type { ChatToolDeps } from "../../chat/tools/types";

export function createArchitectTools(deps: ChatToolDeps) {
  return {
    search_entities: createSearchEntitiesTool(deps),
    get_entity_detail: createGetEntityDetailTool(deps),
    get_project_status: createGetProjectStatusTool(deps),
    check_constraints: createCheckConstraintsTool(deps),
    create_provisional_decision: createCreateProvisionalDecisionTool(deps),
    create_question: createCreateQuestionTool(deps),
    create_observation: createCreateObservationTool(deps),
    suggest_work_items: createSuggestWorkItemsTool(deps),
    create_work_item: createCreateWorkItemTool(deps),
    create_suggestion: createCreateSuggestionTool(deps),
    update_question: createUpdateQuestionTool(deps),
  };
}
