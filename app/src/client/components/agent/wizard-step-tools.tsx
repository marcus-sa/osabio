import type { SkillListItem } from "../../hooks/use-skills";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type SkillDerivedTool = {
  id: string;
  name: string;
  sourceSkillNames: string[];
};

type WizardStepToolsProps = {
  selectedSkillIds: string[];
  skills: SkillListItem[];
  additionalToolIds: string[];
  onChangeAdditionalToolIds: (ids: string[]) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  error?: string;
};

/**
 * Derive the deduplicated list of tools from selected skills.
 * Each tool appears once with all source skill names.
 */
function deriveToolsFromSkills(
  selectedSkillIds: string[],
  skills: SkillListItem[],
): SkillDerivedTool[] {
  const toolMap = new Map<string, SkillDerivedTool>();

  const selectedSkills = skills.filter((skill) => selectedSkillIds.includes(skill.id));

  for (const skill of selectedSkills) {
    for (const tool of skill.required_tools) {
      const existing = toolMap.get(tool.id);
      if (existing) {
        existing.sourceSkillNames.push(skill.name);
      } else {
        toolMap.set(tool.id, {
          id: tool.id,
          name: tool.name,
          sourceSkillNames: [skill.name],
        });
      }
    }
  }

  return Array.from(toolMap.values());
}

function SkillDerivedToolsList({ tools }: { tools: SkillDerivedTool[] }) {
  if (tools.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No tools required by selected skills.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {tools.map((tool) => (
        <div
          key={tool.id}
          className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2"
        >
          <span className="text-sm">{tool.name}</span>
          <span className="text-xs text-muted-foreground">
            via {tool.sourceSkillNames.join(", ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function AdditionalToolsPlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center">
      <p className="text-xs text-muted-foreground">
        Additional tool selection will be available when tool registry listing is implemented.
      </p>
    </div>
  );
}

export function WizardStepTools({
  selectedSkillIds,
  skills,
  additionalToolIds,
  onChangeAdditionalToolIds: _onChangeAdditionalToolIds,
  onBack,
  onSubmit,
  isSubmitting,
  error,
}: WizardStepToolsProps) {
  const derivedTools = deriveToolsFromSkills(selectedSkillIds, skills);
  const totalEffectiveTools = derivedTools.length + additionalToolIds.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Skill-derived tools (read-only) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Skill-derived Tools</h3>
          {derivedTools.length > 0 ? (
            <Badge variant="secondary">{derivedTools.length}</Badge>
          ) : undefined}
        </div>
        <SkillDerivedToolsList tools={derivedTools} />
      </div>

      {/* Additional tools (editable - placeholder for MVP) */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Additional Tools</h3>
        <AdditionalToolsPlaceholder />
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Total effective tools: <span className="font-medium text-foreground">{totalEffectiveTools}</span>
        </p>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : undefined}

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="ghost" size="sm" type="button" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" type="button" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Agent"}
        </Button>
      </div>
    </div>
  );
}
