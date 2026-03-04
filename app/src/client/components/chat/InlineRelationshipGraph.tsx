import { GraphCanvas, darkTheme } from "reagraph";
import type { EntityKind } from "../../../shared/contracts";
import type { InlineRelationshipGraphProps } from "../../../shared/chat-component-definitions";
import { edgeStyle } from "../graph/graph-theme";
import { useViewState } from "../../stores/view-state";

// Resolved hex values for Reagraph/WebGL (same as server transform.ts).
function nodeColor(kind: string): string {
  switch (kind) {
    case "project": return "#3b82f6";
    case "feature": return "#14b8a6";
    case "task": return "#22c55e";
    case "decision": return "#eab308";
    case "question": return "#a855f7";
    case "observation": return "#ef4444";
    case "suggestion": return "#06b6d4";
    case "person": return "#f97316";
    case "workspace": return "#3b82f6";
    default: return "#9fbfe4";
  }
}

export function InlineRelationshipGraph(props: InlineRelationshipGraphProps) {
  const navigateToGraph = useViewState((s) => s.navigateToGraph);

  const nodes = props.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    fill: nodeColor(node.kind),
    data: {
      kind: node.kind as EntityKind,
      connectionCount: props.edges.filter((e) => e.source === node.id || e.target === node.id).length,
    },
  }));

  const edges = props.edges.map((edge) => {
    const style = edgeStyle(edge.type);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      fill: style.stroke,
      opacity: style.opacity,
      data: {
        type: edge.type,
        confidence: 1,
      },
    };
  });

  function handleNodeClick(node: { id: string }) {
    const match = props.nodes.find((n) => n.id === node.id);
    if (match) {
      const entityId = `${match.kind}:${node.id}`;
      navigateToGraph(entityId);
      window.location.pathname = "/graph";
    }
  }

  return (
    <section className="inline-relationship-graph">
      <p className="extraction-summary-title">{props.title}</p>
      <div style={{ height: 300, position: "relative" }}>
        <GraphCanvas
          theme={darkTheme}
          nodes={nodes as any}
          edges={edges as any}
          selections={props.focusNodeIds ?? []}
          layoutType="forceDirected2d"
          sizingType="attribute"
          sizingAttribute="connectionCount"
          labelType="auto"
          onNodeClick={handleNodeClick}
        />
      </div>
    </section>
  );
}
