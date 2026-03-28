import { FormEvent, useEffect, useState } from "react";
import type { UIMessage } from "ai";
import type {
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  WorkspaceBootstrapMessage,
  WorkspaceBootstrapResponse,
} from "../../shared/contracts";
import { useWorkspaceState, type BootstrapPayload } from "../stores/workspace-state";

const ACTIVE_WORKSPACE_STORAGE_KEY = "brain.activeWorkspaceId";

type UseWorkspaceReturn = {
  isReady: boolean;
  isBootstrapping: boolean;
  isCreatingWorkspace: boolean;
  errorMessage?: string;
  createWorkspaceName: string;
  createWorkspaceDescription: string;
  createWorkspaceRepoPath: string;
  canCreateWorkspace: boolean;
  setCreateWorkspaceName: (name: string) => void;
  setCreateWorkspaceDescription: (description: string) => void;
  setCreateWorkspaceRepoPath: (path: string) => void;
  onCreateWorkspace: (event: FormEvent<HTMLFormElement>) => void;
};

function bootstrapMessagesToUIMessages(messages: WorkspaceBootstrapMessage[]): UIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text" as const, text: m.text }],
    createdAt: new Date(m.createdAt),
  }));
}

function parseBootstrapMessages(payload: WorkspaceBootstrapResponse): BootstrapPayload {
  return { messages: bootstrapMessagesToUIMessages(payload.messages) };
}

export { parseBootstrapMessages, ACTIVE_WORKSPACE_STORAGE_KEY };

export function useWorkspace(): UseWorkspaceReturn {
  const store = useWorkspaceState();
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [createWorkspaceDescription, setCreateWorkspaceDescription] = useState("");
  const [createWorkspaceRepoPath, setCreateWorkspaceRepoPath] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const canCreateWorkspace = createWorkspaceName.trim().length > 0;

  useEffect(() => {
    const existingWorkspaceId = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    if (existingWorkspaceId) {
      void bootstrapWorkspace(existingWorkspaceId);
      return;
    }

    // No cached workspace — try to resolve from the person's identity chain
    void resolveMyWorkspace();
  }, []);

  async function resolveMyWorkspace() {
    try {
      const response = await fetch("/api/workspaces/mine");
      if (!response.ok) return;
      const data = (await response.json()) as { workspaceId?: string; workspaceName?: string };
      if (data.workspaceId) {
        window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, data.workspaceId);
        void bootstrapWorkspace(data.workspaceId);
      }
    } catch {
      // No workspace found — user will see create form
    }
  }

  async function bootstrapWorkspace(workspaceId: string) {
    store.setIsBootstrapping(true);
    setErrorMessage(undefined);

    let response: Response;
    try {
      response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/bootstrap`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Network error";
      setErrorMessage(messageText);
      store.setIsBootstrapping(false);
      return;
    }

    if (!response.ok) {
      if (response.status === 404) {
        window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
        store.clearWorkspace();
      }
      const body = await response.text();
      setErrorMessage(body);
      store.setIsBootstrapping(false);
      return;
    }

    const payload = (await response.json()) as WorkspaceBootstrapResponse;
    applyBootstrapPayload(payload);
    store.setIsBootstrapping(false);
  }

  function applyBootstrapPayload(payload: WorkspaceBootstrapResponse) {
    const parsed = parseBootstrapMessages(payload);

    store.setSeedItems(payload.seeds);
    store.setSidebar(payload.sidebar);
    store.setBootstrapPayload(parsed);
    store.applyWorkspace({
      id: payload.workspaceId,
      name: payload.workspaceName,
      repoPath: payload.repoPath,
      onboardingComplete: payload.onboardingComplete,
      onboardingState: payload.onboardingState,
      conversationId: payload.conversationId,
    });
  }

  async function onCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = createWorkspaceName.trim();
    if (isCreatingWorkspace) {
      return;
    }

    if (!name) {
      setErrorMessage("Workspace name is required");
      return;
    }

    setErrorMessage(undefined);
    setIsCreatingWorkspace(true);

    const description = createWorkspaceDescription.trim();
    const repoPath = createWorkspaceRepoPath.trim();
    const requestBody: CreateWorkspaceRequest = {
      name,
      ...(description.length > 0 ? { description } : {}),
      ...(repoPath.length > 0 ? { repoPath } : {}),
    };

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const body = await response.text();
        setErrorMessage(body);
        return;
      }

      const payload = (await response.json()) as Partial<CreateWorkspaceResponse>;
      if (typeof payload.workspaceId !== "string" || payload.workspaceId.trim().length === 0) {
        throw new Error("create workspace response is missing workspaceId");
      }

      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, payload.workspaceId);
      await bootstrapWorkspace(payload.workspaceId);
      setCreateWorkspaceName("");
      setCreateWorkspaceDescription("");
      setCreateWorkspaceRepoPath("");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Workspace creation failed";
      setErrorMessage(messageText);
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  return {
    isReady: store.workspaceId !== undefined && !store.isBootstrapping,
    isBootstrapping: store.isBootstrapping,
    isCreatingWorkspace,
    errorMessage,
    createWorkspaceName,
    createWorkspaceDescription,
    createWorkspaceRepoPath,
    canCreateWorkspace,
    setCreateWorkspaceName,
    setCreateWorkspaceDescription,
    setCreateWorkspaceRepoPath,
    onCreateWorkspace,
  };
}
