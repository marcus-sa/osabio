import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";
import type { ToolDetailData } from "../components/tool-registry/ToolDetailPanel";

type UseToolDetailReturn = {
  data?: ToolDetailData;
  isLoading: boolean;
  error?: string;
};

/** Pure function: builds the API URL for fetching tool detail. */
export function buildToolDetailUrl(workspaceId: string, toolId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/tools/${encodeURIComponent(toolId)}`;
}

export function useToolDetail(toolId: string | undefined): UseToolDetailReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [data, setData] = useState<ToolDetailData | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchDetail = useCallback(async () => {
    if (!workspaceId || !toolId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildToolDetailUrl(workspaceId, toolId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const result = (await response.json()) as ToolDetailData;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tool detail");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, toolId]);

  useEffect(() => {
    if (!toolId) {
      setData(undefined);
      setError(undefined);
      return;
    }
    void fetchDetail();
  }, [toolId, fetchDetail]);

  return { data, isLoading, error };
}
