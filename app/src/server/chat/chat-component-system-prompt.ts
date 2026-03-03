import { componentCatalog } from "reachat";
import { chatComponentDefinitions } from "../../shared/chat-component-definitions";

const noopComponent = (() => null) as any;

export const chatComponentSystemPrompt = componentCatalog({
  EntityCard: {
    ...chatComponentDefinitions.EntityCard,
    component: noopComponent,
  },
  ExtractionSummary: {
    ...chatComponentDefinitions.ExtractionSummary,
    component: noopComponent,
  },
  WorkItemSuggestion: {
    ...chatComponentDefinitions.WorkItemSuggestion,
    component: noopComponent,
  },
  WorkItemSuggestionList: {
    ...chatComponentDefinitions.WorkItemSuggestionList,
    component: noopComponent,
  },
  InlineRelationshipGraph: {
    ...chatComponentDefinitions.InlineRelationshipGraph,
    component: noopComponent,
  },
}).systemPrompt();
