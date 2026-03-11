/**
 * Verification pipeline: pure core functions for claim-vs-reality comparison.
 *
 * Pipeline: receiveEvent -> gatherSignals -> compareClaimVsReality -> createObservation
 *
 * All functions in this module are pure (no IO). The effect shell lives in observer-route.ts.
 */

import type { ExternalSignal, GatherSignalsResult } from "./external-signals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = "match" | "mismatch" | "inconclusive";

export type VerificationResult = {
  verdict: Verdict;
  severity: "info" | "warning" | "conflict";
  verified: boolean;
  text: string;
  source?: string;
};

export type IntentStatus = "completed" | "failed" | string;

export type IntentSignals = {
  status: IntentStatus;
  goal: string;
  hasTrace: boolean;
};

export type DecisionStatus = "confirmed" | "superseded" | string;

export type DecisionSignals = {
  status: DecisionStatus;
  summary: string;
  completedTaskCount: number;
};

// ---------------------------------------------------------------------------
// Pure comparison: claim vs reality for task completion
// ---------------------------------------------------------------------------

export function compareTaskCompletion(
  signalsResult: GatherSignalsResult,
): VerificationResult {
  // No commits linked -> inconclusive
  if (!signalsResult.hasCommits || signalsResult.signals.length === 0) {
    return {
      verdict: "inconclusive",
      severity: "info",
      verified: false,
      text: "Unable to verify task completion: no external signals (commits or CI) found for this task.",
    };
  }

  // Check CI status across all signals
  const ciSignals = signalsResult.signals.filter(
    (signal) => signal.ciStatus !== "unknown",
  );

  // All signals unknown -> inconclusive
  if (ciSignals.length === 0) {
    return {
      verdict: "inconclusive",
      severity: "info",
      verified: false,
      text: "Unable to verify task completion: CI status unavailable for linked commits.",
      source: signalsResult.signals[0]?.source,
    };
  }

  // Any failing CI -> mismatch
  const failingSignals = ciSignals.filter(
    (signal) => signal.ciStatus === "failure",
  );

  if (failingSignals.length > 0) {
    const failingShas = failingSignals.map((s) => s.sha.slice(0, 8)).join(", ");
    return {
      verdict: "mismatch",
      severity: "conflict",
      verified: false,
      text: `Task marked as completed but CI is failing for commit(s): ${failingShas}. Claim does not match reality.`,
      source: failingSignals[0]?.source,
    };
  }

  // Any pending CI -> inconclusive (not verified yet)
  const pendingSignals = ciSignals.filter(
    (signal) => signal.ciStatus === "pending",
  );

  if (pendingSignals.length > 0) {
    return {
      verdict: "inconclusive",
      severity: "info",
      verified: false,
      text: "Task completion verification pending: CI checks still running.",
      source: pendingSignals[0]?.source,
    };
  }

  // All passing -> match
  const source = ciSignals[0]?.source;
  return {
    verdict: "match",
    severity: "info",
    verified: true,
    text: "Task completion verified: all linked CI checks are passing.",
    source,
  };
}

// ---------------------------------------------------------------------------
// Pure comparison: intent completion verification
// ---------------------------------------------------------------------------

export function compareIntentCompletion(
  signals: IntentSignals,
): VerificationResult {
  if (signals.status === "completed") {
    return {
      verdict: "match",
      severity: "info",
      verified: true,
      text: `Intent completed successfully: ${signals.goal}`,
      source: signals.hasTrace ? "trace" : undefined,
    };
  }

  if (signals.status === "failed") {
    return {
      verdict: "mismatch",
      severity: "warning",
      verified: false,
      text: `Intent failed: ${signals.goal}`,
      source: signals.hasTrace ? "trace" : undefined,
    };
  }

  return {
    verdict: "inconclusive",
    severity: "info",
    verified: false,
    text: `Intent in unexpected status '${signals.status}': ${signals.goal}`,
  };
}

// ---------------------------------------------------------------------------
// Pure comparison: commit verification
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pure comparison: decision confirmation/supersession verification
// ---------------------------------------------------------------------------

export function compareDecisionConfirmation(
  signals: DecisionSignals,
): VerificationResult {
  if (signals.status === "confirmed") {
    if (signals.completedTaskCount === 0) {
      return {
        verdict: "inconclusive",
        severity: "info",
        verified: false,
        text: `Decision confirmed: "${signals.summary}". No completed tasks found in workspace to verify alignment.`,
      };
    }

    return {
      verdict: "match",
      severity: "info",
      verified: true,
      text: `Decision confirmed: "${signals.summary}". Found ${signals.completedTaskCount} completed task(s) in workspace. Alignment check performed.`,
    };
  }

  if (signals.status === "superseded") {
    if (signals.completedTaskCount === 0) {
      return {
        verdict: "inconclusive",
        severity: "info",
        verified: false,
        text: `Decision superseded: "${signals.summary}". No completed tasks found that may be affected.`,
      };
    }

    return {
      verdict: "mismatch",
      severity: "warning",
      verified: false,
      text: `Decision superseded: "${signals.summary}". Found ${signals.completedTaskCount} completed task(s) that may now be based on an outdated decision. Review implementations for staleness.`,
    };
  }

  return {
    verdict: "inconclusive",
    severity: "info",
    verified: false,
    text: `Decision in unexpected status '${signals.status}': "${signals.summary}"`,
  };
}

export function compareCommitStatus(
  signalsResult: GatherSignalsResult,
): VerificationResult {
  // No CI signals available -> inconclusive
  if (signalsResult.signals.length === 0) {
    return {
      verdict: "inconclusive",
      severity: "info",
      verified: false,
      text: "Commit recorded: no CI status available for verification.",
    };
  }

  const ciSignals = signalsResult.signals.filter(
    (signal) => signal.ciStatus !== "unknown",
  );

  if (ciSignals.length === 0) {
    return {
      verdict: "inconclusive",
      severity: "info",
      verified: false,
      text: "Commit recorded: CI status unavailable.",
      source: signalsResult.signals[0]?.source,
    };
  }

  const failingSignals = ciSignals.filter(
    (signal) => signal.ciStatus === "failure",
  );

  if (failingSignals.length > 0) {
    return {
      verdict: "mismatch",
      severity: "warning",
      verified: false,
      text: `Commit has failing CI: ${failingSignals.map((s) => s.sha.slice(0, 8)).join(", ")}`,
      source: failingSignals[0]?.source,
    };
  }

  const pendingSignals = ciSignals.filter(
    (signal) => signal.ciStatus === "pending",
  );

  if (pendingSignals.length > 0) {
    return {
      verdict: "inconclusive",
      severity: "info",
      verified: false,
      text: "Commit verification pending: CI checks still running.",
      source: pendingSignals[0]?.source,
    };
  }

  return {
    verdict: "match",
    severity: "info",
    verified: true,
    text: "Commit verified: all CI checks passing.",
    source: ciSignals[0]?.source,
  };
}
