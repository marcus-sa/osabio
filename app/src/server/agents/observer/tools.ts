/**
 * Observer agent tools: composes existing chat tools for the observer agent.
 *
 * The observer uses a subset of tools focused on reading context and creating observations.
 */

import { createCreateObservationTool } from "../../tools/create-observation";
import { createGetEntityDetailTool } from "../../tools/get-entity-detail";
import { createSearchEntitiesTool } from "../../tools/search-entities";
import type { ChatToolDeps } from "../../tools/types";

export function createObserverTools(deps: ChatToolDeps) {
  return {
    search_entities: createSearchEntitiesTool(deps),
    get_entity_detail: createGetEntityDetailTool(deps),
    create_observation: createCreateObservationTool(deps),
  };
}
