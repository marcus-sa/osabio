/**
 * AgentStatusSection -- shows agent assignment and live status for tasks.
 *
 * Pure core: deriveAgentStatusView computes what to render from entity + session data.
 * Effect boundary: the component wires useAgentSession for SSE updates and assignAgent for dispatch.
 */

import { useState } from "react";
import type { AgentSessionSummary, EntityKind } from "../../../shared/contracts";
import { useAgentSession, type AgentSessionStatus } from "../../hooks/use-agent-session";
import { assignAgent, type AssignAgentResponse } from "../../graph/orchestrator-api";
import { useWorkspaceState } from "../../stores/workspace-state";
import { usePublicConfig } from "../../hooks/use-public-config";
import { AgentSessionPanel } from "./AgentSessionPanel";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";

// ---------------------------------------------------------------------------
// Pure core: view derivation
// ---------------------------------------------------------------------------

const ASSIGNABLE_STATUSES = new Set(["open", "ready", "todo"]);

export type AgentStatusViewHidden = { variant: "hidden" };
export type AgentStatusViewAssign = { variant: "assign" };
export type AgentStatusViewActive = {
  variant: "active";
  agentSessionId: string;
  orchestratorStatus: string;
  filesChangedCount: number;
  streamId: string;
  startedAt: string;
};

export type AgentStatusView =
  | AgentStatusViewHidden
  | AgentStatusViewAssign
  | AgentStatusViewActive;

export type DeriveAgentStatusInput = {
  entityKind: string;
  entityStatus: string;
  agentSession?: AgentSessionSummary;
};

export function deriveAgentStatusView(input: DeriveAgentStatusInput): AgentStatusView {
  if (input.entityKind !== "task") {
    return { variant: "hidden" };
  }

  if (input.agentSession) {
    return {
      variant: "active",
      agentSessionId: input.agentSession.agentSessionId,
      orchestratorStatus: input.agentSession.orchestratorStatus,
      filesChangedCount: input.agentSession.filesChangedCount,
      streamId: input.agentSession.streamId,
      startedAt: input.agentSession.startedAt,
    };
  }

  if (ASSIGNABLE_STATUSES.has(input.entityStatus)) {
    return { variant: "assign" };
  }

  return { variant: "hidden" };
}

// ---------------------------------------------------------------------------
// Repo path banner visibility
// ---------------------------------------------------------------------------

export function shouldShowRepoPathBanner(input: {
  worktreeManagerEnabled: boolean;
  repoPath: string | undefined;
}): boolean {
  if (!input.worktreeManagerEnabled) return false;
  return input.repoPath === undefined;
}

// ---------------------------------------------------------------------------
// Status badge display
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<AgentSessionStatus, string> = {
  spawning: "Spawning",
  active: "Working",
  idle: "Idle",
  completed: "Completed",
  aborted: "Aborted",
  error: "Error",
};

const STATUS_VARIANTS: Record<AgentSessionStatus, "default" | "secondary" | "destructive" | "outline"> = {
  spawning: "outline",
  active: "default",
  idle: "secondary",
  completed: "secondary",
  aborted: "destructive",
  error: "destructive",
};

