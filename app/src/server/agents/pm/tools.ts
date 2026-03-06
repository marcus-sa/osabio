import { createCreateObservationTool } from "../../chat/tools/create-observation";
import { createCreateSuggestionTool } from "../../chat/tools/create-suggestion";
import { createGetProjectStatusTool } from "../../chat/tools/get-project-status";
import { createSearchEntitiesTool } from "../../chat/tools/search-entities";
import type { ChatToolDeps } from "../../chat/tools/types";
import { createCreateWorkItemTool } from "../../chat/tools/create-work-item";
import { createMoveItemsToProjectTool } from "../../chat/tools/move-items-to-project";
import { createSuggestWorkItemsTool } from "../../chat/tools/suggest-work-items";

export function createPmTools(deps: ChatToolDeps) {
  return {
    search_entities: createSearchEntitiesTool(deps),
    get_project_status: createGetProjectStatusTool(deps),
    create_observation: createCreateObservationTool(deps),
    create_suggestion: createCreateSuggestionTool(deps),
    suggest_work_items: createSuggestWorkItemsTool(deps),
    create_work_item: createCreateWorkItemTool(deps),
    move_items_to_project: createMoveItemsToProjectTool(deps),
  };
}
