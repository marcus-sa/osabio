import { useState } from "react";
import type { EntityKind } from "../../../shared/contracts";
import { Button } from "../ui/button";

type SourceRef = {
  tb: string;
  id: string;
};

type DescriptionEntryData = {
  text: string;
  source?: SourceRef;
  created_at: string;
};

const DESCRIBABLE_KINDS = new Set<EntityKind>(["project", "feature", "task"]);

function formatSourceRef(ref: SourceRef): string {
  return `${ref.tb}:${ref.id}`;
}

export function DescriptionSection({
  data,
  kind,
  onEntityClick,
}: {
  data: Record<string, unknown>;
  kind: EntityKind;
  onEntityClick: (entityId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!DESCRIBABLE_KINDS.has(kind)) {
    return undefined;
  }

  const description = data.description as string | undefined;
  const entries = data.description_entries as DescriptionEntryData[] | undefined;

  if (!description && (!entries || entries.length === 0)) {
    return undefined;
  }

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h4>
      {description ? (
        <p className="text-xs leading-relaxed text-card-foreground">{description}</p>
      ) : undefined}

      {entries && entries.length > 0 ? (
        <>
          <Button
            variant="ghost"
            size="xs"
            className="w-fit text-xs text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "\u25BC" : "\u25B6"} History ({entries.length} {entries.length === 1 ? "entry" : "entries"})
          </Button>

          {expanded ? (
            <div className="flex flex-col gap-1.5 border-l-2 border-border pl-3">
              {[...entries].reverse().map((entry, index) => (
                <div key={`desc-${index}`} className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-card-foreground">{entry.text}</span>
                  {entry.source ? (
                    <Button
                      variant="link"
                      size="xs"
                      className="w-fit p-0 text-xs text-ring"
                      onClick={() => onEntityClick(formatSourceRef(entry.source!))}
                    >
                      &rarr; {formatSourceRef(entry.source)}
                    </Button>
                  ) : undefined}
                </div>
              ))}
            </div>
          ) : undefined}
        </>
      ) : undefined}
    </div>
  );
}
