/**
 * Evidence Constants -- Configuration constants for evidence verification
 *
 * Pure values. No IO, no side effects.
 */

/** Tables that can be referenced as evidence for intent authorization. */
export const EVIDENCE_TABLE_ALLOWLIST = new Set([
  "decision",
  "task",
  "feature",
  "project",
  "observation",
  "policy",
  "objective",
  "learning",
  "git_commit",
]);

/** Risk score penalty per missing evidence reference (soft enforcement). */
export const EVIDENCE_SHORTFALL_PENALTY = 20;

/** Minimum number of verified evidence refs for low-tier intents. */
export const LOW_TIER_MIN_COUNT = 1;
