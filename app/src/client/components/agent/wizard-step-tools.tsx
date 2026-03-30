import { useState } from "react";
import type { SkillListItem } from "../../hooks/use-skills";
import { useTools, type ToolListItem } from "../../hooks/use-tools";
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

function toggleToolId(selectedIds: string[], toolId: string): string[] {
  return selectedIds.includes(toolId)
    ? selectedIds.filter((id) => id !== toolId)
    : [...selectedIds, toolId];
}

const RISK_COLORS: Record<string, string> = {
  low: "text-green-600",
  medium: "text-yellow-600",
  high: "text-orange-600",
  critical: "text-red-600",
};

function ToolChecklistItem({
  tool,
  checked,
  onToggle,
}: {
  tool: ToolListItem;
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
          <span className="text-sm font-medium">{tool.name}</span>
          <span className="text-xs text-muted-foreground">{tool.toolkit}</span>
          <span className={`text-[10px] ${RISK_COLORS[tool.risk_level] ?? "text-muted-foreground"}`}>
            {tool.risk_level}
          </span>
        </div>
        {tool.description ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">{tool.description}</span>
        ) : undefined}
      </div>
    </label>
  );
}

function AdditionalToolsList({
  tools,
  selectedIds,
  onToggle,
  searchQuery,
  onSearchChange,
}: {
  tools: ToolListItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const filtered = searchQuery.trim()
    ? tools.filter((t) => {
        const q = searchQuery.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.toolkit.toLowerCase().includes(q);
      })
    : tools;

  return (
    <div className="flex flex-col gap-2">
      {tools.length > 5 ? (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter tools..."
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : undefined}
      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            {searchQuery.trim() ? "No tools match your filter." : "No additional tools available."}
          </p>
        ) : (
          filtered.map((tool) => (
            <ToolChecklistItem
              key={tool.id}
              tool={tool}
              checked={selectedIds.includes(tool.id)}
              onToggle={() => onToggle(tool.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function WizardStepTools({
  selectedSkillIds,
  skills,
  additionalToolIds,
  onChangeAdditionalToolIds,
  onBack,
  onSubmit,
  isSubmitting,
  error,
}: WizardStepToolsProps) {
  const derivedTools = deriveToolsFromSkills(selectedSkillIds, skills);
  const derivedToolIds = new Set(derivedTools.map((t) => t.id));

  const { tools: allTools, isLoading: isLoadingTools } = useTools();
  const availableTools = allTools.filter((t) => t.status === "active" && !derivedToolIds.has(t.id));

  const [searchQuery, setSearchQuery] = useState("");

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

      {/* Additional tools from registry */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Additional Tools</h3>
          {additionalToolIds.length > 0 ? (
            <Badge variant="secondary">{additionalToolIds.length} selected</Badge>
          ) : undefined}
        </div>
        {isLoadingTools ? (
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="text-xs text-muted-foreground">Loading tools...</p>
          </div>
        ) : availableTools.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/50 p-4 text-center">
            <p className="text-xs text-muted-foreground">
              No additional tools available in this workspace.
            </p>
          </div>
        ) : (
          <AdditionalToolsList
            tools={availableTools}
            selectedIds={additionalToolIds}
            onToggle={(id) => onChangeAdditionalToolIds(toggleToolId(additionalToolIds, id))}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        )}
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
