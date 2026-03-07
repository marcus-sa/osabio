import { describe, it, expect } from "bun:test";

/**
 * Tests for ReviewPage view-model logic.
 *
 * The ReviewPage is a route component at /review/$sessionId.
 * We test the pure view-model derivation that the page uses
 * to map hook state to rendering decisions.
 *
 * Behaviors under test:
 *   1. Loading state: shows skeleton when fetch is pending
 *   2. Error state: shows error message when fetch fails
 *   3. Loaded state: derives task title, diff summary, session metadata
 *   4. Accept flow: accept success transitions to success confirmation
 *   5. Reject flow: reject requires non-empty feedback text
 *   6. Route registration: /review/$sessionId route exists in router config
 */

import {
  deriveReviewViewModel,
  type ReviewPageInput,
} from "../../../../app/src/client/routes/review-page";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLoadedInput(overrides?: Partial<ReviewPageInput>): ReviewPageInput {
  return {
    fetchStatus: "success",
    reviewData: {
      taskTitle: "Add user profile page",
      diff: {
        files: [
          { path: "src/profile.tsx", status: "added", additions: 47, deletions: 0 },
          { path: "src/routes.ts", status: "modified", additions: 3, deletions: 1 },
          { path: "src/old-profile.tsx", status: "deleted", additions: 0, deletions: 12 },
        ],
        rawDiff: "diff --git a/src/profile.tsx ...",
        stats: { filesChanged: 3, insertions: 50, deletions: 13 },
      },
      session: {
        orchestratorStatus: "idle",
        startedAt: "2026-03-07T12:00:00Z",
        lastEventAt: "2026-03-07T12:15:00Z",
      },
    },
    acceptStatus: "idle",
    rejectStatus: "idle",
    rejectFeedback: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Acceptance: Review view shows task title, diff, and session metadata
// ---------------------------------------------------------------------------

describe("ReviewPage view model", () => {
  describe("loading state", () => {
    it("indicates loading when fetch is pending", () => {
      const vm = deriveReviewViewModel({
        fetchStatus: "pending",
        acceptStatus: "idle",
        rejectStatus: "idle",
        rejectFeedback: "",
      });

      expect(vm.viewState).toBe("loading");
    });
  });

  describe("error state", () => {
    it("shows error message when fetch fails", () => {
      const vm = deriveReviewViewModel({
        fetchStatus: "error",
        fetchError: "Session not found",
        acceptStatus: "idle",
        rejectStatus: "idle",
        rejectFeedback: "",
      });

      expect(vm.viewState).toBe("error");
      expect(vm.errorMessage).toBe("Session not found");
    });
  });

  describe("loaded state with review data", () => {
    it("derives task title and agent summary", () => {
      const vm = deriveReviewViewModel(makeLoadedInput());

      expect(vm.viewState).toBe("review");
      expect(vm.taskTitle).toBe("Add user profile page");
      expect(vm.agentSummary).toBeUndefined();
    });

    it("derives diff stats from review data", () => {
      const vm = deriveReviewViewModel(makeLoadedInput());

      expect(vm.diffStats).toEqual({
        filesChanged: 3,
        insertions: 50,
        deletions: 13,
      });
    });

    it("derives session metadata", () => {
      const vm = deriveReviewViewModel(makeLoadedInput());

      expect(vm.sessionMeta).toEqual({
        orchestratorStatus: "idle",
        startedAt: "2026-03-07T12:00:00Z",
        lastEventAt: "2026-03-07T12:15:00Z",
      });
    });

    it("provides raw diff for DiffViewer", () => {
      const vm = deriveReviewViewModel(makeLoadedInput());

      expect(vm.rawDiff).toBe("diff --git a/src/profile.tsx ...");
    });
  });

  describe("accept flow", () => {
    it("accept button is enabled when idle", () => {
      const vm = deriveReviewViewModel(makeLoadedInput());

      expect(vm.acceptDisabled).toBe(false);
    });

    it("accept button is disabled during pending", () => {
      const vm = deriveReviewViewModel(makeLoadedInput({ acceptStatus: "pending" }));

      expect(vm.acceptDisabled).toBe(true);
    });

    it("shows success confirmation after accept", () => {
      const vm = deriveReviewViewModel(makeLoadedInput({ acceptStatus: "success" }));

      expect(vm.viewState).toBe("accepted");
    });
  });

  describe("reject flow", () => {
    it("reject submit is disabled when feedback is empty", () => {
      const vm = deriveReviewViewModel(makeLoadedInput({ rejectFeedback: "" }));

      expect(vm.rejectSubmitDisabled).toBe(true);
    });

    it("reject submit is enabled when feedback is non-empty", () => {
      const vm = deriveReviewViewModel(makeLoadedInput({ rejectFeedback: "Add loading states" }));

      expect(vm.rejectSubmitDisabled).toBe(false);
    });

    it("reject submit is disabled during pending", () => {
      const vm = deriveReviewViewModel(
        makeLoadedInput({ rejectFeedback: "Add loading states", rejectStatus: "pending" }),
      );

      expect(vm.rejectSubmitDisabled).toBe(true);
    });

    it("shows rejection success confirmation", () => {
      const vm = deriveReviewViewModel(makeLoadedInput({ rejectStatus: "success" }));

      expect(vm.viewState).toBe("rejected");
    });
  });

  describe("idle/unloaded state", () => {
    it("shows loading for idle fetch status", () => {
      const vm = deriveReviewViewModel({
        fetchStatus: "idle",
        acceptStatus: "idle",
        rejectStatus: "idle",
        rejectFeedback: "",
      });

      expect(vm.viewState).toBe("loading");
    });
  });
});
