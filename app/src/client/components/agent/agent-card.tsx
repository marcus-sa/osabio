import { Link } from "@tanstack/react-router";
import type { AgentListItem, AgentRuntime } from "../../hooks/use-agents";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const RUNTIME_LABELS: Record<AgentRuntime, string> = {
  brain: "Brain",
  sandbox: "Sandbox",
  external: "External",
};

const RUNTIME_VARIANTS: Record<AgentRuntime, "default" | "secondary" | "outline"> = {
  brain: "default",
  sandbox: "secondary",
  external: "outline",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

type AgentCardProps = {
  agent: AgentListItem;
  onDelete?: (agent: AgentListItem) => void;
};

export function AgentCard({ agent, onDelete }: AgentCardProps) {
  const isBrain = agent.runtime === "brain";

  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-hover">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Link
            to="/agents/$agentId"
            params={{ agentId: agent.id }}
            className="text-sm font-medium text-foreground hover:underline"
          >
            {agent.name}
          </Link>
          <Badge variant={RUNTIME_VARIANTS[agent.runtime]}>
            {RUNTIME_LABELS[agent.runtime]}
          </Badge>
        </div>
        {agent.description ? (
          <p className="text-xs text-muted-foreground">{agent.description}</p>
        ) : undefined}
        <span className="text-[0.65rem] text-muted-foreground">
          Created {formatDate(agent.created_at)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {!isBrain ? (
          <>
            <Link to="/agents/$agentId" params={{ agentId: agent.id }}>
              <Button variant="ghost" size="xs">Edit</Button>
            </Link>
            {onDelete ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(agent)}
              >
                Delete
              </Button>
            ) : undefined}
          </>
        ) : (
          <Link to="/agents/$agentId" params={{ agentId: agent.id }}>
            <Button variant="ghost" size="xs">View</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
