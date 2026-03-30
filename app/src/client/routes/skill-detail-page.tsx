import { Link, useParams } from "@tanstack/react-router";
import { useSkillDetail, useActivateSkill, useDeprecateSkill, type SkillStatus } from "../hooks/use-skills";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";

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
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function SkillDetailPage() {
  const { skillId } = useParams({ strict: false }) as { skillId: string };
  const { detail, isLoading, error, refresh } = useSkillDetail(skillId);
  const activateSkill = useActivateSkill();
  const deprecateSkill = useDeprecateSkill();

  if (isLoading) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">Loading skill...</p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <p className="text-sm text-destructive">{error ?? "Skill not found"}</p>
        <Link to="/skills" className="text-sm text-primary hover:underline">
          Back to Skills
        </Link>
      </section>
    );
  }

  const { skill, required_tools, agents, governed_by } = detail;
  const sourceLabel = skill.source.type === "github" ? "GitHub" : "Git";

  async function handleActivate() {
    const success = await activateSkill.execute(skillId);
    if (success) refresh();
  }

  async function handleDeprecate() {
    const success = await deprecateSkill.execute(skillId);
    if (success) refresh();
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      {/* Back navigation */}
      <Link to="/skills" className="text-sm text-primary hover:underline">
        Back to Skills
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{skill.name}</h1>
            <Badge variant={STATUS_VARIANTS[skill.status]}>
              {STATUS_LABELS[skill.status]}
            </Badge>
            <span className="text-xs text-muted-foreground">v{skill.version}</span>
          </div>
          <p className="text-sm text-muted-foreground">{skill.description}</p>
          <span className="text-xs text-muted-foreground">
            Created {formatDate(skill.created_at)}
            {skill.updated_at ? ` -- Updated ${formatDate(skill.updated_at)}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {skill.status === "draft" ? (
            <Button
              size="sm"
              disabled={activateSkill.isSubmitting}
              onClick={handleActivate}
            >
              {activateSkill.isSubmitting ? "Activating..." : "Activate"}
            </Button>
          ) : undefined}
          {skill.status === "active" ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={deprecateSkill.isSubmitting}
              onClick={handleDeprecate}
            >
              {deprecateSkill.isSubmitting ? "Deprecating..." : "Deprecate"}
            </Button>
          ) : undefined}
        </div>
      </div>

      {/* Lifecycle errors */}
      {activateSkill.error ? (
        <p className="text-xs text-destructive">{activateSkill.error}</p>
      ) : undefined}
      {deprecateSkill.error ? (
        <p className="text-xs text-destructive">{deprecateSkill.error}</p>
      ) : undefined}

      {/* Source info */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Source</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-medium text-muted-foreground">Type</td>
                <td className="px-3 py-2">{sourceLabel}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-medium text-muted-foreground">Repository</td>
                <td className="px-3 py-2 font-mono text-xs">{skill.source.source}</td>
              </tr>
              {skill.source.ref ? (
                <tr className="border-b border-border">
                  <td className="px-3 py-2 font-medium text-muted-foreground">Ref</td>
                  <td className="px-3 py-2 font-mono text-xs">{skill.source.ref}</td>
                </tr>
              ) : undefined}
              {skill.source.subpath ? (
                <tr>
                  <td className="px-3 py-2 font-medium text-muted-foreground">Subpath</td>
                  <td className="px-3 py-2 font-mono text-xs">{skill.source.subpath}</td>
                </tr>
              ) : undefined}
            </tbody>
          </table>
        </div>
      </div>

      {/* Required tools */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Required Tools</h2>
        {required_tools.length === 0 ? (
          <p className="text-xs text-muted-foreground">No required tools configured.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {required_tools.map((tool) => (
              <Badge key={tool.id} variant="outline">{tool.name}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Agents */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Agents</h2>
        {agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No agents assigned to this skill.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                to="/agents/$agentId"
                params={{ agentId: agent.id }}
                className="inline-flex"
              >
                <Badge variant="secondary">{agent.name}</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Governed by policies */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Governed By</h2>
        {governed_by.length === 0 ? (
          <p className="text-xs text-muted-foreground">No policies govern this skill.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {governed_by.map((policy) => (
              <Link
                key={policy.id}
                to="/policies/$policyId"
                params={{ policyId: policy.id }}
                className="inline-flex"
              >
                <Badge variant="outline">{policy.name}</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
