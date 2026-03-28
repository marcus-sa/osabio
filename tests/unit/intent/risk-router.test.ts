import { describe, expect, test } from "bun:test";
import { routeByRisk } from "../../../app/src/server/intent/risk-router";
import type {
  EvaluationResult,
} from "../../../app/src/server/intent/types";
import type { EvidenceVerificationResult } from "../../../app/src/server/intent/evidence-types";

// --- Risk Router ---

describe("routeByRisk", () => {
  const approveResult = (risk_score: number): EvaluationResult => ({
    decision: "APPROVE",
    risk_score,
    reason: "Looks good",
  });

  const rejectResult = (risk_score: number): EvaluationResult => ({
    decision: "REJECT",
    risk_score,
    reason: "Too risky",
  });

  describe("auto_approve route", () => {
    test("returns auto_approve when APPROVE and risk_score is 0", () => {
      const result = routeByRisk(approveResult(0));
      expect(result).toEqual({ route: "auto_approve" });
    });

    test("returns auto_approve when APPROVE and risk_score equals threshold (30)", () => {
      const result = routeByRisk(approveResult(30));
      expect(result).toEqual({ route: "auto_approve" });
    });

    test("returns auto_approve when APPROVE and risk_score equals custom threshold", () => {
      const result = routeByRisk(approveResult(50), { autoApproveThreshold: 50 });
      expect(result).toEqual({ route: "auto_approve" });
    });
  });

  describe("veto_window route", () => {
    test("returns veto_window when APPROVE and risk_score is 31 (just above default threshold)", () => {
      const result = routeByRisk(approveResult(31));
      expect(result.route).toBe("veto_window");
      if (result.route === "veto_window") {
        expect(result.expires_at).toBeInstanceOf(Date);
        expect(result.expires_at.getTime()).toBeGreaterThan(Date.now());
      }
    });

    test("returns veto_window when APPROVE and risk_score is 100", () => {
      const result = routeByRisk(approveResult(100));
      expect(result.route).toBe("veto_window");
    });

    test("returns veto_window when APPROVE and risk_score is 51 with custom threshold 50", () => {
      const result = routeByRisk(approveResult(51), { autoApproveThreshold: 50 });
      expect(result.route).toBe("veto_window");
    });
  });

  describe("reject route", () => {
    test("returns reject when decision is REJECT regardless of low risk_score", () => {
      const result = routeByRisk(rejectResult(0));
      expect(result).toEqual({ route: "reject", reason: "Too risky" });
    });

    test("returns reject when decision is REJECT regardless of high risk_score", () => {
      const result = routeByRisk(rejectResult(100));
      expect(result).toEqual({ route: "reject", reason: "Too risky" });
    });

    test("returns reject when decision is REJECT at threshold boundary", () => {
      const result = routeByRisk(rejectResult(30));
      expect(result).toEqual({ route: "reject", reason: "Too risky" });
    });
  });
});

// --- human_veto_required ---

describe("routeByRisk with human_veto_required", () => {
  const approveResult = (risk_score: number): EvaluationResult => ({
    decision: "APPROVE",
    risk_score,
    reason: "Looks good",
  });

  test("forces veto_window when human_veto_required is true and APPROVE with low risk", () => {
    const result = routeByRisk(approveResult(0), { humanVetoRequired: true });
    expect(result.route).toBe("veto_window");
  });

  test("forces veto_window when human_veto_required is true and APPROVE at threshold", () => {
    const result = routeByRisk(approveResult(30), { humanVetoRequired: true });
    expect(result.route).toBe("veto_window");
  });

  test("does not affect reject decisions even with human_veto_required", () => {
    const rejectResult: EvaluationResult = {
      decision: "REJECT",
      risk_score: 10,
      reason: "Denied",
    };
    const result = routeByRisk(rejectResult, { humanVetoRequired: true });
    expect(result).toEqual({ route: "reject", reason: "Denied" });
  });
});

// --- Evidence Shortfall Penalty ---

describe("routeByRisk with evidence shortfall penalty", () => {
  const approveResult = (risk_score: number): EvaluationResult => ({
    decision: "APPROVE",
    risk_score,
    reason: "Looks good",
  });

  const softNoEvidence: EvidenceVerificationResult = {
    verified_count: 0,
    total_count: 0,
    verification_time_ms: 1,
    enforcement_mode: "soft",
  };

  const softPartialEvidence: EvidenceVerificationResult = {
    verified_count: 1,
    total_count: 2,
    verification_time_ms: 1,
    enforcement_mode: "soft",
  };

  const bootstrapNoEvidence: EvidenceVerificationResult = {
    verified_count: 0,
    total_count: 0,
    verification_time_ms: 1,
    enforcement_mode: "bootstrap",
  };

  const softFullEvidence: EvidenceVerificationResult = {
    verified_count: 2,
    total_count: 2,
    verification_time_ms: 1,
    enforcement_mode: "soft",
  };

  test("soft enforcement with no evidence elevates risk above auto-approve threshold", () => {
    // Base risk 20 would auto-approve (below 30), but penalty should push it above
    const result = routeByRisk(approveResult(20), {
      evidenceVerification: softNoEvidence,
    });
    expect(result.route).toBe("veto_window");
  });

  test("bootstrap enforcement does not apply penalty even with no evidence", () => {
    // Base risk 20 stays at 20, auto-approves
    const result = routeByRisk(approveResult(20), {
      evidenceVerification: bootstrapNoEvidence,
    });
    expect(result).toEqual({ route: "auto_approve" });
  });

  test("soft enforcement with sufficient evidence does not apply penalty", () => {
    // Full evidence: no shortfall, risk stays at 20, auto-approves
    const result = routeByRisk(approveResult(20), {
      evidenceVerification: softFullEvidence,
    });
    expect(result).toEqual({ route: "auto_approve" });
  });

  test("penalty scales with shortfall: 1 missing ref below minimum adds 1x penalty", () => {
    // verified_count=0, min required is 1, shortfall=1 -> penalty=20
    // Base risk 5 + 20 = 25, still auto-approve (<=30)
    const result = routeByRisk(approveResult(5), {
      evidenceVerification: softNoEvidence,
    });
    // 5 + 20 = 25 <= 30 -> auto_approve
    expect(result).toEqual({ route: "auto_approve" });
  });

  test("reject decision is unaffected by evidence shortfall", () => {
    const rejectResult: EvaluationResult = {
      decision: "REJECT",
      risk_score: 10,
      reason: "Denied",
    };
    const result = routeByRisk(rejectResult, {
      evidenceVerification: softNoEvidence,
    });
    expect(result).toEqual({ route: "reject", reason: "Denied" });
  });
});
