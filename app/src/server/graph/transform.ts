import type { ReagraphNode, ReagraphEdge, GraphResponse, EntityKind } from "../../shared/contracts";
import type { GraphViewRawResult } from "./queries";

// Resolved hex values for OKLCH entity colors — Three.js/WebGL cannot parse CSS variables.
export function entityColor(kind: EntityKind): string {
  switch (kind) {
    case "project": return "#3b82f6";   // oklch(0.65 0.15 250)
    case "feature": return "#14b8a6";   // oklch(0.65 0.15 170)
    case "task": return "#22c55e";      // oklch(0.70 0.15 145)
    case "decision": return "#eab308";  // oklch(0.70 0.15 55)
    case "question": return "#a855f7";  // oklch(0.65 0.15 300)
    case "person": return "#f97316";    // oklch(0.65 0.15 25)
    case "workspace": return "#3b82f6";
  }
}

function titleCase(s: string): string {
  return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function transformToReagraph(raw: GraphViewRawResult): GraphResponse {
  const connectionCounts = new Map<string, number>();
  for (const edge of raw.edges) {
    connectionCounts.set(edge.fromId, (connectionCounts.get(edge.fromId) ?? 0) + 1);
    connectionCounts.set(edge.toId, (connectionCounts.get(edge.toId) ?? 0) + 1);
  }

  const nodes: ReagraphNode[] = raw.entities.map((entity) => {
    const kind = entity.kind as EntityKind;
    const kindBoost = kind === "project" ? 20
      : kind === "feature" ? 10
      : kind === "person" ? 8
      : 0;
    return {
      id: entity.id,
      label: entity.name.length > 32 ? entity.name.slice(0, 32) + "\u2026" : entity.name,
      fill: entityColor(kind),
      data: {
        kind,
        connectionCount: (connectionCounts.get(entity.id) ?? 0) + kindBoost,
        status: undefined,
      },
    };
  });

  const edges: ReagraphEdge[] = raw.edges.map((edge) => ({
    id: edge.id,
    source: edge.fromId,
    target: edge.toId,
    label: titleCase(edge.kind.replace(/_/g, " ")),
    data: {
      type: edge.kind,
      confidence: edge.confidence,
    },
  }));

  return { nodes, edges };
}
