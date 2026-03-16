import { Badge, type badgeVariants } from "./badge"
import { cn } from "@/lib/utils"
import type { VariantProps } from "class-variance-authority"

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

const STATUS_STYLES: Record<string, { variant: BadgeVariant; className?: string }> = {
  // Decision statuses
  extracted: { variant: "secondary" },
  proposed: { variant: "outline", className: "border-entity-question text-entity-question-fg" },
  provisional: { variant: "outline", className: "border-entity-decision text-entity-decision-fg" },
  confirmed: { variant: "secondary", className: "bg-entity-feature-muted text-entity-feature-fg" },
  superseded: { variant: "secondary", className: "text-muted-foreground line-through" },

  // Task statuses
  open: { variant: "outline" },
  todo: { variant: "outline" },
  ready: { variant: "outline", className: "border-entity-task text-entity-task-fg" },
  in_progress: { variant: "secondary", className: "bg-entity-task-muted text-entity-task-fg" },
  blocked: { variant: "destructive" },
  done: { variant: "secondary", className: "bg-entity-feature-muted text-entity-feature-fg" },
  completed: { variant: "secondary", className: "bg-entity-feature-muted text-entity-feature-fg" },

  // Policy statuses
  draft: { variant: "secondary" },
  active: { variant: "secondary", className: "bg-entity-feature-muted text-entity-feature-fg" },
  deprecated: { variant: "secondary", className: "text-muted-foreground" },

  // Observation statuses
  acknowledged: { variant: "secondary", className: "bg-entity-decision-muted text-entity-decision-fg" },
  resolved: { variant: "secondary", className: "bg-entity-feature-muted text-entity-feature-fg" },
}

export function StatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const config = STATUS_STYLES[status] ?? { variant: "secondary" as BadgeVariant }
  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  )
}
