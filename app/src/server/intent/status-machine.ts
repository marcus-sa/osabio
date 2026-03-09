import type { IntentStatus } from "./types";

// --- Transition Result (railway-oriented) ---

export type TransitionResult =
  | { ok: true; status: IntentStatus }
  | { ok: false; error: string };

// --- Legal Transition Map ---
// Each key maps to the set of statuses reachable from that state.

const TRANSITION_MAP: Record<IntentStatus, ReadonlyArray<IntentStatus>> = {
  draft: ["pending_auth"],
  pending_auth: ["pending_veto", "authorized", "vetoed", "failed"],
  pending_veto: ["authorized", "vetoed"],
  authorized: ["executing"],
  executing: ["completed", "failed"],
  completed: [],
  vetoed: [],
  failed: [],
};

// --- Pure transition function ---

export const transitionStatus = (
  from: IntentStatus,
  to: IntentStatus,
): TransitionResult => {
  const allowedTargets = TRANSITION_MAP[from];

  if (allowedTargets.includes(to)) {
    return { ok: true, status: to };
  }

  return {
    ok: false,
    error: `Invalid transition from "${from}" to "${to}"`,
  };
};
