import { useEffect, useRef, useState } from "react";
import { GraphCanvas, type GraphCanvasRef } from "reagraph";
import type { GraphResponse, ReagraphEdge } from "../../../shared/contracts";
import { edgeStyle } from "./graph-theme";

export function KnowledgeGraph({
  workspaceId,
  projectId,
  centerId,
  depth,
  selectedId,
  onNodeClick,
}: {
  workspaceId: string;
  projectId?: string;
  centerId?: string;
  depth: number;
  selectedId?: string;
  onNodeClick: (nodeId: string) => void;
}) {
  const [data, setData] = useState<GraphResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const graphRef = useRef<GraphCanvasRef>(null);

  useEffect(() => {
    setLoading(true);
    setError(undefined);

    const params = new URLSearchParams();
    if (centerId) {
      params.set("center", centerId);
      params.set("depth", String(depth));
    } else if (projectId) {
      params.set("project", projectId);
    }

    const url = `/api/graph/${encodeURIComponent(workspaceId)}${params.toString() ? `?${params}` : ""}`;

    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return response.json() as Promise<GraphResponse>;
      })
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load graph");
        setLoading(false);
      });
  }, [workspaceId, projectId, centerId, depth]);

  if (loading) {
    return (
      <div className="graph-canvas">
        <div className="graph-empty">Loading graph...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="graph-canvas">
        <div className="graph-empty">{error}</div>
      </div>
    );
  }

  if (!data || (data.nodes.length === 0)) {
    return (
      <div className="graph-canvas">
        <div className="graph-empty">
          <p>Your graph will grow as you have more conversations.</p>
        </div>
      </div>
    );
  }

  const styledEdges: ReagraphEdge[] = data.edges.map((edge) => {
    const style = edgeStyle(edge.data.type);
    return {
      ...edge,
      fill: style.stroke,
      opacity: style.opacity,
    } as ReagraphEdge;
  });

  return (
    <div className="graph-canvas">
      <GraphCanvas
        ref={graphRef}
        nodes={data.nodes as any}
        edges={styledEdges as any}
        selections={selectedId ? [selectedId.includes(":") ? selectedId.slice(selectedId.indexOf(":") + 1) : selectedId] : []}
        layoutType="forceDirected2d"
        sizingType="attribute"
        sizingAttribute="connectionCount"
        labelType="auto"
        onNodeClick={(node: { id: string }) => {
          const match = data.nodes.find((n) => n.id === node.id);
          const prefixed = match ? `${match.data.kind}:${node.id}` : node.id;
          onNodeClick(prefixed);
        }}
      />
    </div>
  );
}
