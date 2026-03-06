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
  createOwnerName: string;
  createOwnerEmail: string;
  createWorkspaceDescription: string;
  canCreateWorkspace: boolean;
  setCreateWorkspaceName: (name: string) => void;
  setCreateOwnerName: (name: string) => void;
  setCreateOwnerEmail: (email: string) => void;
  setCreateWorkspaceDescription: (description: string) => void;
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
  const [createOwnerName, setCreateOwnerName] = useState("");
  const [createOwnerEmail, setCreateOwnerEmail] = useState("");
  const [createWorkspaceDescription, setCreateWorkspaceDescription] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const canCreateWorkspace =
    createWorkspaceName.trim().length > 0 && createOwnerName.trim().length > 0 && createOwnerEmail.trim().length > 0;

  useEffect(() => {
    const existingWorkspaceId = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    if (!existingWorkspaceId) {
      return;
    }

    void bootstrapWorkspace(existingWorkspaceId);
  }, []);

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
      onboardingComplete: payload.onboardingComplete,
      onboardingState: payload.onboardingState,
      conversationId: payload.conversationId,
    });
  }

  async function onCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = createWorkspaceName.trim();
    const ownerDisplayName = createOwnerName.trim();
    const ownerEmail = createOwnerEmail.trim();
    if (isCreatingWorkspace) {
      return;
    }

    if (!name || !ownerDisplayName || !ownerEmail) {
      setErrorMessage("Workspace name, owner display name, and email are required");
      return;
    }

    setErrorMessage(undefined);
    setIsCreatingWorkspace(true);

    const description = createWorkspaceDescription.trim();
    const requestBody: CreateWorkspaceRequest = {
      name,
      ownerDisplayName,
      ownerEmail,
      ...(description.length > 0 ? { description } : {}),
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
      setCreateOwnerName("");
      setCreateOwnerEmail("");
      setCreateWorkspaceDescription("");
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
    createOwnerName,
    createOwnerEmail,
    createWorkspaceDescription,
    canCreateWorkspace,
    setCreateWorkspaceName,
    setCreateOwnerName,
    setCreateOwnerEmail,
    setCreateWorkspaceDescription,
    onCreateWorkspace,
  };
}
