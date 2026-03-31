import { Link } from "@tanstack/react-router";
import type { SkillListItem, SkillStatus } from "../../hooks/use-skills";
import { Badge } from "../ui/badge";

const STATUS_LABELS: Record<SkillStatus, string> = {
  draft: "Draft",
  active: "Active",
  deprecated: "Deprecated",
};

const STATUS_VARIANTS: Record<SkillStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  draft: "secondary",
  deprecated: "outline",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function truncateDescription(text: string, maxLength: number = 120): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "...";
}

type SkillCardProps = {
  skill: SkillListItem;
};

export function SkillCard({ skill }: SkillCardProps) {
  const sourceLabel = skill.source.type === "github" ? "GitHub" : "Git";

  return (
    <Link
      to="/skills/$skillId"
      params={{ skillId: skill.id }}
      className="flex flex-col gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-hover"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{skill.name}</span>
          <Badge variant={STATUS_VARIANTS[skill.status]}>
            {STATUS_LABELS[skill.status]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">v{skill.version}</span>
      </div>

      <p className="text-xs text-muted-foreground">
        {truncateDescription(skill.description)}
      </p>

      <div className="flex items-center gap-3 text-[0.65rem] text-muted-foreground">
        <span>{sourceLabel}</span>
        <span>{skill.required_tools.length} tool{skill.required_tools.length !== 1 ? "s" : ""}</span>
        <span>{skill.agent_count} agent{skill.agent_count !== 1 ? "s" : ""}</span>
        <span className="ml-auto">{formatDate(skill.created_at)}</span>
      </div>
    </Link>
  );
}
