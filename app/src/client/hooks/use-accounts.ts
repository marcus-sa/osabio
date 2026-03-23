import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type AccountListItem = {
  id: string;
  provider_id: string;
  status: string;
  has_api_key: boolean;
  has_bearer_token: boolean;
  has_basic_credentials: boolean;
  has_access_token: boolean;
  connected_at: string;
};

type UseAccountsReturn = {
  accounts: AccountListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

/** Pure function: builds the API URL for fetching connected accounts. */
export function buildAccountsUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/accounts`;
}

export function useAccounts(): UseAccountsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchAccounts = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildAccountsUrl(workspaceId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { accounts: AccountListItem[] };
      setAccounts(data.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchAccounts();
  }, [workspaceId, fetchAccounts]);

  const refresh = useCallback(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  return { accounts, isLoading, error, refresh };
}
