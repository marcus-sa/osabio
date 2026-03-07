import { describe, it, expect, beforeEach, afterEach } from "bun:test";

/**
 * Tests for useAgentReview hook logic.
 *
 * Since bun tests have no React renderer, we test the hook's core logic
 * through its pure state-machine functions and verify it composes the
 * orchestrator-api functions correctly.
 *
 * Behaviors under test:
 *   1. fetchReview: fetches review data, tracks loading/error
 *   2. accept: calls acceptSession, tracks pending/success/error
 *   3. reject: calls rejectSession with feedback, tracks pending/success/error
 */

import {
  reduceReviewAction,
  createInitialReviewState,
  type ReviewState,
  type ReviewAction,
} from "../../../../app/src/client/hooks/use-agent-review";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyActions(initial: ReviewState, actions: ReviewAction[]): ReviewState {
  let state = initial;
  for (const action of actions) {
    state = reduceReviewAction(state, action);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Acceptance: full lifecycle
// ---------------------------------------------------------------------------

describe("useAgentReview state machine", () => {
  describe("fetch review data lifecycle", () => {
    it("transitions from idle to loading to loaded with review data", () => {
      const reviewData = {
        taskTitle: "Fix login bug",
        diff: {
          files: [{ path: "src/auth.ts", status: "modified" as const, additions: 10, deletions: 2 }],
          rawDiff: "diff --git ...",
          stats: { filesChanged: 1, insertions: 10, deletions: 2 },
        },
        session: {
          orchestratorStatus: "idle",
          startedAt: "2026-03-07T12:00:00Z",
        },
      };

      const state = applyActions(createInitialReviewState(), [
        { type: "FETCH_START" },
        { type: "FETCH_SUCCESS", data: reviewData },
      ]);

      expect(state.fetchStatus).toBe("success");
      expect(state.reviewData).toEqual(reviewData);
      expect(state.fetchError).toBeUndefined();
    });

    it("transitions from idle to loading to error on fetch failure", () => {
      const state = applyActions(createInitialReviewState(), [
        { type: "FETCH_START" },
        { type: "FETCH_ERROR", error: "Review not available" },
      ]);

      expect(state.fetchStatus).toBe("error");
      expect(state.reviewData).toBeUndefined();
      expect(state.fetchError).toBe("Review not available");
    });
  });

  describe("accept mutation lifecycle", () => {
    it("transitions through pending to success", () => {
      const state = applyActions(createInitialReviewState(), [
        { type: "ACCEPT_START" },
        { type: "ACCEPT_SUCCESS" },
      ]);

      expect(state.acceptStatus).toBe("success");
      expect(state.acceptError).toBeUndefined();
    });

    it("transitions through pending to error", () => {
      const state = applyActions(createInitialReviewState(), [
        { type: "ACCEPT_START" },
        { type: "ACCEPT_ERROR", error: "Session not idle" },
      ]);

      expect(state.acceptStatus).toBe("error");
      expect(state.acceptError).toBe("Session not idle");
    });

    it("exposes loading state during pending", () => {
      const state = applyActions(createInitialReviewState(), [
        { type: "ACCEPT_START" },
      ]);

      expect(state.acceptStatus).toBe("pending");
    });
  });

  describe("reject mutation lifecycle", () => {
    it("transitions through pending to success", () => {
      const state = applyActions(createInitialReviewState(), [
        { type: "REJECT_START" },
        { type: "REJECT_SUCCESS" },
      ]);

      expect(state.rejectStatus).toBe("success");
      expect(state.rejectError).toBeUndefined();
    });

    it("transitions through pending to error", () => {
      const state = applyActions(createInitialReviewState(), [
        { type: "REJECT_START" },
        { type: "REJECT_ERROR", error: "Cannot reject completed session" },
      ]);

      expect(state.rejectStatus).toBe("error");
      expect(state.rejectError).toBe("Cannot reject completed session");
    });

    it("exposes loading state during pending", () => {
      const state = applyActions(createInitialReviewState(), [
        { type: "REJECT_START" },
      ]);

      expect(state.rejectStatus).toBe("pending");
    });
  });

  describe("initial state", () => {
    it("starts with idle status for all operations", () => {
      const state = createInitialReviewState();

      expect(state.fetchStatus).toBe("idle");
      expect(state.acceptStatus).toBe("idle");
      expect(state.rejectStatus).toBe("idle");
      expect(state.reviewData).toBeUndefined();
      expect(state.fetchError).toBeUndefined();
      expect(state.acceptError).toBeUndefined();
      expect(state.rejectError).toBeUndefined();
    });
  });
});
