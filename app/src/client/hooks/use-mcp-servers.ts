import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type McpServerListItem = {
  id: string;
  name: string;
  url: string;
  transport: string;
  auth_mode: string;
  has_static_headers: boolean;
  last_status?: string;
  last_error?: string;
  provider_id?: string;
  provider_name?: string;
  tool_count: number;
  created_at: string;
};

type UseMcpServersReturn = {
  mcpServers: McpServerListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

/** Pure function: builds the API URL for fetching MCP servers. */
export function buildMcpServersUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-servers`;
}

export function useMcpServers(): UseMcpServersReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [mcpServers, setMcpServers] = useState<McpServerListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchMcpServers = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildMcpServersUrl(workspaceId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { servers: McpServerListItem[] };
      setMcpServers(data.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP servers");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchMcpServers();
  }, [workspaceId, fetchMcpServers]);

  const refresh = useCallback(() => {
    void fetchMcpServers();
  }, [fetchMcpServers]);

  return { mcpServers, isLoading, error, refresh };
}
