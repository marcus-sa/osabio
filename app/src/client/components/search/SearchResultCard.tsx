import { useNavigate } from "@tanstack/react-router";
import type { SearchEntityResponse } from "../../../shared/contracts";
import { EntityBadge } from "../ui/entity-badge";
import { useViewState } from "../../stores/view-state";
import { Button } from "../ui/button";

export function SearchResultCard({ result, onClose }: { result: SearchEntityResponse; onClose?: () => void }) {
  const navigateToGraph = useViewState((s) => s.navigateToGraph);
  const navigateToDiscussEntity = useViewState((s) => s.navigateToDiscussEntity);
  const navigate = useNavigate();

  function handleViewInGraph() {
    navigateToGraph(result.id);
    void navigate({ to: "/graph" });
  }

  function handleDiscuss() {
    navigateToDiscussEntity({ id: result.id, kind: result.kind, name: result.text });
    onClose?.();
    void navigate({ to: "/chat" });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md p-2 transition-colors hover:bg-hover">
      <div className="flex items-center justify-between gap-2">
        <EntityBadge kind={result.kind} />
        <span className="text-[0.65rem] text-muted-foreground">
          {(result.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p className="text-sm text-foreground">{result.text}</p>
      <div className="flex gap-1.5">
        <Button variant="ghost" size="xs" onClick={handleViewInGraph}>
          View in graph
        </Button>
        <Button variant="ghost" size="xs" onClick={handleDiscuss}>
          Discuss
        </Button>
      </div>
    </div>
  );
}
