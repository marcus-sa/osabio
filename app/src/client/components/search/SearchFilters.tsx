import type { EntityKind } from "../../../shared/contracts";
import { cn } from "@/lib/utils";

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
  { label: "Policy", value: "policy" },
  { label: "Intent", value: "intent" },
];

export function SearchFilters({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: EntityKind | "all";
  onFilterChange: (filter: EntityKind | "all") => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "rounded-sm px-2 py-0.5 text-[0.65rem] font-medium transition-colors",
            activeFilter === option.value
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
          onClick={() => onFilterChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