function statusLabel(status: AgentSessionStatus): string {
  return STATUS_LABELS[status];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentStatusSection({
  entityId,
  workspaceId,
  entityKind,
  entityStatus,
  agentSession,
}: {
  entityId: string;
  workspaceId: string;
  entityKind: EntityKind;
  entityStatus: string;
  agentSession?: AgentSessionSummary;
}) {
  const repoPath = useWorkspaceState((s) => s.repoPath);
  const setStoreRepoPath = useWorkspaceState((s) => s.setRepoPath);
  const config = usePublicConfig();
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | undefined>();
  const [assignResult, setAssignResult] = useState<AssignAgentResponse | undefined>();
  const [repoPathInput, setRepoPathInput] = useState("");
  const [settingRepoPath, setSettingRepoPath] = useState(false);
  const [repoPathError, setRepoPathError] = useState<string | undefined>();

  const initialView = deriveAgentStatusView({ entityKind, entityStatus, agentSession });

  const streamUrl = assignResult?.streamUrl ?? (
    initialView.variant === "active"
      ? `/api/orchestrator/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(initialView.agentSessionId)}/stream`
      : undefined
  );
  const startedAt = initialView.variant === "active" ? initialView.startedAt : new Date().toISOString();

  const { state: sessionState } = useAgentSession(streamUrl, startedAt);

  const hasActiveStream = streamUrl !== undefined;

  if (initialView.variant === "hidden" && !hasActiveStream) {
    return undefined;
  }

  async function handleAssign() {
    if (assigning) return;
    setAssigning(true);
    setAssignError(undefined);
    try {
      const rawTaskId = entityId.includes(":") ? entityId.split(":")[1] : entityId;
      const result = await assignAgent(workspaceId, rawTaskId);
      setAssignResult(result);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign agent");
    } finally {
      setAssigning(false);
    }
  }

  if (hasActiveStream) {
    const displayStatus = sessionState.status;
    const displayFiles = initialView.variant === "active"
      ? initialView.filesChangedCount + sessionState.filesChanged
      : sessionState.filesChanged;

    const currentSessionId = assignResult?.agentSessionId
      ?? (initialView.variant === "active" ? initialView.agentSessionId : "");

    return (
      <div className="flex flex-col gap-2 px-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent</h4>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANTS[displayStatus]} data-testid="agent-status-badge">
            {statusLabel(displayStatus)}
          </Badge>
          {displayFiles > 0 ? (
            <span className="text-xs text-muted-foreground" data-testid="agent-file-count">
              {displayFiles} file{displayFiles !== 1 ? "s" : ""} changed
            </span>
          ) : undefined}
        </div>
        <AgentSessionPanel
          workspaceId={workspaceId}
          agentSessionId={currentSessionId}
          sessionStatus={displayStatus}
          outputEntries={sessionState.outputEntries}
          stallWarning={sessionState.stallWarning}
          connectionError={sessionState.connectionError}
        />
        {displayStatus === "idle" ? (
          <a
            className="text-xs font-medium text-ring hover:underline"
            data-testid="agent-review-link"
            href={`/review/${encodeURIComponent(currentSessionId)}`}
          >
            Review
          </a>
        ) : undefined}
      </div>
    );
  }

  if (initialView.variant === "assign") {
    const missingRepoPath = shouldShowRepoPathBanner({
      worktreeManagerEnabled: config.worktreeManagerEnabled,
      repoPath,
    });

    return (
      <div className="flex flex-col gap-2 px-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent</h4>
        {missingRepoPath ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3" data-testid="agent-repo-path-banner">
            <p className="text-xs text-muted-foreground">Repository path is not configured for this workspace. Set it before assigning an agent.</p>
            <form
              className="flex items-center gap-1.5"
              data-testid="agent-repo-path-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const trimmed = repoPathInput.trim();
                if (!trimmed || settingRepoPath) return;
                setSettingRepoPath(true);
                setRepoPathError(undefined);
                try {
                  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/repo-path`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: trimmed }),
                  });
                  if (!res.ok) {
                    const body = await res.json().catch(() => ({ error: "Failed to set repository path" }));
                    setRepoPathError(body.error ?? "Failed to set repository path");
                    return;
                  }
                  setStoreRepoPath(trimmed);
                  setRepoPathInput("");
                } catch {
                  setRepoPathError("Network error");
                } finally {
                  setSettingRepoPath(false);
                }
              }}
            >
              <Input
                type="text"
                data-testid="agent-repo-path-input"
                placeholder="/path/to/git/repository"
                value={repoPathInput}
                onChange={(e) => setRepoPathInput(e.target.value)}
                disabled={settingRepoPath}
                className="h-7 flex-1 text-xs"
              />
              <Button
                type="submit"
                size="xs"
                data-testid="agent-repo-path-action"
                disabled={settingRepoPath || repoPathInput.trim().length === 0}
              >
                {settingRepoPath ? "Setting..." : "Set Path"}
              </Button>
            </form>
            {repoPathError ? (
              <p className="text-xs text-destructive" data-testid="agent-repo-path-error">{repoPathError}</p>
            ) : undefined}
          </div>
        ) : undefined}
        <Button
          variant="outline"
          size="sm"
          data-testid="agent-assign-button"
          disabled={assigning || missingRepoPath}
          onClick={handleAssign}
        >
          {assigning ? "Assigning..." : "Assign Agent"}
        </Button>
        {assignError ? (
          <p className="text-xs text-destructive" data-testid="agent-assign-error">{assignError}</p>
        ) : undefined}
      </div>
    );
  }

  return undefined;
}
