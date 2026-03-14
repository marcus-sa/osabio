import type { EntityKind } from "../../../shared/contracts";

export function entityColor(kind: EntityKind): string {
  switch (kind) {
    case "project": return "var(--entity-project)";
    case "feature": return "var(--entity-feature)";
    case "task": return "var(--entity-task)";
    case "decision": return "var(--entity-decision)";
    case "question": return "var(--entity-question)";
    case "observation": return "var(--entity-decision)";
    case "suggestion": return "var(--entity-question)";
    case "person": return "var(--entity-person)";
    case "workspace": return "var(--entity-project)";
    case "message": return "var(--entity-task)";
    case "identity": return "var(--entity-person)";
    case "agent_session": return "var(--entity-task)";
    case "intent": return "var(--entity-feature)";
    case "policy": return "var(--entity-policy)";
    case "learning": return "var(--entity-decision)";
    case "objective": return "var(--entity-objective)";
    case "behavior": return "var(--entity-behavior)";
  }
}

export function entityMutedColor(kind: EntityKind): string {
  switch (kind) {
    case "project": return "var(--entity-project-muted)";
    case "feature": return "var(--entity-feature-muted)";
    case "task": return "var(--entity-task-muted)";
    case "decision": return "var(--entity-decision-muted)";
    case "question": return "var(--entity-question-muted)";
    case "observation": return "var(--entity-decision-muted)";
    case "suggestion": return "var(--entity-question-muted)";
    case "person": return "var(--entity-person-muted)";
    case "workspace": return "var(--entity-project-muted)";
    case "message": return "var(--entity-task-muted)";
    case "identity": return "var(--entity-person-muted)";
    case "agent_session": return "var(--entity-task-muted)";
    case "intent": return "var(--entity-feature-muted)";
    case "policy": return "var(--entity-policy-muted)";
    case "learning": return "var(--entity-decision-muted)";
    case "objective": return "var(--entity-objective-muted)";
    case "behavior": return "var(--entity-behavior-muted)";
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
      return { stroke: "#5a5a64", strokeDasharray: "4 2", opacity: 0.8 };
    case "conflicts_with":
      return { stroke: "#d66a8a", strokeDasharray: "none", opacity: 0.9 };
    case "belongs_to":
    case "has_feature":
    case "has_task":
    case "has_project":
      return { stroke: "#5b8dee", strokeDasharray: "none", opacity: 0.3 };
    case "governing":
    case "protects":
    case "triggered_by":
    case "gates":
    case "vetoed_by":
      return { stroke: "#f59e0b", strokeDasharray: "6 3", opacity: 0.7 };
    case "supports":
    case "has_objective":
      return { stroke: "#10b981", strokeDasharray: "none", opacity: 0.6 };
    case "exhibits":
      return { stroke: "#8b5cf6", strokeDasharray: "4 2", opacity: 0.6 };
    default:
      return { stroke: "#5b8dee", strokeDasharray: "none", opacity: 0.5 };
  }
}
