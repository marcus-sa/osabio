import { useNavigate } from "@tanstack/react-router";
import type { SearchEntityResponse } from "../../../shared/contracts";
import { EntityBadge } from "../graph/EntityBadge";
import { useViewState } from "../../stores/view-state";

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
    <div className="search-result-card">
      <div className="search-result-card-header">
        <EntityBadge kind={result.kind} />
        <span className="search-result-confidence">
          {(result.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p className="search-result-text">{result.text}</p>
      <div className="search-result-footer">
        <button
          type="button"
          className="search-result-graph-btn"
          onClick={handleViewInGraph}
        >
          View in graph
        </button>
        <button
          type="button"
          className="search-result-graph-btn"
          onClick={handleDiscuss}
        >
          Discuss
        </button>
      </div>
    </div>
  );
}
