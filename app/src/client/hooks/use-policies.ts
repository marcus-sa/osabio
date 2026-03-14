import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type PolicyStatus = "draft" | "testing" | "active" | "deprecated" | "superseded";

export type PolicyListItem = {
  id: string;
  title: string;
  status: PolicyStatus;
  version: number;
  rules_count: number;
  human_veto_required: boolean;
  created_at: string;
  updated_at?: string;
};

export type PolicyFilters = {
  status?: PolicyStatus;
};

type UsePoliciesReturn = {
  policies: PolicyListItem[];
  isLoading: boolean;
  error?: string;
  filters: PolicyFilters;
  setFilters: (filters: PolicyFilters) => void;
  refresh: () => void;
};

/** Pure function: builds the API URL for fetching policies with optional status filter. */
export function buildPoliciesUrl(workspaceId: string, filters: PolicyFilters): string {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/policies`;
  const params = new URLSearchParams();

  if (filters.status) params.set("status", filters.status);

  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function usePolicies(): UsePoliciesReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [policies, setPolicies] = useState<PolicyListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filters, setFilters] = useState<PolicyFilters>({});

  const fetchPolicies = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildPoliciesUrl(workspaceId, filters);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { policies: PolicyListItem[] };
      setPolicies(data.policies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policies");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, filters]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchPolicies();
  }, [workspaceId, filters, fetchPolicies]);

  const refresh = useCallback(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  return { policies, isLoading, error, filters, setFilters, refresh };
}
