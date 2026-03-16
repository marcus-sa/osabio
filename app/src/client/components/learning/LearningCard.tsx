import type { LearningSummary } from "../../../shared/contracts";
import { AgentChips } from "./AgentChips";
import { capitalize, computeCardActions, truncateText, TRUNCATION_THRESHOLD } from "./learning-card-logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

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

const STATUS_BORDER: Record<string, string> = {
  active: "border-l-entity-feature",
  pending_approval: "border-l-entity-decision",
  dismissed: "border-l-muted-foreground",
  deactivated: "border-l-muted-foreground",
};

export function LearningCard({ learning, isExpanded, onToggle, onAction }: LearningCardProps) {
  const actions = computeCardActions(learning.status);
  const displayText = isExpanded ? learning.text : truncateText(learning.text);
  const isTruncated = learning.text.length > TRUNCATION_THRESHOLD;

  return (
    <div className={cn(
      "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-card/80",
      "border-l-3",
      STATUS_BORDER[learning.status] ?? "border-l-border",
    )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="text-[0.65rem]">
            {capitalize(learning.learningType)}
          </Badge>
          <Badge variant="outline" className="text-[0.65rem]">
            {capitalize(learning.priority)}
          </Badge>
          <span className="text-[0.65rem] text-muted-foreground">{capitalize(learning.source)}</span>
        </div>
        <span className="shrink-0 text-[0.65rem] text-muted-foreground">{formatDate(learning.createdAt)}</span>
      </div>

      {/* Body */}
      <div className={cn("text-xs leading-relaxed text-card-foreground", isTruncated && "cursor-pointer")} onClick={isTruncated ? onToggle : undefined}>
        <p className="whitespace-pre-wrap">{displayText}</p>
        {isTruncated && (
          <Button variant="link" size="xs" className="mt-1 h-auto p-0 text-[0.7rem]" onClick={onToggle}>
            {isExpanded ? "Show less" : "Show more"}
          </Button>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-2 text-[0.65rem] text-muted-foreground">
        <AgentChips agents={learning.targetAgents} />

        {learning.status === "pending_approval" && learning.suggestedBy && (
          <span>Suggested by: {learning.suggestedBy}</span>
        )}

        {learning.status === "pending_approval" && learning.patternConfidence !== undefined && (
          <span>Confidence: {Math.round(learning.patternConfidence * 100)}%</span>
        )}

        {learning.status === "dismissed" && learning.dismissedReason && (
          <span>
            Dismissed: {learning.dismissedReason}
            {learning.dismissedAt && ` (${formatDate(learning.dismissedAt)})`}
          </span>
        )}

        {learning.status === "deactivated" && learning.deactivatedAt && (
          <span>Deactivated: {formatDate(learning.deactivatedAt)}</span>
        )}
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex gap-1.5 border-t border-border pt-2">
          {actions.map((cardAction) => (
            <Button
              key={cardAction.action}
              variant={cardAction.action === "dismiss" || cardAction.action === "deactivate" ? "destructive" : "outline"}
              size="xs"
              onClick={() => onAction({ action: cardAction.action, learningId: learning.id })}
            >
              {cardAction.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
