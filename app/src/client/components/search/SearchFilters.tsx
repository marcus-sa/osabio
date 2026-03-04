import type { EntityKind } from "../../../shared/contracts";

const FILTER_OPTIONS: Array<{ label: string; value: EntityKind | "all" }> = [
  { label: "All", value: "all" },
  { label: "Decision", value: "decision" },
  { label: "Task", value: "task" },
  { label: "Feature", value: "feature" },
  { label: "Question", value: "question" },
  { label: "Observation", value: "observation" },
  { label: "Suggestion", value: "suggestion" },
  { label: "Message", value: "message" },
  { label: "Person", value: "person" },
  { label: "Project", value: "project" },
];

export function SearchFilters({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: EntityKind | "all";
  onFilterChange: (filter: EntityKind | "all") => void;
}) {
  return (
    <div className="search-filters">
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`search-filter-chip${activeFilter === option.value ? " search-filter-chip--active" : ""}`}
          onClick={() => onFilterChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
