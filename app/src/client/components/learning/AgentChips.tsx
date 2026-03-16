import { resolveAgentLabels } from "./learning-card-logic";
import { Badge } from "../ui/badge";

type AgentChipsProps = {
  agents: string[];
};

/** Renders target agents as colored badge chips. Empty agents show "All agents". */
export function AgentChips({ agents }: AgentChipsProps) {
  const labels = resolveAgentLabels(agents);

  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="outline" className="text-[0.65rem]">
          {label}
        </Badge>
      ))}
    </span>
  );
}
