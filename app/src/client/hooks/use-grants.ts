import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type GrantListItem = {
  identity_id: string;
  identity_name: string;
  tool_id: string;
  tool_name: string;
  max_calls_per_hour?: number;
  granted_at: string;
};

type UseGrantsReturn = {
  grants: GrantListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

/** Pure function: builds the API URL for fetching grants for a tool. */
export function buildGrantsUrl(workspaceId: string, toolId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/tools/${encodeURIComponent(toolId)}/grants`;
}

export function useGrants(toolId?: string): UseGrantsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [grants, setGrants] = useState<GrantListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchGrants = useCallback(async () => {
    if (!workspaceId || !toolId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildGrantsUrl(workspaceId, toolId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { grants: GrantListItem[] };
      setGrants(data.grants);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load grants");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, toolId]);

  useEffect(() => {
    if (!workspaceId || !toolId) return;
    void fetchGrants();
  }, [workspaceId, toolId, fetchGrants]);

  const refresh = useCallback(() => {
    void fetchGrants();
  }, [fetchGrants]);

  return { grants, isLoading, error, refresh };
}
