import { createCreateObservationTool } from "../../tools/create-observation";
import { createCreateSuggestionTool } from "../../tools/create-suggestion";
import { createGetProjectStatusTool } from "../../tools/get-project-status";
import { createSearchEntitiesTool } from "../../tools/search-entities";
import type { ChatToolDeps } from "../../tools/types";
import { createCreateWorkItemTool } from "../../tools/create-work-item";
import { createEditWorkItemTool } from "../../tools/edit-work-item";
import { createMoveItemsToProjectTool } from "../../tools/move-items-to-project";
import { createSuggestWorkItemsTool } from "../../tools/suggest-work-items";

export function createPmTools(deps: ChatToolDeps) {
  return {
    search_entities: createSearchEntitiesTool(deps),
    get_project_status: createGetProjectStatusTool(deps),
    create_observation: createCreateObservationTool(deps),
    create_suggestion: createCreateSuggestionTool(deps),
    suggest_work_items: createSuggestWorkItemsTool(deps),
    create_work_item: createCreateWorkItemTool(deps),
    edit_work_item: createEditWorkItemTool(deps),
    move_items_to_project: createMoveItemsToProjectTool(deps),
  };
}
