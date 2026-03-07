import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useAgentReview, type AsyncStatus } from "../hooks/use-agent-review";
import { DiffViewer } from "../components/review/DiffViewer";
import { AgentActivityLog, type ActivityEntry } from "../components/review/AgentActivityLog";
import type { SessionReviewResponse } from "../graph/orchestrator-api";

const ACTIVE_WORKSPACE_STORAGE_KEY = "brain.activeWorkspaceId";

// ---------------------------------------------------------------------------
// Pure View Model (testable)
// ---------------------------------------------------------------------------

export type ReviewPageInput = {
  fetchStatus: AsyncStatus;
  fetchError?: string;
  reviewData?: SessionReviewResponse;
  acceptStatus: AsyncStatus;
  acceptError?: string;
  rejectStatus: AsyncStatus;
  rejectError?: string;
  rejectFeedback: string;
};

export type ReviewViewModel = {
  viewState: "loading" | "error" | "review" | "accepted" | "rejected";
  errorMessage?: string;
  taskTitle?: string;
  agentSummary?: string;
  rawDiff?: string;
  diffStats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  sessionMeta?: {
    orchestratorStatus: string;
    worktreeBranch?: string;
    startedAt?: string;
    lastEventAt?: string;
  };
  acceptDisabled: boolean;
  rejectSubmitDisabled: boolean;
};

export function deriveReviewViewModel(input: ReviewPageInput): ReviewViewModel {
  // Accept/reject success states take priority
  if (input.acceptStatus === "success") {
    return {
      viewState: "accepted",
      taskTitle: input.reviewData?.taskTitle,
      acceptDisabled: true,
      rejectSubmitDisabled: true,
    };
  }

  if (input.rejectStatus === "success") {
    return {
      viewState: "rejected",
      taskTitle: input.reviewData?.taskTitle,
      acceptDisabled: true,
      rejectSubmitDisabled: true,
    };
  }

  // Loading states
  if (input.fetchStatus === "idle" || input.fetchStatus === "pending") {
    return {
      viewState: "loading",
      acceptDisabled: true,
      rejectSubmitDisabled: true,
    };
  }

  // Error state
  if (input.fetchStatus === "error") {
    return {
      viewState: "error",
      errorMessage: input.fetchError,
      acceptDisabled: true,
      rejectSubmitDisabled: true,
    };
  }

  // Loaded with review data
  const data = input.reviewData;
  const isMutating = input.acceptStatus === "pending" || input.rejectStatus === "pending";

  return {
    viewState: "review",
    taskTitle: data?.taskTitle,
    agentSummary: undefined,
    rawDiff: data?.diff.rawDiff,
    diffStats: data ? {
      filesChanged: data.diff.stats.filesChanged,
      insertions: data.diff.stats.insertions,
      deletions: data.diff.stats.deletions,
    } : undefined,
    sessionMeta: data ? {
      orchestratorStatus: data.session.orchestratorStatus,
      worktreeBranch: data.session.worktreeBranch,
      startedAt: data.session.startedAt,
      lastEventAt: data.session.lastEventAt,
    } : undefined,
    acceptDisabled: isMutating,
    rejectSubmitDisabled: isMutating || input.rejectFeedback.trim().length === 0,
  };
}

// ---------------------------------------------------------------------------
// React Component
// ---------------------------------------------------------------------------

function ReviewLoading() {
  return (
    <section className="review-page review-page--loading">
      <div className="review-skeleton">
        <div className="review-skeleton-title" />
        <div className="review-skeleton-summary" />
        <div className="review-skeleton-diff" />
      </div>
    </section>
  );
}

function ReviewError({ message }: { message?: string }) {
  return (
    <section className="review-page review-page--error">
      <div className="review-error">
        <h2>Failed to load review</h2>
        <p>{message ?? "An unexpected error occurred"}</p>
      </div>
    </section>
  );
}

function ReviewSuccess({ variant, taskTitle }: { variant: "accepted" | "rejected"; taskTitle?: string }) {
  return (
    <section className="review-page review-page--success">
      <div className="review-success">
        <h2>{variant === "accepted" ? "Changes Accepted" : "Feedback Submitted"}</h2>
        {taskTitle ? <p>{taskTitle}</p> : undefined}
        <p>
          {variant === "accepted"
            ? "The agent's changes have been accepted and will be merged."
            : "Your feedback has been sent. The agent will continue working on this task."}
        </p>
      </div>
    </section>
  );
}

