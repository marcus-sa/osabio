import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";

// ---------------------------------------------------------------------------
// Domain types mirroring backend SkillListItem / SkillDetailResponse
// ---------------------------------------------------------------------------

export type SkillStatus = "draft" | "active" | "deprecated";

export type SkillSourceType = "github" | "git";

export type SkillSource = {
  type: SkillSourceType;
  source: string;
  ref?: string;
  subpath?: string;
  skills?: string[];
};

export type SkillListItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  status: SkillStatus;
  source: SkillSource;
  required_tools: Array<{ id: string; name: string }>;
  agent_count: number;
  created_at: string;
};

export type SkillDetailResponse = {
  skill: SkillListItem & {
    created_by?: string;
    updated_at?: string;
  };
  required_tools: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  governed_by: Array<{ id: string; name: string; status: string }>;
};

export type CreateSkillInput = {
  name: string;
  description: string;
  version: string;
  source: SkillSource;
  required_tool_ids?: string[];
};

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

export function buildSkillsUrl(workspaceId: string, status?: SkillStatus): string {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/skills`;
  return status ? `${base}?status=${encodeURIComponent(status)}` : base;
}

export function buildSkillDetailUrl(workspaceId: string, skillId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(skillId)}`;
}

export function buildSkillActivateUrl(workspaceId: string, skillId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(skillId)}/activate`;
}

export function buildSkillDeprecateUrl(workspaceId: string, skillId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(skillId)}/deprecate`;
}

// ---------------------------------------------------------------------------
// useSkills — list skills with optional status filter
// ---------------------------------------------------------------------------

type UseSkillsReturn = {
  skills: SkillListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

export function useSkills(statusFilter?: SkillStatus): UseSkillsReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchSkills = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildSkillsUrl(workspaceId, statusFilter);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as { skills: SkillListItem[] };
      setSkills(data.skills);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, statusFilter]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchSkills();
  }, [workspaceId, fetchSkills]);

  const refresh = useCallback(() => {
    void fetchSkills();
  }, [fetchSkills]);

  return { skills, isLoading, error, refresh };
}

// ---------------------------------------------------------------------------
// useSkillDetail — fetch a single skill's full detail
// ---------------------------------------------------------------------------

type UseSkillDetailReturn = {
  detail?: SkillDetailResponse;
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

export function useSkillDetail(skillId: string): UseSkillDetailReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [detail, setDetail] = useState<SkillDetailResponse | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const fetchDetail = useCallback(async () => {
    if (!workspaceId || !skillId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildSkillDetailUrl(workspaceId, skillId);
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      const data = (await response.json()) as SkillDetailResponse;
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skill detail");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, skillId]);

  useEffect(() => {
    if (!workspaceId || !skillId) return;
    void fetchDetail();
  }, [workspaceId, skillId, fetchDetail]);

  const refresh = useCallback(() => {
    void fetchDetail();
  }, [fetchDetail]);

  return { detail, isLoading, error, refresh };
}

// ---------------------------------------------------------------------------
// useCreateSkill — POST a new skill
// ---------------------------------------------------------------------------

type UseCreateSkillReturn = {
  isSubmitting: boolean;
  error?: string;
  createSkill: (input: CreateSkillInput) => Promise<SkillListItem | undefined>;
  clearError: () => void;
};

export function useCreateSkill(): UseCreateSkillReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const clearError = useCallback(() => setError(undefined), []);

  const createSkill = useCallback(
    async (input: CreateSkillInput): Promise<SkillListItem | undefined> => {
      if (!workspaceId) return undefined;
      setIsSubmitting(true);
      setError(undefined);
      try {
        const url = buildSkillsUrl(workspaceId);
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        const data = (await response.json()) as { skill: SkillListItem };
        return data.skill;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create skill");
        return undefined;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  return { isSubmitting, error, createSkill, clearError };
}

// ---------------------------------------------------------------------------
// useActivateSkill — POST to activate a draft skill
// ---------------------------------------------------------------------------

type UseSkillLifecycleReturn = {
  isSubmitting: boolean;
  error?: string;
  execute: (skillId: string) => Promise<boolean>;
  clearError: () => void;
};

export function useActivateSkill(): UseSkillLifecycleReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const clearError = useCallback(() => setError(undefined), []);

  const execute = useCallback(
    async (skillId: string): Promise<boolean> => {
      if (!workspaceId) return false;
      setIsSubmitting(true);
      setError(undefined);
      try {
        const url = buildSkillActivateUrl(workspaceId, skillId);
        const response = await fetch(url, { method: "POST" });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to activate skill");
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  return { isSubmitting, error, execute, clearError };
}

// ---------------------------------------------------------------------------
// useDeprecateSkill — POST to deprecate an active skill
// ---------------------------------------------------------------------------

export function useDeprecateSkill(): UseSkillLifecycleReturn {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const clearError = useCallback(() => setError(undefined), []);

  const execute = useCallback(
    async (skillId: string): Promise<boolean> => {
      if (!workspaceId) return false;
      setIsSubmitting(true);
      setError(undefined);
      try {
        const url = buildSkillDeprecateUrl(workspaceId, skillId);
        const response = await fetch(url, { method: "POST" });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to deprecate skill");
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [workspaceId],
  );

  return { isSubmitting, error, execute, clearError };
}
