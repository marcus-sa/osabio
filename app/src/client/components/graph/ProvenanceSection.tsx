import type { EntityDetailResponse } from "../../../shared/contracts";

type ProvenanceItem = EntityDetailResponse["provenance"][number];

export function ProvenanceSection({
  provenance,
  onJumpToMessage,
}: {
  provenance: ProvenanceItem[];
  onJumpToMessage: (messageId: string) => void;
}) {
  if (provenance.length === 0) {
    return (
      <div className="entity-detail-section">
        <h4>Provenance</h4>
        <p className="entity-detail-meta">No provenance recorded.</p>
      </div>
    );
  }

  return (
    <div className="entity-detail-section">
      <h4>Provenance</h4>
      {provenance.map((item, index) => (
        <div key={`${item.sourceId}-${index}`} className="provenance-item">
          <span className="entity-detail-meta">
            {item.sourceKind === "message" ? "Message" : "Document chunk"} &middot;{" "}
            confidence {item.confidence.toFixed(2)} &middot;{" "}
            {new Date(item.extractedAt).toLocaleDateString()}
          </span>
          {item.evidence ? (
            <span className="provenance-evidence">&ldquo;{item.evidence}&rdquo;</span>
          ) : undefined}
          {item.sourceKind === "message" ? (
            <button
              type="button"
              className="provenance-link"
              onClick={() => onJumpToMessage(item.sourceId)}
            >
              Jump to message
            </button>
          ) : undefined}
        </div>
      ))}
    </div>
  );
}
