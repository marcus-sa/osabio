import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchEntityResponse } from "../../shared/contracts";
import { useWorkspaceState } from "../stores/workspace-state";

type UseEntitySearchReturn = {
  results: SearchEntityResponse[];
  isSearching: boolean;
  query: string;
  setQuery: (q: string) => void;
};

export function useEntitySearch(): UseEntitySearchReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchEntityResponse[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback(
    async (q: string) => {
      if (!workspaceId || !q.trim()) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsSearching(true);
      const params = new URLSearchParams({
        q: q.trim(),
        workspaceId,
        limit: "20",
      });

      try {
        const response = await fetch(`/api/entities/search?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as SearchEntityResponse[];
        if (!controller.signal.aborted) {
          setResults(data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    timerRef.current = setTimeout(() => {
      void search(query);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, search]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { results, isSearching, query, setQuery };
}
