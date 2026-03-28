import { GraphCanvas, darkTheme } from "reagraph";
import type { EntityKind } from "../../../shared/contracts";
import type { InlineRelationshipGraphProps } from "../../../shared/chat-component-definitions";
import { edgeStyle, resolvedEntityColor } from "../graph/graph-theme";
import { useViewState } from "../../stores/view-state";

export function InlineRelationshipGraph(props: InlineRelationshipGraphProps) {
  const navigateToGraph = useViewState((s) => s.navigateToGraph);

  const nodes = props.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    fill: resolvedEntityColor(node.kind as EntityKind),
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
    <section className="my-2 rounded-lg border border-border bg-card p-3">
      <p className="mb-2 text-xs font-semibold text-foreground">{props.title}</p>
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
