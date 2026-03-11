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
