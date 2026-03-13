import { useCallback, useState } from "react";
import type { LearningType, EntityPriority } from "../../shared/contracts";
import { useWorkspaceState } from "../stores/workspace-state";

export type LearningAction = "approve" | "dismiss" | "deactivate";

export type CreateLearningData = {
  text: string;
  learning_type: LearningType;
  priority: EntityPriority;
  target_agents: string[];
};

export type EditLearningData = {
  text?: string;
  priority?: EntityPriority;
  target_agents?: string[];
};

type RequestInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
};

type UseLearningActionsReturn = {
  approve: (learningId: string) => Promise<boolean>;
  dismiss: (learningId: string) => Promise<boolean>;
  deactivate: (learningId: string) => Promise<boolean>;
  create: (data: CreateLearningData) => Promise<string | undefined>;
  edit: (learningId: string, data: EditLearningData) => Promise<boolean>;
  isSubmitting: boolean;
  error?: string;
};

// --- Pure URL/request builders (exported for testing) ---

export function buildActionUrl(workspaceId: string, learningId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/learnings/${encodeURIComponent(learningId)}/actions`;
}

export function buildEditUrl(workspaceId: string, learningId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/learnings/${encodeURIComponent(learningId)}`;
}

export function buildCreateUrl(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/learnings`;
}

export function buildActionRequest(action: LearningAction): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  };
}

export function buildEditRequest(data: EditLearningData): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

export function buildCreateRequest(data: CreateLearningData): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

// --- Hook ---

export function useLearningActions(): UseLearningActionsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const performAction = useCallback(
    async (learningId: string, action: LearningAction): Promise<boolean> => {
      if (!workspaceId) return false;

      setIsSubmitting(true);
      setError(undefined);

      try {
        const url = buildActionUrl(workspaceId, learningId);
        const request = buildActionRequest(action);
        const response = await fetch(url, request);
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to ${action} learning`);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  const approve = useCallback(
    (learningId: string) => performAction(learningId, "approve"),
    [performAction],
  );

  const dismiss = useCallback(
    (learningId: string) => performAction(learningId, "dismiss"),
    [performAction],
  );

  const deactivate = useCallback(
    (learningId: string) => performAction(learningId, "deactivate"),
    [performAction],
  );

  const create = useCallback(
    async (data: CreateLearningData): Promise<string | undefined> => {
      if (!workspaceId) return undefined;

      setIsSubmitting(true);
      setError(undefined);

      try {
        const url = buildCreateUrl(workspaceId);
        const request = buildCreateRequest(data);
        const response = await fetch(url, request);
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        const result = (await response.json()) as { learningId: string };
        return result.learningId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create learning");
        return undefined;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  const edit = useCallback(
    async (learningId: string, data: EditLearningData): Promise<boolean> => {
      if (!workspaceId) return false;

      setIsSubmitting(true);
      setError(undefined);

      try {
        const url = buildEditUrl(workspaceId, learningId);
        const request = buildEditRequest(data);
        const response = await fetch(url, request);
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to edit learning");
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  return { approve, dismiss, deactivate, create, edit, isSubmitting, error };
}
