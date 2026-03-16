import type { GovernanceFeedAction, GovernanceFeedItem } from "../../../shared/contracts";
import { EntityBadge } from "../ui/entity-badge";
import { CategoryBadge } from "../graph/CategoryBadge";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function FeedItem({
  item,
  onAction,
}: {
  item: GovernanceFeedItem;
  onAction: (action: GovernanceFeedAction) => void;
}) {
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
