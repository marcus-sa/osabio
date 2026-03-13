import type { LearningSummary } from "../../../shared/contracts";
import { AgentChips } from "./AgentChips";
import { computeCardActions, truncateText } from "./learning-card-logic";

export type LearningCardAction = {
  action: string;
  learningId: string;
};

type LearningCardProps = {
  learning: LearningSummary;
  isExpanded: boolean;
  onToggle: () => void;
  onAction: (action: LearningCardAction) => void;
};

/** Format an ISO timestamp to a short locale date string. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Capitalize first character. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function LearningCard({ learning, isExpanded, onToggle, onAction }: LearningCardProps) {
  const actions = computeCardActions(learning.status);
  const displayText = isExpanded ? learning.text : truncateText(learning.text);
  const isTruncated = learning.text.length > 200;

  return (
    <div className={`learning-card learning-card--${learning.status}`}>
      <div className="learning-card__header">
        <div className="learning-card__badges">
          <span className={`learning-card__type-badge learning-card__type-badge--${learning.learningType}`}>
            {capitalize(learning.learningType)}
          </span>
          <span className={`learning-card__priority learning-card__priority--${learning.priority}`}>
            {capitalize(learning.priority)}
          </span>
          <span className="learning-card__source">{capitalize(learning.source)}</span>
        </div>
        <span className="learning-card__timestamp">{formatDate(learning.createdAt)}</span>
      </div>

      <div className="learning-card__body" onClick={isTruncated ? onToggle : undefined}>
        <p className="learning-card__text">{displayText}</p>
        {isTruncated && (
          <button type="button" className="learning-card__expand-btn" onClick={onToggle}>
            {isExpanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>

      <div className="learning-card__footer">
        <AgentChips agents={learning.targetAgents} />

        {learning.status === "pending_approval" && learning.suggestedBy && (
          <span className="learning-card__suggested-by">
            Suggested by: {learning.suggestedBy}
          </span>
        )}

        {learning.status === "pending_approval" && learning.patternConfidence !== undefined && (
          <span className="learning-card__confidence">
            Confidence: {Math.round(learning.patternConfidence * 100)}%
          </span>
        )}

        {learning.status === "dismissed" && learning.dismissedReason && (
          <span className="learning-card__dismissed-info">
            Dismissed: {learning.dismissedReason}
            {learning.dismissedAt && ` (${formatDate(learning.dismissedAt)})`}
          </span>
        )}

        {learning.status === "deactivated" && learning.deactivatedAt && (
          <span className="learning-card__deactivated-info">
            Deactivated: {formatDate(learning.deactivatedAt)}
          </span>
        )}
      </div>

      {actions.length > 0 && (
        <div className="learning-card__actions">
          {actions.map((cardAction) => (
            <button
              key={cardAction.action}
              type="button"
              className={`learning-card__action-btn learning-card__action-btn--${cardAction.action}`}
              onClick={() => onAction({ action: cardAction.action, learningId: learning.id })}
            >
              {cardAction.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
