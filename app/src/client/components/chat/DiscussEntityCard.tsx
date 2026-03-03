import type { DiscussEntitySummary, EntityKind } from "../../../shared/contracts";
import { EntityBadge } from "../graph/EntityBadge";

export function DiscussEntityCard({ entity }: { entity: DiscussEntitySummary }) {
  return (
    <div className="discuss-entity-card">
      <EntityBadge kind={entity.kind as EntityKind} />
      <span className="discuss-entity-name">{entity.name}</span>
      {entity.status ? (
        <span className="discuss-entity-status">{entity.status}</span>
      ) : undefined}
    </div>
  );
}