function SessionMetadata({ meta }: { meta: NonNullable<ReviewViewModel["sessionMeta"]> }) {
  return (
    <div className="review-session-meta">
      <span className="review-meta-item">Status: {meta.orchestratorStatus}</span>
      {meta.worktreeBranch ? (
        <span className="review-meta-item">Branch: {meta.worktreeBranch}</span>
      ) : undefined}
      {meta.startedAt ? (
        <span className="review-meta-item">Started: {new Date(meta.startedAt).toLocaleString()}</span>
      ) : undefined}
      {meta.lastEventAt ? (
        <span className="review-meta-item">Last activity: {new Date(meta.lastEventAt).toLocaleString()}</span>
      ) : undefined}
    </div>
  );
}

export function ReviewPage() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string };
  const workspaceId = typeof window !== "undefined"
    ? window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) ?? ""
    : "";

  const review = useAgentReview(workspaceId, sessionId);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const vm = deriveReviewViewModel({
    fetchStatus: review.fetchStatus,
    fetchError: review.fetchError,
    reviewData: review.reviewData,
    acceptStatus: review.acceptStatus,
    acceptError: review.acceptError,
    rejectStatus: review.rejectStatus,
    rejectError: review.rejectError,
    rejectFeedback,
  });

  if (vm.viewState === "loading") return <ReviewLoading />;
  if (vm.viewState === "error") return <ReviewError message={vm.errorMessage} />;
  if (vm.viewState === "accepted") return <ReviewSuccess variant="accepted" taskTitle={vm.taskTitle} />;
  if (vm.viewState === "rejected") return <ReviewSuccess variant="rejected" taskTitle={vm.taskTitle} />;

  function handleAccept() {
    void review.accept();
  }

  function handleRejectClick() {
    setShowRejectForm(true);
  }

  function handleRejectSubmit() {
    if (rejectFeedback.trim().length > 0) {
      void review.reject(rejectFeedback);
    }
  }

  // Build activity entries from session data if available
  const activityEntries: ActivityEntry[] = [];
  if (review.reviewData?.session?.startedAt) {
    activityEntries.push({
      timestamp: review.reviewData.session.startedAt,
      type: "tool_call",
      description: `Session ${review.reviewData.session.orchestratorStatus}`,
    });
  }

  return (
    <section className="review-page">
      <header className="review-header">
        <h1 className="review-title">{vm.taskTitle}</h1>
        {vm.agentSummary ? (
          <p className="review-summary">{vm.agentSummary}</p>
        ) : undefined}
      </header>

      {vm.sessionMeta ? <SessionMetadata meta={vm.sessionMeta} /> : undefined}

      <div className="review-diff-section">
        <h2>Code Changes</h2>
        {vm.rawDiff ? <DiffViewer rawDiff={vm.rawDiff} /> : undefined}
      </div>

      {activityEntries.length > 0 ? (
        <div className="review-activity-section">
          <AgentActivityLog entries={activityEntries} />
        </div>
      ) : undefined}

      <div className="review-actions">
        {review.acceptError ? (
          <p className="review-action-error">{review.acceptError}</p>
        ) : undefined}
        {review.rejectError ? (
          <p className="review-action-error">{review.rejectError}</p>
        ) : undefined}

        {showRejectForm ? (
          <div className="review-reject-form">
            <textarea
              className="review-reject-textarea"
              placeholder="Describe what needs to change..."
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
            />
            <div className="review-reject-actions">
              <button
                type="button"
                className="review-btn review-btn--cancel"
                onClick={() => setShowRejectForm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="review-btn review-btn--reject-submit"
                disabled={vm.rejectSubmitDisabled}
                onClick={handleRejectSubmit}
              >
                {review.rejectStatus === "pending" ? "Submitting..." : "Submit Feedback"}
              </button>
            </div>
          </div>
        ) : (
          <div className="review-action-buttons">
            <button
              type="button"
              className="review-btn review-btn--reject"
              disabled={vm.acceptDisabled}
              onClick={handleRejectClick}
            >
              Reject
            </button>
            <button
              type="button"
              className="review-btn review-btn--accept"
              disabled={vm.acceptDisabled}
              onClick={handleAccept}
            >
              {review.acceptStatus === "pending" ? "Accepting..." : "Accept"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
