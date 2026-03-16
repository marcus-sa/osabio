import { LEARNING_TYPES, KNOWN_LEARNING_TARGET_AGENTS } from "../../../shared/contracts";
import type { LearningType } from "../../../shared/contracts";
import { capitalize } from "./learning-card-logic";

export type FilterOption = {
  value: string;
  label: string;
};

/** Dropdown options for filtering by learning type. */
export const TYPE_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: "", label: "All Types" },
  ...LEARNING_TYPES.map((type) => ({
    value: type,
    label: capitalize(type),
  })),
] as const;

/** Dropdown options for filtering by target agent. */
export const AGENT_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: "", label: "All Agents" },
  ...KNOWN_LEARNING_TARGET_AGENTS.map((agent) => ({
    value: agent.value,
    label: agent.label,
  })),
] as const;

type LearningFiltersProps = {
  selectedType?: LearningType;
  selectedAgent?: string;
  onTypeChange: (type?: LearningType) => void;
  onAgentChange: (agent?: string) => void;
};

export function LearningFilters({
  selectedType,
  selectedAgent,
  onTypeChange,
  onAgentChange,
}: LearningFiltersProps) {
  return (
    <div className="flex gap-2 py-2">
      <select
        className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-ring focus:outline-none"
        value={selectedType ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          onTypeChange(value ? (value as LearningType) : undefined);
        }}
        aria-label="Filter by type"
      >
        {TYPE_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-ring focus:outline-none"
        value={selectedAgent ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          onAgentChange(value || undefined);
        }}
        aria-label="Filter by agent"
      >
        {AGENT_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
