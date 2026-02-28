import type { EntityDetailResponse } from "../../../shared/contracts";
import { EntityBadge } from "./EntityBadge";

type Relationship = EntityDetailResponse["relationships"][number];

type GroupedRelationships = Map<string, Relationship[]>;

function groupByRelationKind(relationships: Relationship[]): GroupedRelationships {
  const groups = new Map<string, Relationship[]>();
  for (const rel of relationships) {
    const key = `${rel.relationKind}:${rel.direction}`;
    const group = groups.get(key);
    if (group) {
      group.push(rel);
    } else {
      groups.set(key, [rel]);
    }
  }
  return groups;
}

function formatGroupLabel(kind: string, direction: "incoming" | "outgoing"): string {
  const label = kind.replace(/_/g, " ");
  return direction === "outgoing" ? label : `${label} (incoming)`;
}

export function RelationshipList({
  relationships,
  onEntityClick,
}: {
  relationships: Relationship[];
  onEntityClick: (entityId: string) => void;
}) {
  const groups = groupByRelationKind(relationships);

  if (groups.size === 0) {
    return <p className="entity-detail-meta">No relationships found.</p>;
  }

  return (
    <div className="entity-detail-section">
      <h4>Relationships</h4>
      {Array.from(groups.entries()).map(([key, items]) => {
        const direction = items[0].direction;
        const kind = items[0].relationKind;
        return (
          <div key={key} className="relationship-group">
            <span className="relationship-group-label">{formatGroupLabel(kind, direction)}</span>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="relationship-item"
                onClick={() => onEntityClick(`${item.kind}:${item.id}`)}
              >
                <EntityBadge kind={item.kind} />
                {item.name}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
