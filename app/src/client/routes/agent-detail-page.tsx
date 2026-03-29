import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "@tanstack/react-router";
import { useAgentActions, type AgentDetailResult } from "../hooks/use-agent-actions";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type AgentRuntime = "brain" | "sandbox" | "external";

const RUNTIME_LABELS: Record<AgentRuntime, string> = {
  brain: "Brain",
  sandbox: "Sandbox",
  external: "External",
};

const RUNTIME_VARIANTS: Record<AgentRuntime, "default" | "secondary" | "outline"> = {
  brain: "default",
  sandbox: "secondary",
  external: "outline",
};

const PERMISSION_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  auto: "default",
  propose: "secondary",
  blocked: "destructive",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function AgentDetailPage() {
  const { agentId } = useParams({ strict: false }) as { agentId: string };
  const { fetchDetail, deleteAgent, isSubmitting, error } = useAgentActions();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AgentDetailResult | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    setIsLoading(true);
    void fetchDetail(agentId).then((result) => {
      setDetail(result);
      setIsLoading(false);
    });
  }, [agentId, fetchDetail]);

  if (isLoading) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">Loading agent...</p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <p className="text-sm text-destructive">{error ?? "Agent not found"}</p>
        <Link to="/agents" className="text-sm text-primary hover:underline">
          Back to Agents
        </Link>
      </section>
    );
  }

  const { agent, authority_scopes, sessions } = detail;
  const runtime = agent.runtime as AgentRuntime;
  const isBrain = runtime === "brain";

  async function handleDelete() {
    if (!detail) return;
    const success = await deleteAgent(detail.agent.id, deleteConfirmText);
    if (success) {
      void navigate({ to: "/agents" });
    }
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      {/* Back navigation */}
      <Link to="/agents" className="text-sm text-primary hover:underline">
        Back to Agents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{agent.name}</h1>
            <Badge variant={RUNTIME_VARIANTS[runtime]}>
              {RUNTIME_LABELS[runtime]}
            </Badge>
          </div>
          {agent.description ? (
            <p className="text-sm text-muted-foreground">{agent.description}</p>
          ) : undefined}
          <span className="text-xs text-muted-foreground">
            Created {formatShortDate(agent.created_at)}
          </span>
        </div>
        {!isBrain ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            Delete Agent
          </Button>
        ) : undefined}
      </div>

      {/* Brain read-only note */}
      {isBrain ? (
        <div className="rounded-lg border border-border bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            This is a system agent managed by Brain. Its configuration cannot be edited or deleted.
          </p>
        </div>
      ) : undefined}

      {/* Agent configuration */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Configuration</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border">
                <td className="px-3 py-2 font-medium text-muted-foreground">Runtime</td>
                <td className="px-3 py-2">{RUNTIME_LABELS[runtime]}</td>
              </tr>
              {agent.model ? (
                <tr className="border-b border-border">
                  <td className="px-3 py-2 font-medium text-muted-foreground">Model</td>
                  <td className="px-3 py-2">{agent.model}</td>
                </tr>
              ) : undefined}
              <tr>
                <td className="px-3 py-2 font-medium text-muted-foreground">Identity</td>
                <td className="px-3 py-2">{detail.identity.name}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Authority scopes */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Authority Scopes</h2>
        {authority_scopes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No authority scopes configured.</p>
        ) : (
          <div className="rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Action</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Permission</th>
                </tr>
              </thead>
              <tbody>
                {authority_scopes.map((scope) => (
                  <tr key={scope.action} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2">{scope.action}</td>
                    <td className="px-3 py-2">
                      <Badge variant={PERMISSION_VARIANTS[scope.permission] ?? "outline"}>
                        {scope.permission}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent workspace sessions */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Recent Workspace Sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent sessions.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((session) => (
              <div key={session.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(session.started_at)}
                    {session.ended_at ? ` - ${formatDate(session.ended_at)}` : " (active)"}
                  </span>
                  {session.orchestrator_status ? (
                    <Badge variant="outline">{session.orchestrator_status}</Badge>
                  ) : undefined}
                </div>
                {session.summary ? (
                  <p className="mt-1 text-sm">{session.summary}</p>
                ) : undefined}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteDialog && detail ? (
        <Dialog open onOpenChange={(isOpen) => { if (!isOpen) { setShowDeleteDialog(false); setDeleteConfirmText(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete {agent.name}?</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                This will permanently remove the agent, its identity, authority scopes, and proxy tokens. Type the agent name to confirm.
              </p>
              <Label htmlFor="confirm-delete-name" className="text-xs">
                Type &quot;{agent.name}&quot; to confirm
              </Label>
              <Input
                id="confirm-delete-name"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={agent.name}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => { setShowDeleteDialog(false); setDeleteConfirmText(""); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteConfirmText !== agent.name || isSubmitting}
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
