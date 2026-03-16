import type { EntityDetailResponse } from "../../../shared/contracts";
import { Button } from "../ui/button";

type ProvenanceItem = EntityDetailResponse["provenance"][number];

export function ProvenanceSection({
  provenance,
  onJumpToMessage,
}: {
  provenance: ProvenanceItem[];
  onJumpToMessage: (messageId: string, conversationId?: string) => void;
}) {
  if (provenance.length === 0) {
    return (
      <div className="flex flex-col gap-1 px-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Provenance</h4>
        <p className="text-xs text-muted-foreground">No provenance recorded.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Provenance</h4>
      {provenance.map((item, index) => (
        <div key={`${item.sourceId}-${index}`} className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-xs text-card-foreground">
          <span className="text-muted-foreground">
            {item.sourceKind === "message" ? "Message" : "Document chunk"} &middot;{" "}
            confidence {item.confidence.toFixed(2)} &middot;{" "}
            {new Date(item.extractedAt).toLocaleDateString()}
          </span>
          {item.evidence ? (
            <span className="italic text-muted-foreground">&ldquo;{item.evidence}&rdquo;</span>
          ) : undefined}
          {item.sourceKind === "message" ? (
            <Button
              variant="link"
              size="xs"
              className="w-fit p-0 text-xs font-semibold text-ring"
              onClick={() => onJumpToMessage(item.sourceId, item.conversationId)}
            >
              Jump to message
            </Button>
          ) : undefined}
        </div>
      ))}
    </div>
  );
}
