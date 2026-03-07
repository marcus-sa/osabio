/**
 * AgentStatusSection -- shows agent assignment and live status for tasks.
 *
 * Pure core: deriveAgentStatusView computes what to render from entity + session data.
 * Effect boundary: the component wires useAgentSession for SSE updates and assignAgent for dispatch.
 */

import { useState } from "react";
import type { AgentSessionSummary, EntityKind } from "../../../shared/contracts";
import { useAgentSession, type AgentSessionState } from "../../hooks/use-agent-session";
import { assignAgent, type AssignAgentResponse } from "../../graph/orchestrator-api";

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

const STATUS_LABELS: Record<string, string> = {
  spawning: "Spawning",
  active: "Working",
  idle: "Idle",
  completed: "Completed",
  aborted: "Aborted",
  error: "Error",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
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
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | undefined>();
  const [assignResult, setAssignResult] = useState<AssignAgentResponse | undefined>();

  // Derive the initial view from props
  const initialView = deriveAgentStatusView({ entityKind, entityStatus, agentSession });

  // If we have an assign result, use its stream URL; otherwise use session from props
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
      const result = await assignAgent(workspaceId, entityId);
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
        {sessionState.stallWarning ? (
          <p className="agent-stall-warning" data-testid="agent-stall-warning">
            Agent may be stalled (no activity for {sessionState.stallWarning.stallDurationSeconds}s)
          </p>
        ) : undefined}
        {sessionState.connectionError ? (
          <p className="agent-connection-error">{sessionState.connectionError}</p>
        ) : undefined}
      </div>
    );
  }

  // Show assign button
  if (initialView.variant === "assign") {
    return (
      <div className="entity-detail-section agent-status-section">
        <h4>Agent</h4>
        <button
          type="button"
          className="agent-assign-button"
          data-testid="agent-assign-button"
          disabled={assigning}
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
