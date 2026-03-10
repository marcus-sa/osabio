import { describe, expect, test, mock } from "bun:test";
import { RecordId } from "surrealdb";
import {
  evaluateIntent,
  type EvaluateIntentInput,
  type LlmEvaluator,
} from "../../../app/src/server/intent/authorizer";
import type { EvaluationResult } from "../../../app/src/server/intent/types";

// --- Helpers ---

// Mock Surreal that returns empty policies (policy gate always passes)
const mockSurreal = {
  query: async () => [[{ policies: [] }]],
} as unknown as EvaluateIntentInput["surreal"];

const mockIdentityId = new RecordId("identity", "test-identity");
const mockWorkspaceId = new RecordId("workspace", "test-workspace");

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

const makeInput = (overrides: Partial<EvaluateIntentInput> = {}): EvaluateIntentInput => ({
  intent: defaultIntent,
  surreal: mockSurreal,
  identityId: mockIdentityId,
  workspaceId: mockWorkspaceId,
  requesterType: "agent",
  llmEvaluator: makeLlmEvaluator(approvedLlmResult),
  ...overrides,
});

// --- Tests ---

describe("evaluateIntent", () => {
  describe("happy path: policy passes, LLM returns result", () => {
    test("returns LLM evaluation result with policy_only=false", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: makeLlmEvaluator(approvedLlmResult),
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.risk_score).toBe(15);
      expect(result.reason).toBe("Low-risk notification action");
      expect(result.policy_only).toBe(false);
      expect(result.policy_trace).toEqual([]);
      expect(result.human_veto_required).toBe(false);
    });

    test("returns LLM REJECT decision with policy_only=false", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: makeLlmEvaluator(rejectedLlmResult),
      }));

      expect(result.decision).toBe("REJECT");
      expect(result.risk_score).toBe(80);
      expect(result.reason).toBe("Prompt injection detected");
      expect(result.policy_only).toBe(false);
    });
  });

  describe("policy reject short-circuits before LLM", () => {
    test("rejects when policy gate denies without calling LLM", async () => {
      // Mock Surreal that returns a deny policy from graph traversal
      // loadActivePolicies calls query twice (identity + workspace), accessing result[0]?.policies
      const denyPolicy = {
        id: new RecordId("policy", "deny-test"),
        title: "Block Deploy",
        version: 1,
        status: "active",
        selector: {},
        rules: [{
          id: "block_deploy",
          condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
          effect: "deny",
          priority: 100,
        }],
        human_veto_required: false,
        created_by: mockIdentityId,
        workspace: mockWorkspaceId,
        created_at: new Date(),
      };
      const denyPolicySurreal = {
        query: async () => [[{ policies: [denyPolicy] }]],
      } as unknown as EvaluateIntentInput["surreal"];

      let llmCalled = false;
      const spyEvaluator: LlmEvaluator = async () => {
        llmCalled = true;
        return approvedLlmResult;
      };

      const result = await evaluateIntent(makeInput({
        intent: {
          ...defaultIntent,
          action_spec: { provider: "infra", action: "deploy" },
        },
        surreal: denyPolicySurreal,
        llmEvaluator: spyEvaluator,
      }));

      expect(result.decision).toBe("REJECT");
      expect(result.policy_only).toBe(true);
      expect(result.policy_trace.length).toBeGreaterThan(0);
      expect(llmCalled).toBe(false);
    });
  });

  describe("LLM failure falls back to high-risk approval for human review", () => {
    test("returns APPROVE with risk_score=50 and policy_only=true when LLM throws", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: failingLlmEvaluator,
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(true);
      expect(result.risk_score).toBe(50);
      expect(result.reason).toContain("LLM");
    });
  });

  describe("evaluation timeout produces high-risk fallback for human review", () => {
    test("returns APPROVE with risk_score=50 and policy_only=true on timeout", async () => {
      const result = await evaluateIntent(makeInput({
        llmEvaluator: slowLlmEvaluator(5000),
        timeoutMs: 50,
      }));

      expect(result.decision).toBe("APPROVE");
      expect(result.policy_only).toBe(true);
      expect(result.risk_score).toBe(50);
      expect(result.reason).toContain("timeout");
    });
  });
});
