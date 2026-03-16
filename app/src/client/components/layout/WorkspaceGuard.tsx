import type { FormEvent, ReactNode } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";

type WorkspaceGuardProps = {
  isReady: boolean;
  isBootstrapping: boolean;
  isCreatingWorkspace: boolean;
  canCreateWorkspace: boolean;
  createWorkspaceName: string;
  createWorkspaceDescription: string;
  createWorkspaceRepoPath: string;
  errorMessage?: string;
  setCreateWorkspaceName: (name: string) => void;
  setCreateWorkspaceDescription: (description: string) => void;
  setCreateWorkspaceRepoPath: (path: string) => void;
  onCreateWorkspace: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

export function WorkspaceGuard({
  isReady,
  isBootstrapping,
  isCreatingWorkspace,
  canCreateWorkspace,
  createWorkspaceName,
  createWorkspaceDescription,
  createWorkspaceRepoPath,
  errorMessage,
  setCreateWorkspaceName,
  setCreateWorkspaceDescription,
  setCreateWorkspaceRepoPath,
  onCreateWorkspace,
  children,
}: WorkspaceGuardProps) {
  if (isBootstrapping) {
    return (
      <section className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading workspace...</p>
      </section>
    );
  }

  if (!isReady) {
    return (
      <section className="flex h-full items-center justify-center">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Create Workspace</h2>
          <p className="text-sm text-muted-foreground">Name your workspace to get started. Onboarding continues in chat.</p>
          <form onSubmit={onCreateWorkspace} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Workspace name</Label>
              <Input
                value={createWorkspaceName}
                onChange={(event) => setCreateWorkspaceName(event.target.value)}
                placeholder="Acme Labs"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                Description <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                value={createWorkspaceDescription}
                onChange={(event) => setCreateWorkspaceDescription(event.target.value)}
                placeholder="What does this company or workspace do?"
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                Repository path <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={createWorkspaceRepoPath}
                onChange={(event) => setCreateWorkspaceRepoPath(event.target.value)}
                placeholder="/Users/you/projects/your-repo"
              />
            </div>
            <Button type="submit" disabled={!canCreateWorkspace || isCreatingWorkspace}>
              {isCreatingWorkspace ? "Creating..." : "Create Workspace"}
            </Button>
          </form>
          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : undefined}
        </div>
      </section>
    );
  }

  return <>{children}</>;
}
