import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type IdentityListItem = {
  id: string;
  name: string;
  type: string;
};

type UseIdentitiesReturn = {
  identities: IdentityListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

export function buildIdentitiesUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/identities`;
}

export function useIdentities(): UseIdentitiesReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [identities, setIdentities] = useState<IdentityListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchIdentities = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildIdentitiesUrl(workspaceId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { identities: IdentityListItem[] };
      setIdentities(data.identities);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load identities");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchIdentities();
  }, [workspaceId, fetchIdentities]);

  const refresh = useCallback(() => {
    void fetchIdentities();
  }, [fetchIdentities]);

  return { identities, isLoading, error, refresh };
}
