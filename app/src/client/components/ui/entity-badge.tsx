import type { EntityKind } from "../../../shared/contracts"
import { Badge } from "./badge"
import { cn } from "@/lib/utils"

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
  learning: "Learning",
  identity: "Identity",
  message: "Message",
  agent_session: "Agent Session",
}

/** Maps EntityKind to the base entity color token name used in Tailwind classes. */
function entityToken(kind: EntityKind): string {
  switch (kind) {
    case "observation": return "decision"
    case "suggestion": return "question"
    case "workspace": return "project"
    case "message": return "task"
    case "identity": return "person"
    case "agent_session": return "task"
    case "intent": return "feature"
    case "learning": return "decision"
    default: return kind
  }
}

export function entityBgClass(kind: EntityKind): string {
  return `bg-entity-${entityToken(kind)}-muted`
}

export function entityTextClass(kind: EntityKind): string {
  return `text-entity-${entityToken(kind)}-fg`
}

export function entityBorderClass(kind: EntityKind): string {
  return `border-entity-${entityToken(kind)}`
}

export function EntityBadge({
  kind,
  className,
}: {
  kind: EntityKind
  className?: string
}) {
  return (
    <Badge
      className={cn(
        entityBgClass(kind),
        entityTextClass(kind),
        "border-transparent",
        className,
      )}
    >
      {KIND_LABELS[kind] ?? kind}
    </Badge>
  )
}
