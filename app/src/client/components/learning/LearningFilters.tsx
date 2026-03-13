import { LEARNING_TYPES, KNOWN_LEARNING_TARGET_AGENTS } from "../../../shared/contracts";
import type { LearningType } from "../../../shared/contracts";

export type FilterOption = {
  value: string;
  label: string;
};

/** Capitalize first letter of a string. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
    <div className="learning-filters">
      <select
        className="learning-filters__select"
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
        className="learning-filters__select"
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
