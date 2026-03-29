import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAgents, groupByRuntime, type AgentRuntime, type AgentListItem } from "../hooks/use-agents";
import { useAgentActions } from "../hooks/use-agent-actions";
import { AgentCard } from "../components/agent/agent-card";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const RUNTIME_SECTIONS: { runtime: AgentRuntime; title: string; emptyText: string }[] = [
  { runtime: "osabio", title: "Osabio Agents", emptyText: "No osabio agents found. These are system agents that process your conversations and graph." },
  { runtime: "external", title: "External Agents", emptyText: "No external agents yet. Create one to connect an external coding agent via MCP." },
  { runtime: "sandbox", title: "Sandbox Agents", emptyText: "No sandbox agents yet. Configure a sandbox provider in settings to get started." },
];

type DeleteDialogState = {
  agent: AgentListItem;
  confirmText: string;
};

export function AgentsPage() {
  const { agents, isLoading, error, refresh } = useAgents();
  const { deleteAgent, isSubmitting } = useAgentActions();
  const [deleteState, setDeleteState] = useState<DeleteDialogState | undefined>();
  const navigate = useNavigate();

  const grouped = groupByRuntime(agents);

  async function handleDelete() {
    if (!deleteState) return;
    const success = await deleteAgent(deleteState.agent.id, deleteState.confirmText);
    if (success) {
      setDeleteState(undefined);
      refresh();
    }
  }

  if (error) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <p className="text-sm text-destructive">Failed to load agents: {error}</p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agents</h1>
        <Button size="sm" onClick={() => void navigate({ to: "/agents/new" })}>
          Create Agent
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading agents...</p>
      ) : (
        RUNTIME_SECTIONS.map(({ runtime, title, emptyText }) => {
          const items = grouped[runtime];
          return (
            <div key={runtime} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {title} ({items.length})
              </h2>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  {emptyText}
                </p>
              ) : (
                items.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onDelete={(a) => setDeleteState({ agent: a, confirmText: "" })}
                  />
                ))
              )}
            </div>
          );
        })
      )}

      {deleteState ? (
        <Dialog open onOpenChange={(isOpen) => { if (!isOpen) setDeleteState(undefined); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete {deleteState.agent.name}?</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                This will permanently remove the agent, its identity, authority scopes, and proxy tokens. Type the agent name to confirm.
              </p>
              <Label htmlFor="confirm-name" className="text-xs">
                Type "{deleteState.agent.name}" to confirm
              </Label>
              <Input
                id="confirm-name"
                value={deleteState.confirmText}
                onChange={(e) => setDeleteState({ ...deleteState, confirmText: e.target.value })}
                placeholder={deleteState.agent.name}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setDeleteState(undefined)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteState.confirmText !== deleteState.agent.name || isSubmitting}
                onClick={handleDelete}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : undefined}
    </section>
  );
}
