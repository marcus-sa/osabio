import type { EntityKind } from "../../../shared/contracts";
import { entityColor, entityMutedColor } from "./graph-theme";

const KIND_LABELS: Record<string, string> = {
  project: "Project",
  feature: "Feature",
  task: "Task",
  decision: "Decision",
  question: "Question",
  observation: "Observation",
  suggestion: "Suggestion",
  person: "Person",
  workspace: "Workspace",
  intent: "Intent",
  policy: "Policy",
  objective: "Objective",
  behavior: "Behavior",
};

export function EntityBadge({ kind }: { kind: EntityKind }) {
  return (
    <span
      className="entity-badge-inline"
      style={{
        background: entityMutedColor(kind),
        color: entityColor(kind),
      }}
    >
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}
