import type { EvaluationResult, RoutingDecision } from "./types";
import type { EvidenceVerificationResult } from "./evidence-types";
import { EVIDENCE_SHORTFALL_PENALTY, LOW_TIER_MIN_COUNT } from "./evidence-constants";

const DEFAULT_AUTO_APPROVE_THRESHOLD = 30;
const DEFAULT_VETO_WINDOW_MINUTES = 30;

type RiskRouterOptions = {
  autoApproveThreshold?: number;
  vetoWindowMinutes?: number;
  humanVetoRequired?: boolean;
  evidenceVerification?: EvidenceVerificationResult;
};

export function routeByRisk(
  evaluation: EvaluationResult,
  options?: RiskRouterOptions,
): RoutingDecision {
  if (evaluation.decision === "REJECT") {
    return { route: "reject", reason: evaluation.reason };
  }

  const threshold = options?.autoApproveThreshold ?? DEFAULT_AUTO_APPROVE_THRESHOLD;
  const vetoMinutes = options?.vetoWindowMinutes ?? DEFAULT_VETO_WINDOW_MINUTES;

  const now = Date.now();

  // Policy human_veto_required forces veto_window regardless of risk score
  if (options?.humanVetoRequired) {
    return { route: "veto_window", expires_at: new Date(now + vetoMinutes * 60 * 1000) };
  }

  const effectiveRisk = evaluation.risk_score + computeEvidencePenalty(options?.evidenceVerification);

  if (effectiveRisk <= threshold) {
    return { route: "auto_approve" };
  }

  const expiresAt = new Date(now + vetoMinutes * 60 * 1000);

  return { route: "veto_window", expires_at: expiresAt };
}

/**
 * Computes the risk score penalty for evidence shortfall.
 * Only applies under soft enforcement when verified refs are below the minimum.
 */
function computeEvidencePenalty(
  verification?: EvidenceVerificationResult,
): number {
  if (!verification) return 0;
  if (verification.enforcement_mode !== "soft") return 0;

  const shortfall = Math.max(0, LOW_TIER_MIN_COUNT - verification.verified_count);
  return shortfall * EVIDENCE_SHORTFALL_PENALTY;
}
