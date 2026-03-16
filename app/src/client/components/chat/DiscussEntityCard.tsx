import type { DiscussEntitySummary, EntityKind } from "../../../shared/contracts";
import { EntityBadge } from "../ui/entity-badge";
import { StatusBadge } from "../ui/status-badge";

export function DiscussEntityCard({ entity }: { entity: DiscussEntitySummary }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
      <EntityBadge kind={entity.kind as EntityKind} />
      <span className="text-sm font-medium text-foreground">{entity.name}</span>
      {entity.status ? (
        <StatusBadge status={entity.status} />
      ) : undefined}
    </div>
  );
}
