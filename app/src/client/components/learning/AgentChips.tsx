import { resolveAgentLabels } from "./learning-card-logic";

type AgentChipsProps = {
  agents: string[];
};

/** Renders target agents as colored badge chips. Empty agents show "All agents". */
export function AgentChips({ agents }: AgentChipsProps) {
  const labels = resolveAgentLabels(agents);

  return (
    <span className="agent-chips">
      {labels.map((label) => (
        <span key={label} className="agent-chips__chip">
          {label}
        </span>
      ))}
    </span>
  );
}
