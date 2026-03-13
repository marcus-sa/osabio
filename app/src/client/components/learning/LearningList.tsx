import { useState, useCallback } from "react";
import type { LearningSummary } from "../../../shared/contracts";
import { LearningCard, type LearningCardAction } from "./LearningCard";

type LearningListProps = {
  learnings: LearningSummary[];
  isLoading: boolean;
  onAction: (action: LearningCardAction) => void;
};

/** Renders a list of learning cards with expand/collapse state, or an empty state message. */
export function LearningList({ learnings, isLoading, onAction }: LearningListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((learningId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(learningId)) {
        next.delete(learningId);
      } else {
        next.add(learningId);
      }
      return next;
    });
  }, []);

  if (isLoading) return undefined;

  if (learnings.length === 0) {
    return (
      <div className="learning-list__empty">
        <p>No learnings match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="learning-list">
      {learnings.map((learning) => (
        <LearningCard
          key={learning.id}
          learning={learning}
          isExpanded={expandedIds.has(learning.id)}
          onToggle={() => handleToggle(learning.id)}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
