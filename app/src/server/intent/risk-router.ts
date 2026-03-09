import type { EvaluationResult, RoutingDecision } from "./types";

const DEFAULT_AUTO_APPROVE_THRESHOLD = 30;
const DEFAULT_VETO_WINDOW_MINUTES = 30;

type RiskRouterOptions = {
  threshold?: number;
  vetoWindowMinutes?: number;
};

export function routeByRisk(
  evaluation: EvaluationResult,
  options?: RiskRouterOptions,
): RoutingDecision {
  if (evaluation.decision === "REJECT") {
    return { route: "reject", reason: evaluation.reason };
  }

  const threshold = options?.threshold ?? DEFAULT_AUTO_APPROVE_THRESHOLD;

  if (evaluation.risk_score <= threshold) {
    return { route: "auto_approve" };
  }

  const vetoMinutes = options?.vetoWindowMinutes ?? DEFAULT_VETO_WINDOW_MINUTES;
  const expiresAt = new Date(Date.now() + vetoMinutes * 60 * 1000);

  return { route: "veto_window", expires_at: expiresAt };
}
