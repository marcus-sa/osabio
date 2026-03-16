import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useAgentReview, type AsyncStatus } from "../hooks/use-agent-review";
import { DiffViewer } from "../components/review/DiffViewer";
import { AgentActivityLog, type ActivityEntry } from "../components/review/AgentActivityLog";
import type { SessionReviewResponse } from "../graph/orchestrator-api";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";

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
  if (input.acceptStatus === "success") {
    return { viewState: "accepted", taskTitle: input.reviewData?.taskTitle, acceptDisabled: true, rejectSubmitDisabled: true };
  }
  if (input.rejectStatus === "success") {
    return { viewState: "rejected", taskTitle: input.reviewData?.taskTitle, acceptDisabled: true, rejectSubmitDisabled: true };
  }
  if (input.fetchStatus === "idle" || input.fetchStatus === "pending") {
    return { viewState: "loading", acceptDisabled: true, rejectSubmitDisabled: true };
  }
  if (input.fetchStatus === "error") {
    return { viewState: "error", errorMessage: input.fetchError, acceptDisabled: true, rejectSubmitDisabled: true };
  }

  const data = input.reviewData;
  const isMutating = input.acceptStatus === "pending" || input.rejectStatus === "pending";

  return {
    viewState: "review",
    taskTitle: data?.taskTitle,
    agentSummary: undefined,
    rawDiff: data?.diff.rawDiff,
    diffStats: data ? { filesChanged: data.diff.stats.filesChanged, insertions: data.diff.stats.insertions, deletions: data.diff.stats.deletions } : undefined,
    sessionMeta: data ? { orchestratorStatus: data.session.orchestratorStatus, worktreeBranch: data.session.worktreeBranch, startedAt: data.session.startedAt, lastEventAt: data.session.lastEventAt } : undefined,
    acceptDisabled: isMutating,
    rejectSubmitDisabled: isMutating || input.rejectFeedback.trim().length === 0,
  };
}

// ---------------------------------------------------------------------------
// React Component
// ---------------------------------------------------------------------------

function ReviewLoading() {
  return (
    <section className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        <div className="h-32 w-full max-w-2xl animate-pulse rounded bg-muted" />
      </div>
    </section>
  );
}

function ReviewError({ message }: { message?: string }) {
  return (
    <section className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-lg font-semibold text-destructive">Failed to load review</h2>
        <p className="text-sm text-muted-foreground">{message ?? "An unexpected error occurred"}</p>
      </div>
    </section>
  );
}

function ReviewSuccess({ variant, taskTitle }: { variant: "accepted" | "rejected"; taskTitle?: string }) {
  return (
    <section className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-lg font-semibold text-foreground">{variant === "accepted" ? "Changes Accepted" : "Feedback Submitted"}</h2>
        {taskTitle ? <p className="text-sm text-foreground">{taskTitle}</p> : undefined}
        <p className="text-sm text-muted-foreground">
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
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      <span>Status: <Badge variant="secondary">{meta.orchestratorStatus}</Badge></span>
      {meta.worktreeBranch ? <span>Branch: <span className="font-mono">{meta.worktreeBranch}</span></span> : undefined}
      {meta.startedAt ? <span>Started: {new Date(meta.startedAt).toLocaleString()}</span> : undefined}
      {meta.lastEventAt ? <span>Last activity: {new Date(meta.lastEventAt).toLocaleString()}</span> : undefined}
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

  function handleAccept() { void review.accept(); }
  function handleRejectClick() { setShowRejectForm(true); }
  function handleRejectSubmit() {
    if (rejectFeedback.trim().length > 0) void review.reject(rejectFeedback);
  }

  const activityEntries: ActivityEntry[] = [];
  if (review.reviewData?.session?.startedAt) {
    activityEntries.push({
      timestamp: review.reviewData.session.startedAt,
      type: "tool_call",
      description: `Session ${review.reviewData.session.orchestratorStatus}`,
    });
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">{vm.taskTitle}</h1>
        {vm.agentSummary ? <p className="text-sm text-muted-foreground">{vm.agentSummary}</p> : undefined}
      </header>

      {vm.sessionMeta ? <SessionMetadata meta={vm.sessionMeta} /> : undefined}

      <Separator />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Code Changes</h2>
        {vm.rawDiff ? <DiffViewer rawDiff={vm.rawDiff} /> : undefined}
      </div>

      {activityEntries.length > 0 ? (
        <AgentActivityLog entries={activityEntries} />
      ) : undefined}

      <Separator />

      <div className="flex flex-col gap-2">
        {review.acceptError ? <p className="text-sm text-destructive">{review.acceptError}</p> : undefined}
        {review.rejectError ? <p className="text-sm text-destructive">{review.rejectError}</p> : undefined}

        {showRejectForm ? (
          <div className="flex flex-col gap-2">
            <Textarea
              placeholder="Describe what needs to change..."
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowRejectForm(false)}>Cancel</Button>
              <Button variant="destructive" disabled={vm.rejectSubmitDisabled} onClick={handleRejectSubmit}>
                {review.rejectStatus === "pending" ? "Submitting..." : "Submit Feedback"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" disabled={vm.acceptDisabled} onClick={handleRejectClick}>Reject</Button>
            <Button disabled={vm.acceptDisabled} onClick={handleAccept}>
              {review.acceptStatus === "pending" ? "Accepting..." : "Accept"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
