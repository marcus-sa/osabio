/**
 * Pure functions driving LearningCard, LearningList, and AgentChips components.
 *
 * All domain logic for card rendering lives here -- no React imports,
 * no side effects, fully testable.
 */
import { KNOWN_LEARNING_TARGET_AGENTS } from "../../../shared/contracts";
import type { LearningSummary, LearningStatus } from "../../../shared/contracts";

/** Number of characters before text gets truncated on a card. */
export const TRUNCATION_THRESHOLD = 200;

/** Map of agent value to human-readable label for fast lookup. */
const AGENT_LABEL_MAP = new Map<string, string>(
  KNOWN_LEARNING_TARGET_AGENTS.map((agent) => [agent.value, agent.label]),
);

/** Resolve a single agent value to its human-readable label. Unknown values pass through. */
export function resolveAgentLabel(agentValue: string): string {
  return AGENT_LABEL_MAP.get(agentValue) ?? agentValue;
}

/** Resolve an array of agent values to labels. Empty array returns ["All agents"]. */
export function resolveAgentLabels(agents: string[]): string[] {
  if (agents.length === 0) return ["All agents"];
  return agents.map(resolveAgentLabel);
}

export type CardAction = {
  action: string;
  label: string;
};

/** Determine which action buttons to show based on learning status. */
export function computeCardActions(status: LearningStatus): CardAction[] {
  switch (status) {
    case "active":
      return [
        { action: "edit", label: "Edit" },
        { action: "deactivate", label: "Deactivate" },
      ];
    case "pending_approval":
      return [
        { action: "approve", label: "Approve" },
        { action: "dismiss", label: "Dismiss" },
      ];
    default:
      return [];
  }
}

/** Truncate text beyond the threshold, appending ellipsis. */
export function truncateText(text: string): string {
  if (text.length <= TRUNCATION_THRESHOLD) return text;
  return text.slice(0, TRUNCATION_THRESHOLD) + "...";
}

/** Filter learnings to only those matching a given status. */
export function filterLearningsByStatus(
  learnings: LearningSummary[],
  status: LearningStatus,
): LearningSummary[] {
  return learnings.filter((learning) => learning.status === status);
}
