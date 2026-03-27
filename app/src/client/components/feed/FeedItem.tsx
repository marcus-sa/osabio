import { useState } from "react";
import type { GovernanceFeedAction, GovernanceFeedItem, EvidenceRefDetail, EntityKind } from "../../../shared/contracts";
import { EntityBadge } from "../ui/entity-badge";
import { CategoryBadge } from "../graph/CategoryBadge";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

function EvidenceRefRow({ detail }: { detail: EvidenceRefDetail }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <EntityBadge kind={detail.entityKind as EntityKind} />
      <span className="text-foreground">{detail.title}</span>
      {detail.verified ? (
        <Badge variant="outline" className="text-[0.55rem] text-green-600">verified</Badge>
      ) : (
        <span className="flex items-center gap-1">
          <Badge variant="destructive" className="text-[0.55rem]">failed</Badge>
          {detail.failureReason ? (
            <span className="text-destructive text-[0.6rem]">{detail.failureReason}</span>
          ) : undefined}
        </span>
      )}
    </div>
  );
}

export function FeedItem({
  item,
  onAction,
}: {
  item: GovernanceFeedItem;
  onAction: (action: GovernanceFeedAction) => void;
}) {
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <EntityBadge kind={item.entityKind} />
          {item.category ? <CategoryBadge category={item.category} /> : undefined}
          {item.priority ? (
            <Badge variant="outline" className="text-[0.6rem]">{item.priority}</Badge>
          ) : undefined}
        </div>
        {item.status ? (
          <Badge variant="secondary" className="text-[0.6rem]">{item.status}</Badge>
        ) : undefined}
      </div>

      <p className="text-sm font-medium text-foreground">{item.entityName}</p>
      <p className="text-xs text-muted-foreground">{item.reason}</p>

      {item.conflictTarget ? (
        <p className="text-xs text-destructive">
          Conflicts with: <strong>{item.conflictTarget.entityName}</strong>
        </p>
      ) : undefined}

      {item.project ? (
        <p className="text-xs text-entity-project-fg">{item.project}</p>
      ) : undefined}

      {item.evidenceSummary ? (
        <Badge
          variant="outline"
          className={`text-[0.6rem] w-fit${item.evidenceRefs?.length ? " cursor-pointer" : ""}`}
          onClick={item.evidenceRefs?.length ? () => setEvidenceExpanded((prev) => !prev) : undefined}
        >
          {item.evidenceSummary.verified}/{item.evidenceSummary.total} verified
        </Badge>
      ) : undefined}

      {evidenceExpanded && item.evidenceRefs?.length ? (
        <div className="flex flex-col gap-1 pl-1">
          {item.evidenceRefs.map((ref) => (
            <EvidenceRefRow key={ref.entityId} detail={ref} />
          ))}
        </div>
      ) : undefined}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {item.actions.map((action) => (
          <Button
            key={action.action}
            variant={action.action === "dismiss" || action.action === "abort" ? "destructive" : "outline"}
            size="xs"
            onClick={() => onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
