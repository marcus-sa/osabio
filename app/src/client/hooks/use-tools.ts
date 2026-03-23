import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type ToolListItem = {
  id: string;
  name: string;
  toolkit: string;
  description: string;
  risk_level: string;
  status: string;
  grant_count: number;
  governance_count: number;
  created_at: string;
};

type UseToolsReturn = {
  tools: ToolListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

/** Pure function: builds the API URL for fetching tools. */
export function buildToolsUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/tools`;
}

export function useTools(): UseToolsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchTools = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildToolsUrl(workspaceId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { tools: ToolListItem[] };
      setTools(data.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tools");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchTools();
  }, [workspaceId, fetchTools]);

  const refresh = useCallback(() => {
    void fetchTools();
  }, [fetchTools]);

  return { tools, isLoading, error, refresh };
}
