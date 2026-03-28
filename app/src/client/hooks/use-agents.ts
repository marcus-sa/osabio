import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type AgentRuntime = "brain" | "sandbox" | "external";

export type AgentListItem = {
  id: string;
  name: string;
  description?: string;
  runtime: AgentRuntime;
  model?: string;
  identity_id: string;
  created_at: string;
};

type UseAgentsReturn = {
  agents: AgentListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

export function buildAgentsUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/agents`;
}

export function groupByRuntime(agents: AgentListItem[]): Record<AgentRuntime, AgentListItem[]> {
  const groups: Record<AgentRuntime, AgentListItem[]> = { brain: [], sandbox: [], external: [] };
  for (const agent of agents) {
    groups[agent.runtime].push(agent);
  }
  return groups;
}

export function useAgents(): UseAgentsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchAgents = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildAgentsUrl(workspaceId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { agents: AgentListItem[] };
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchAgents();
  }, [workspaceId, fetchAgents]);

  const refresh = useCallback(() => {
    void fetchAgents();
  }, [fetchAgents]);

  return { agents, isLoading, error, refresh };
}
