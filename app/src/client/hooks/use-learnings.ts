import { useCallback, useEffect, useState } from "react";
import type { LearningSummary, LearningStatus, LearningType } from "../../shared/contracts";
import { useWorkspaceState } from "../stores/workspace-state";

export type LearningFilters = {
  status?: LearningStatus;
  type?: LearningType;
  agent?: string;
};

type UseLearningsReturn = {
  learnings: LearningSummary[];
  isLoading: boolean;
  error?: string;
  filters: LearningFilters;
  setFilters: (filters: LearningFilters) => void;
  refresh: () => void;
};

/** Pure function: builds the API URL for fetching learnings with optional filters. */
export function buildLearningsUrl(workspaceId: string, filters: LearningFilters): string {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/learnings`;
  const params = new URLSearchParams();

  if (filters.status) params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  if (filters.agent) params.set("agent", filters.agent);

  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function useLearnings(): UseLearningsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [learnings, setLearnings] = useState<LearningSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filters, setFilters] = useState<LearningFilters>({});

  const fetchLearnings = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildLearningsUrl(workspaceId, filters);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as {
        learnings: Array<{
          id: string;
          text: string;
          learning_type: string;
          status: string;
          source: string;
          priority: string;
          target_agents: string[];
          suggested_by?: string;
          pattern_confidence?: number;
          created_at: string;
          approved_at?: string;
          dismissed_at?: string;
          dismissed_reason?: string;
          deactivated_at?: string;
        }>;
      };
      setLearnings(
        data.learnings.map((l) => ({
          id: l.id,
          text: l.text,
          learningType: l.learning_type,
          status: l.status,
          source: l.source,
          priority: l.priority,
          targetAgents: l.target_agents,
          suggestedBy: l.suggested_by,
          patternConfidence: l.pattern_confidence,
          createdAt: l.created_at,
          approvedAt: l.approved_at,
          dismissedAt: l.dismissed_at,
          dismissedReason: l.dismissed_reason,
          deactivatedAt: l.deactivated_at,
        })) as LearningSummary[],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load learnings");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, filters]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchLearnings();
  }, [workspaceId, filters, fetchLearnings]);

  const refresh = useCallback(() => {
    void fetchLearnings();
  }, [fetchLearnings]);

  return { learnings, isLoading, error, filters, setFilters, refresh };
}
