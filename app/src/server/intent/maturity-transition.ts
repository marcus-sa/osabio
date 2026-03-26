/**
 * Maturity Transition -- Pure function for workspace enforcement mode transition.
 *
 * Determines whether a workspace in "soft" enforcement mode should auto-transition
 * to "hard" based on accumulated confirmed decisions and completed tasks.
 *
 * Architecture Decision WD-08: Lazy Maturity Evaluation
 * Transitions are evaluated lazily at intent evaluation time.
 */

import type { EvidenceEnforcementMode } from "./evidence-types";

// --- Types ---

export type MaturityThreshold = {
  min_decisions: number;
  min_tasks: number;
};

export type MaturityCheckInput = {
  currentMode: EvidenceEnforcementMode;
  confirmedDecisionCount: number;
  completedTaskCount: number;
  threshold: MaturityThreshold | undefined;
};

// --- Pure Function ---

/**
 * Determines whether a workspace should transition from soft to hard enforcement.
 *
 * Returns true only when:
 * 1. Current mode is "soft" (only soft transitions to hard)
 * 2. A threshold is configured
 * 3. Both confirmed decisions and completed tasks meet or exceed the threshold
 */
// --- Bootstrap -> Soft Transition ---

export type BootstrapCheckInput = {
  currentMode: EvidenceEnforcementMode;
  confirmedDecisionCount: number;
};

/**
 * Determines whether a workspace should transition from bootstrap to soft enforcement.
 *
 * Returns true only when:
 * 1. Current mode is "bootstrap"
 * 2. At least one confirmed decision exists in the workspace
 */
export function shouldTransitionToSoftEnforcement(input: BootstrapCheckInput): boolean {
  if (input.currentMode !== "bootstrap") return false;
  return input.confirmedDecisionCount >= 1;
}

// --- Soft -> Hard Transition ---

export function shouldTransitionToHardEnforcement(input: MaturityCheckInput): boolean {
  if (input.currentMode !== "soft") return false;
  if (!input.threshold) return false;

  return (
    input.confirmedDecisionCount >= input.threshold.min_decisions &&
    input.completedTaskCount >= input.threshold.min_tasks
  );
}
