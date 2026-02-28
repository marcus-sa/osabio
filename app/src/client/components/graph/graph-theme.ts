import type { EntityKind } from "../../../shared/contracts";

export function entityColor(kind: EntityKind): string {
  switch (kind) {
    case "project": return "var(--entity-project)";
    case "feature": return "var(--entity-feature)";
    case "task": return "var(--entity-task)";
    case "decision": return "var(--entity-decision)";
    case "question": return "var(--entity-question)";
    case "person": return "var(--entity-person)";
    case "workspace": return "var(--entity-project)";
  }
}

export function entityMutedColor(kind: EntityKind): string {
  switch (kind) {
    case "project": return "var(--entity-project-muted)";
    case "feature": return "var(--entity-feature-muted)";
    case "task": return "var(--entity-task-muted)";
    case "decision": return "var(--entity-decision-muted)";
    case "question": return "var(--entity-question-muted)";
    case "person": return "var(--entity-person-muted)";
    case "workspace": return "var(--entity-project-muted)";
  }
}

export type EdgeStyleResult = {
  stroke: string;
  strokeDasharray: string;
  opacity: number;
};

export function edgeStyle(type: string): EdgeStyleResult {
  switch (type) {
    case "depends_on":
      return { stroke: "#6a7e94", strokeDasharray: "4 2", opacity: 0.8 };
    case "conflicts_with":
      return { stroke: "#c44040", strokeDasharray: "none", opacity: 0.9 };
    case "belongs_to":
    case "has_feature":
    case "has_task":
    case "has_project":
      return { stroke: "#9fbfe4", strokeDasharray: "none", opacity: 0.4 };
    default:
      return { stroke: "#9fbfe4", strokeDasharray: "none", opacity: 0.6 };
  }
}
