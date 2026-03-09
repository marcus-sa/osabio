import { describe, expect, test } from "bun:test";
import {
  evaluateIntent,
  type EvaluateIntentInput,
  type LlmEvaluator,
} from "../../../app/src/server/intent/authorizer";
import type { EvaluationResult } from "../../../app/src/server/intent/types";

// --- Helpers ---

const defaultPolicy = {
  budget_cap: { amount: 1000, currency: "USD" },
  allowed_actions: ["slack.send_message"],
};

const defaultIntent: EvaluateIntentInput["intent"] = {
  goal: "Send a slack notification",
  reasoning: "User requested notification",
  action_spec: { provider: "slack", action: "send_message" },
};

const approvedLlmResult: EvaluationResult = {
  decision: "APPROVE",
  risk_score: 15,
  reason: "Low-risk notification action",
};

const rejectedLlmResult: EvaluationResult = {
  decision: "REJECT",
  risk_score: 80,
  reason: "Prompt injection detected",
};

const makeLlmEvaluator = (result: EvaluationResult): LlmEvaluator =>
  async (_intent, _signal) => result;

const failingLlmEvaluator: LlmEvaluator = async () => {
  throw new Error("LLM service unavailable");
};

const slowLlmEvaluator = (delayMs: number): LlmEvaluator =>
  async (_intent, signal) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
    return approvedLlmResult;
  };

// --- Tests ---

describe("evaluateIntent", () => {
  describe("happy path: policy passes, LLM returns result", () => {
    test("returns LLM evaluation result with policy_only=false", async () => {
      const result = await evaluateIntent({
        intent: defaultIntent,
        policy: defaultPolicy,
        llmEvaluator: makeLlmEvaluator(approvedLlmResult),
      });

      expect(result.decision).toBe("APPROVE");
      expect(result.risk_score).toBe(15);
      expect(result.reason).toBe("Low-risk notification action");
      expect(result.policy_only).toBe(false);
    });

    test("returns LLM REJECT decision with policy_only=false", async () => {
      const result = await evaluateIntent({
        intent: defaultIntent,
        policy: defaultPolicy,
        llmEvaluator: makeLlmEvaluator(rejectedLlmResult),
      });

      expect(result.decision).toBe("REJECT");
      expect(result.risk_score).toBe(80);
      expect(result.reason).toBe("Prompt injection detected");
      expect(result.policy_only).toBe(false);
    });
  });

  describe("policy reject short-circuits before LLM", () => {
    test("rejects on budget cap exceeded without calling LLM", async () => {
      let llmCalled = false;
      const spyEvaluator: LlmEvaluator = async () => {
        llmCalled = true;
        return approvedLlmResult;
      };

      const result = await evaluateIntent({
        intent: {
          ...defaultIntent,
          budget_limit: { amount: 5000, currency: "USD" },
        },
        policy: defaultPolicy,
        llmEvaluator: spyEvaluator,
      });

      expect(result.decision).toBe("REJECT");
      expect(result.policy_only).toBe(true);
      expect(result.reason).toContain("budget");
      expect(llmCalled).toBe(false);
    });

    test("rejects on action not in allowlist without calling LLM", async () => {
      let llmCalled = false;
      const spyEvaluator: LlmEvaluator = async () => {
        llmCalled = true;
        return approvedLlmResult;
      };

      const result = await evaluateIntent({
        intent: {
          ...defaultIntent,
          action_spec: { provider: "aws", action: "delete_instance" },
        },
        policy: defaultPolicy,
        llmEvaluator: spyEvaluator,
      });

      expect(result.decision).toBe("REJECT");
      expect(result.policy_only).toBe(true);
      expect(result.reason).toContain("aws.delete_instance");
      expect(llmCalled).toBe(false);
    });
  });

  describe("LLM failure falls back to high-risk approval for human review", () => {
    test("returns APPROVE with risk_score=50 and policy_only=true when LLM throws", async () => {
      const result = await evaluateIntent({
        intent: defaultIntent,
        policy: defaultPolicy,
        llmEvaluator: failingLlmEvaluator,
      });

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(true);
      expect(result.risk_score).toBe(50);
      expect(result.reason).toContain("LLM");
    });
  });

  describe("evaluation timeout produces high-risk fallback for human review", () => {
    test("returns APPROVE with risk_score=50 and policy_only=true on timeout", async () => {
      const result = await evaluateIntent({
        intent: defaultIntent,
        policy: defaultPolicy,
        llmEvaluator: slowLlmEvaluator(5000),
        timeoutMs: 50,
      });

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(true);
      expect(result.risk_score).toBe(50);
      expect(result.reason).toContain("timeout");
    });
  });
});
