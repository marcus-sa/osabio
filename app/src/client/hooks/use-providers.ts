import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type ProviderListItem = {
  id: string;
  name: string;
  display_name: string;
  auth_method: string;
  has_client_secret: boolean;
  created_at: string;
};

type UseProvidersReturn = {
  providers: ProviderListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

/** Pure function: builds the API URL for fetching providers. */
export function buildProvidersUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/providers`;
}

export function useProviders(): UseProvidersReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchProviders = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildProvidersUrl(workspaceId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { providers: ProviderListItem[] };
      setProviders(data.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchProviders();
  }, [workspaceId, fetchProviders]);

  const refresh = useCallback(() => {
    void fetchProviders();
  }, [fetchProviders]);

  return { providers, isLoading, error, refresh };
}
