import type { EntityDetailResponse } from "../../../shared/contracts";
import { EntityBadge } from "../ui/entity-badge";

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
    return <p className="px-4 text-xs text-muted-foreground">No relationships found.</p>;
  }

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Relationships</h4>
      {Array.from(groups.entries()).map(([key, items]) => {
        const direction = items[0].direction;
        const kind = items[0].relationKind;
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">{formatGroupLabel(kind, direction)}</span>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-foreground transition-colors hover:bg-hover"
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
