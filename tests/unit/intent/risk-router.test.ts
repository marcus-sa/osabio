import { describe, expect, test } from "bun:test";
import { routeByRisk } from "../../../app/src/server/intent/risk-router";
import { checkPolicyGate } from "../../../app/src/server/intent/authorizer";
import type {
  EvaluationResult,
  RoutingDecision,
  ActionSpec,
  BudgetLimit,
} from "../../../app/src/server/intent/types";

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
      const result = routeByRisk(approveResult(50), { threshold: 50 });
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
      const result = routeByRisk(approveResult(51), { threshold: 50 });
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

// --- Policy Gate ---

describe("checkPolicyGate", () => {
  const defaultPolicy = {
    budget_cap: { amount: 1000, currency: "USD" },
    allowed_actions: ["slack.send_message", "github.create_issue"],
  };

  const makeIntent = (overrides?: {
    budget_limit?: BudgetLimit;
    action_spec?: ActionSpec;
  }) => ({
    goal: "Send a notification",
    action_spec: overrides?.action_spec ?? {
      provider: "slack",
      action: "send_message",
    },
    budget_limit: overrides?.budget_limit,
  });

  describe("passes when policy constraints are met", () => {
    test("passes when no budget_limit on intent and action is allowed", () => {
      const result = checkPolicyGate(makeIntent(), defaultPolicy);
      expect(result).toEqual({ passed: true });
    });

    test("passes when budget_limit is under budget_cap and action is allowed", () => {
      const intent = makeIntent({
        budget_limit: { amount: 500, currency: "USD" },
      });
      const result = checkPolicyGate(intent, defaultPolicy);
      expect(result).toEqual({ passed: true });
    });

    test("passes when budget_limit equals budget_cap exactly", () => {
      const intent = makeIntent({
        budget_limit: { amount: 1000, currency: "USD" },
      });
      const result = checkPolicyGate(intent, defaultPolicy);
      expect(result).toEqual({ passed: true });
    });
  });

  describe("rejects when budget cap exceeded", () => {
    test("rejects when budget_limit exceeds budget_cap", () => {
      const intent = makeIntent({
        budget_limit: { amount: 1001, currency: "USD" },
      });
      const result = checkPolicyGate(intent, defaultPolicy);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain("budget");
      }
    });
  });

  describe("rejects when action not in allowlist", () => {
    test("rejects when action is not in allowed_actions", () => {
      const intent = makeIntent({
        action_spec: { provider: "aws", action: "delete_instance" },
      });
      const result = checkPolicyGate(intent, defaultPolicy);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain("aws.delete_instance");
      }
    });
  });

  describe("policy with no restrictions", () => {
    test("passes when no budget_cap in policy", () => {
      const intent = makeIntent({
        budget_limit: { amount: 999999, currency: "USD" },
      });
      const result = checkPolicyGate(intent, {
        allowed_actions: ["slack.send_message"],
      });
      expect(result).toEqual({ passed: true });
    });

    test("passes when no allowed_actions in policy (no action restriction)", () => {
      const intent = makeIntent({
        action_spec: { provider: "anything", action: "whatever" },
      });
      const result = checkPolicyGate(intent, {
        budget_cap: { amount: 1000, currency: "USD" },
      });
      expect(result).toEqual({ passed: true });
    });
  });
});
