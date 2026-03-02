import { useState } from "react";
import type { EntityKind } from "../../../shared/contracts";

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
    <div className="entity-detail-section">
      <h4>Description</h4>
      {description ? (
        <p className="entity-detail-description">{description}</p>
      ) : undefined}

      {entries && entries.length > 0 ? (
        <>
          <button
            type="button"
            className="description-timeline-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "\u25BC" : "\u25B6"} History ({entries.length} {entries.length === 1 ? "entry" : "entries"})
          </button>

          {expanded ? (
            <div className="description-timeline">
              {[...entries].reverse().map((entry, index) => (
                <div key={`desc-${index}`} className="description-timeline-entry">
                  <span className="description-timeline-date">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </span>
                  <span className="description-timeline-text">{entry.text}</span>
                  {entry.source ? (
                    <button
                      type="button"
                      className="description-timeline-trigger"
                      onClick={() => onEntityClick(formatSourceRef(entry.source!))}
                    >
                      &rarr; {formatSourceRef(entry.source)}
                    </button>
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
