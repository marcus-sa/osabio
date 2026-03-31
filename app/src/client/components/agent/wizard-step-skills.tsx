import { useSkills, type SkillListItem } from "../../hooks/use-skills";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type WizardStepSkillsProps = {
  selectedSkillIds: string[];
  onChangeSkillIds: (ids: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  isExternalRuntime: boolean;
};

function toggleSkillId(selectedIds: string[], skillId: string): string[] {
  return selectedIds.includes(skillId)
    ? selectedIds.filter((id) => id !== skillId)
    : [...selectedIds, skillId];
}

function SkillChecklistItem({
  skill,
  checked,
  onToggle,
}: {
  skill: SkillListItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 accent-primary"
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{skill.name}</span>
          <span className="text-xs text-muted-foreground">v{skill.version}</span>
        </div>
        <span className="text-xs text-muted-foreground">{skill.description}</span>
      </div>
    </label>
  );
}

function ExternalRuntimeNotice() {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 text-center">
      <p className="text-sm text-muted-foreground">
        Skills are configured for sandbox agents only. External agents manage their own capabilities.
      </p>
    </div>
  );
}

function EmptySkillsState() {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-6 text-center">
      <p className="text-sm text-muted-foreground">No active skills in this workspace.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create and activate skills from the Skills page, then assign them here.
      </p>
    </div>
  );
}

function SkillsLoadingState() {
  return (
    <div className="rounded-lg border border-border p-6 text-center">
      <p className="text-sm text-muted-foreground">Loading skills...</p>
    </div>
  );
}

export function WizardStepSkills({
  selectedSkillIds,
  onChangeSkillIds,
  onNext,
  onBack,
  isExternalRuntime,
}: WizardStepSkillsProps) {
  const { skills, isLoading } = useSkills("active");

  if (isExternalRuntime) {
    return (
      <div className="flex flex-col gap-4">
        <ExternalRuntimeNotice />
        <div className="flex justify-between">
          <Button variant="ghost" size="sm" type="button" onClick={onBack}>
            Back
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={onNext}>
            Skip
          </Button>
        </div>
      </div>
    );
  }

  const selectedCount = selectedSkillIds.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Select skills to assign to this agent.
        </p>
        {selectedCount > 0 ? (
          <Badge variant="secondary">{selectedCount} selected</Badge>
        ) : undefined}
      </div>

      {isLoading ? (
        <SkillsLoadingState />
      ) : skills.length === 0 ? (
        <EmptySkillsState />
      ) : (
        <div className="flex flex-col gap-2">
          {skills.map((skill) => (
            <SkillChecklistItem
              key={skill.id}
              skill={skill}
              checked={selectedSkillIds.includes(skill.id)}
              onToggle={() => onChangeSkillIds(toggleSkillId(selectedSkillIds, skill.id))}
            />
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" size="sm" type="button" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          {selectedCount === 0 ? (
            <Button variant="outline" size="sm" type="button" onClick={onNext}>
              Skip
            </Button>
          ) : (
            <Button size="sm" type="button" onClick={onNext}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
