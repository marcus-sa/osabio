import type { EntityKind } from "../../../shared/contracts";

const resolvedCache = new Map<string, string>();

/** Resolves a CSS variable reference to its computed hex value (cached). */
function resolveCssVar(varRef: string): string {
  const cached = resolvedCache.get(varRef);
  if (cached) return cached;
  const match = varRef.match(/^var\(--(.+)\)$/);
  if (!match) return varRef;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${match[1]}`).trim();
  if (value) resolvedCache.set(varRef, value);
  return value || varRef;
}

/** Returns the resolved hex color for a given entity kind (for canvas/WebGL contexts). */
export function resolvedEntityColor(kind: EntityKind): string {
  return resolveCssVar(entityColor(kind));
}

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
    case "intent": return "var(--entity-intent)";
    case "policy": return "var(--entity-policy)";
    case "learning": return "var(--entity-learning)";
    case "objective": return "var(--entity-objective)";
    case "behavior": return "var(--entity-behavior)";
    case "mcp_tool": return "var(--entity-task)";
    case "mcp_server": return "var(--entity-feature)";
    case "git_commit": return "var(--entity-task)";
    default: return kind satisfies never;
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
    case "intent": return "var(--entity-intent-muted)";
    case "policy": return "var(--entity-policy-muted)";
    case "learning": return "var(--entity-learning-muted)";
    case "objective": return "var(--entity-objective-muted)";
    case "behavior": return "var(--entity-behavior-muted)";
    case "mcp_tool": return "var(--entity-task-muted)";
    case "mcp_server": return "var(--entity-feature-muted)";
    case "git_commit": return "var(--entity-task-muted)";
    default: return kind satisfies never;
  }
}

/** Returns Tailwind class strings for entity color styling. */
export function entityTwClasses(kind: EntityKind): { bg: string; text: string; border: string; mutedBg: string } {
  const token = entityColorToken(kind);
  return {
    bg: `bg-entity-${token}`,
    text: `text-entity-${token}-fg`,
    border: `border-entity-${token}`,
    mutedBg: `bg-entity-${token}-muted`,
  };
}

function entityColorToken(kind: EntityKind): string {
  switch (kind) {
    case "observation": return "decision";
    case "suggestion": return "question";
    case "workspace": return "project";
    case "message": return "task";
    case "identity": return "person";
    case "agent_session": return "task";
    case "intent": return "intent";
    case "learning": return "learning";
    default: return kind;
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
      return { stroke: "#94a3b8", strokeDasharray: "4 2", opacity: 0.7 };
    case "conflicts_with":
      return { stroke: "#ff6b6b", strokeDasharray: "none", opacity: 0.85 };
    case "belongs_to":
    case "has_feature":
    case "has_task":
    case "has_project":
      return { stroke: "#7a8ba0", strokeDasharray: "none", opacity: 0.45 };
    case "governing":
    case "protects":
    case "triggered_by":
    case "gates":
    case "vetoed_by":
      return { stroke: "#6b9ec2", strokeDasharray: "6 3", opacity: 0.7 };
    case "supports":
    case "has_objective":
      return { stroke: "#5cb8a5", strokeDasharray: "none", opacity: 0.7 };
    case "exhibits":
      return { stroke: "#b0a0d4", strokeDasharray: "4 2", opacity: 0.7 };
    default:
      return { stroke: "#7a8ba0", strokeDasharray: "none", opacity: 0.45 };
  }
}
