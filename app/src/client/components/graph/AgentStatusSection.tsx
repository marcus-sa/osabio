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
import { AgentSessionPanel } from "./AgentSessionPanel";

// ---------------------------------------------------------------------------
// Pure core: view derivation
// ---------------------------------------------------------------------------

const ASSIGNABLE_STATUSES = new Set(["ready", "todo"]);

export type AgentStatusViewHidden = { variant: "hidden" };
export type AgentStatusViewAssign = { variant: "assign" };
export type AgentStatusViewActive = {
  variant: "active";
  agentSessionId: string;
  orchestratorStatus: string;
  filesChangedCount: number;
  streamUrl: string;
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
      streamUrl: `/api/orchestrator/stream/${encodeURIComponent(input.agentSession.streamId)}`,
      startedAt: input.agentSession.startedAt,
    };
  }

  if (ASSIGNABLE_STATUSES.has(input.entityStatus)) {
    return { variant: "assign" };
  }

  return { variant: "hidden" };
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
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | undefined>();
  const [assignResult, setAssignResult] = useState<AssignAgentResponse | undefined>();
  const [repoPathInput, setRepoPathInput] = useState("");
  const [settingRepoPath, setSettingRepoPath] = useState(false);
  const [repoPathError, setRepoPathError] = useState<string | undefined>();

  // Derive the initial view from props
  const initialView = deriveAgentStatusView({ entityKind, entityStatus, agentSession });

  // If we have an assign result, use its stream URL; otherwise use session from props.
  // streamUrl is a dependency of useAgentSession's useEffect, so when assignResult
  // arrives and triggers a re-render, the hook will start the SSE subscription.
  const streamUrl = assignResult?.streamUrl ?? (initialView.variant === "active" ? initialView.streamUrl : undefined);
  const startedAt = initialView.variant === "active" ? initialView.startedAt : new Date().toISOString();

  // SSE subscription -- only active when we have a stream URL
  const { state: sessionState } = useAgentSession(streamUrl, startedAt);

  // Determine what to show
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

  // Show active session view (either from props or from fresh assignment)
  if (hasActiveStream) {
    const displayStatus = sessionState.status;
    const displayFiles = initialView.variant === "active"
      ? initialView.filesChangedCount + sessionState.filesChanged
      : sessionState.filesChanged;

    const currentSessionId = assignResult?.agentSessionId
      ?? (initialView.variant === "active" ? initialView.agentSessionId : "");

    return (
      <div className="entity-detail-section agent-status-section">
        <h4>Agent</h4>
        <div className="agent-status-row">
          <span className={`agent-status-badge agent-status-${displayStatus}`} data-testid="agent-status-badge">
            {statusLabel(displayStatus)}
          </span>
          {displayFiles > 0 ? (
            <span className="agent-file-count" data-testid="agent-file-count">
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
            className="agent-review-link"
            data-testid="agent-review-link"
            href={`/review/${encodeURIComponent(currentSessionId)}`}
          >
            Review
          </a>
        ) : undefined}
      </div>
    );
  }

  // Show assign button (with missing repo_path banner when applicable)
  if (initialView.variant === "assign") {
    const missingRepoPath = repoPath === undefined;

    return (
      <div className="entity-detail-section agent-status-section">
        <h4>Agent</h4>
        {missingRepoPath ? (
          <div className="agent-repo-path-banner" data-testid="agent-repo-path-banner">
            <p>Repository path is not configured for this workspace. Set it before assigning an agent.</p>
            <form
              className="agent-repo-path-form"
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
              <input
                type="text"
                className="agent-repo-path-input"
                data-testid="agent-repo-path-input"
                placeholder="/path/to/git/repository"
                value={repoPathInput}
                onChange={(e) => setRepoPathInput(e.target.value)}
                disabled={settingRepoPath}
              />
              <button
                type="submit"
                className="agent-repo-path-action"
                data-testid="agent-repo-path-action"
                disabled={settingRepoPath || repoPathInput.trim().length === 0}
              >
                {settingRepoPath ? "Setting..." : "Set Path"}
              </button>
            </form>
            {repoPathError ? (
              <p className="agent-repo-path-error" data-testid="agent-repo-path-error">{repoPathError}</p>
            ) : undefined}
          </div>
        ) : undefined}
        <button
          type="button"
          className="agent-assign-button"
          data-testid="agent-assign-button"
          disabled={assigning || missingRepoPath}
          onClick={handleAssign}
        >
          {assigning ? "Assigning..." : "Assign Agent"}
        </button>
        {assignError ? (
          <p className="agent-assign-error" data-testid="agent-assign-error">{assignError}</p>
        ) : undefined}
      </div>
    );
  }

  return undefined;
}
