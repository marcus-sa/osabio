import { useCallback, useEffect, useRef, useState } from "react";
import type { GovernanceFeedResponse } from "../../shared/contracts";
import { useWorkspaceState } from "../stores/workspace-state";

const POLL_INTERVAL_MS = 30_000;

type UseGovernanceFeedReturn = {
  feed: GovernanceFeedResponse | undefined;
  isLoading: boolean;
  error: string | undefined;
  refresh: () => void;
};

export function useGovernanceFeed(): UseGovernanceFeedReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [feed, setFeed] = useState<GovernanceFeedResponse | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchFeed = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/feed`,
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as GovernanceFeedResponse;
      setFeed(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feed");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    void fetchFeed();

    timerRef.current = setInterval(() => {
      void fetchFeed();
    }, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [workspaceId, fetchFeed]);

  const refresh = useCallback(() => {
    void fetchFeed();
  }, [fetchFeed]);

  return { feed, isLoading, error, refresh };
}
