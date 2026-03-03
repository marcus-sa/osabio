import type { FormEvent, ReactNode } from "react";

type WorkspaceGuardProps = {
  isReady: boolean;
  isBootstrapping: boolean;
  isCreatingWorkspace: boolean;
  canCreateWorkspace: boolean;
  createWorkspaceName: string;
  createOwnerName: string;
  errorMessage?: string;
  setCreateWorkspaceName: (name: string) => void;
  setCreateOwnerName: (name: string) => void;
  onCreateWorkspace: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

export function WorkspaceGuard({
  isReady,
  isBootstrapping,
  isCreatingWorkspace,
  canCreateWorkspace,
  createWorkspaceName,
  createOwnerName,
  errorMessage,
  setCreateWorkspaceName,
  setCreateOwnerName,
  onCreateWorkspace,
  children,
}: WorkspaceGuardProps) {
  if (isBootstrapping) {
    return (
      <section className="workspace-setup">
        <p>Loading workspace...</p>
      </section>
    );
  }

  if (!isReady) {
    return (
      <section className="workspace-setup">
        <h2>Create Workspace</h2>
        <p>Start with workspace name and owner identity. Onboarding continues in chat.</p>
        <form onSubmit={onCreateWorkspace} className="workspace-form">
          <label>
            Workspace name
            <input
              value={createWorkspaceName}
              onChange={(event) => setCreateWorkspaceName(event.target.value)}
              placeholder="Acme Labs"
              required
            />
          </label>
          <label>
            Owner display name
            <input
              value={createOwnerName}
              onChange={(event) => setCreateOwnerName(event.target.value)}
              placeholder="Marcus"
              required
            />
          </label>
          <button type="submit" disabled={!canCreateWorkspace || isCreatingWorkspace}>
            {isCreatingWorkspace ? "Creating..." : "Create Workspace"}
          </button>
        </form>
        {errorMessage ? <p className="error-message">{errorMessage}</p> : undefined}
      </section>
    );
  }

  return <>{children}</>;
}
