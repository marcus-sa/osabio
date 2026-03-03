import { createCreateObservationTool } from "../../chat/tools/create-observation";
import { createGetProjectStatusTool } from "../../chat/tools/get-project-status";
import { createSearchEntitiesTool } from "../../chat/tools/search-entities";
import type { ChatToolDeps } from "../../chat/tools/types";
import { createCreateWorkItemTool } from "../../chat/tools/create-work-item";
import { createSuggestWorkItemsTool } from "../../chat/tools/suggest-work-items";

export function createPmTools(deps: ChatToolDeps) {
  return {
    search_entities: createSearchEntitiesTool(deps),
    get_project_status: createGetProjectStatusTool(deps),
    create_observation: createCreateObservationTool(deps),
    suggest_work_items: createSuggestWorkItemsTool(deps),
    create_work_item: createCreateWorkItemTool(deps),
  };
}
