import { useCallback, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

export type AuthorityPermission = "auto" | "propose" | "blocked";

export type AuthorityScopeInput = {
  action: string;
  permission: AuthorityPermission;
};

export type CreateAgentInput = {
  name: string;
  description?: string;
  runtime: "sandbox" | "external";
  model?: string;
  authority_scopes?: AuthorityScopeInput[];
};

export type CreateAgentResult = {
  agent: {
    id: string;
    name: string;
    description?: string;
    runtime: string;
    model?: string;
    identity_id: string;
    created_at: string;
  };
  proxy_token?: string;
  workspace_id: string;
};

export type AgentDetailResult = {
  agent: {
    id: string;
    name: string;
    description?: string;
    runtime: string;
    model?: string;
    identity_id: string;
    created_at: string;
  };
  identity: { id: string; name: string; type: string; role?: string };
  authority_scopes: Array<{ action: string; permission: string }>;
  sessions: Array<{
    id: string;
    started_at: string;
    ended_at?: string;
    orchestrator_status?: string;
    summary?: string;
  }>;
};

type UseAgentActionsReturn = {
  isSubmitting: boolean;
  error?: string;
  createAgent: (input: CreateAgentInput) => Promise<CreateAgentResult | undefined>;
  deleteAgent: (agentId: string, confirmName: string) => Promise<boolean>;
  fetchDetail: (agentId: string) => Promise<AgentDetailResult | undefined>;
  checkName: (name: string) => Promise<boolean>;
  clearError: () => void;
};

export function buildCreateUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/agents`;
}

export function buildDetailUrl(workspaceId: string, agentId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`;
}

export function buildDeleteUrl(workspaceId: string, agentId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`;
}

export function buildCheckNameUrl(workspaceId: string, name: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/agents/check-name?name=${encodeURIComponent(name)}`;
}

export function useAgentActions(): UseAgentActionsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const clearError = useCallback(() => setError(undefined), []);

  const createAgent = useCallback(
    async (input: CreateAgentInput): Promise<CreateAgentResult | undefined> => {
      if (!workspaceId) return undefined;
      setIsSubmitting(true);
      setError(undefined);
      try {
        const response = await fetch(buildCreateUrl(workspaceId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return (await response.json()) as CreateAgentResult;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create agent");
        return undefined;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  const deleteAgent = useCallback(
    async (agentId: string, confirmName: string): Promise<boolean> => {
      if (!workspaceId) return false;
      setIsSubmitting(true);
      setError(undefined);
      try {
        const response = await fetch(buildDeleteUrl(workspaceId, agentId), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm_name: confirmName }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete agent");
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  const fetchDetail = useCallback(
    async (agentId: string): Promise<AgentDetailResult | undefined> => {
      if (!workspaceId) return undefined;
      try {
        const response = await fetch(buildDetailUrl(workspaceId, agentId));
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return (await response.json()) as AgentDetailResult;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agent detail");
        return undefined;
      }
    },
    [workspaceId],
  );

  const checkName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!workspaceId) return false;
      try {
        const response = await fetch(buildCheckNameUrl(workspaceId, name));
        if (!response.ok) return false;
        const data = (await response.json()) as { available: boolean };
        return data.available;
      } catch {
        return false;
      }
    },
    [workspaceId],
  );

  return { isSubmitting, error, createAgent, deleteAgent, fetchDetail, checkName, clearError };
}
