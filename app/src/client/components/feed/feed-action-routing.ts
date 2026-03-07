import type { GovernanceFeedAction, GovernanceFeedItem } from "../../../shared/contracts";

/**
 * Extract the session ID from an agent_session entity ID.
 * Entity IDs follow the pattern "agent_session:<sessionId>".
 * Returns undefined for non-agent_session entities.
 */
export function extractSessionIdFromEntityId(entityId: string): string | undefined {
  const prefix = "agent_session:";
  if (!entityId.startsWith(prefix)) return undefined;
  return entityId.slice(prefix.length);
}

// --- Action classification ---

export type FeedActionClassification =
  | { type: "navigate_review"; sessionId: string }
  | { type: "abort_session"; sessionId: string }
  | { type: "navigate_discuss" }
  | { type: "entity_action" };

/**
 * Classify a feed action into a routing decision.
 *
 * - "review" on agent_session -> navigate to review view
 * - "abort" on agent_session -> call abort endpoint
 * - "discuss" on any entity -> navigate to discuss in chat
 * - everything else -> entity action API call
 */
export function classifyFeedAction(
  item: GovernanceFeedItem,
  action: GovernanceFeedAction,
): FeedActionClassification {
  if (action.action === "discuss") {
    return { type: "navigate_discuss" };
  }

  const sessionId = extractSessionIdFromEntityId(item.entityId);

  if (sessionId && action.action === "review") {
    return { type: "navigate_review", sessionId };
  }

  if (sessionId && action.action === "abort") {
    return { type: "abort_session", sessionId };
  }

  return { type: "entity_action" };
}
