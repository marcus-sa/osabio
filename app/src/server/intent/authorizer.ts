import type { ActionSpec, BudgetLimit, EvaluationResult } from "./types";

// --- Policy Gate Types ---

type PolicyGateIntent = {
  goal: string;
  action_spec: ActionSpec;
  budget_limit?: BudgetLimit;
};

type WorkspacePolicy = {
  budget_cap?: BudgetLimit;
  allowed_actions?: string[];
};

type PolicyGateResult =
  | { passed: true }
  | { passed: false; reason: string };

// --- LLM Evaluator Port ---

export type LlmEvaluator = (
  intent: EvaluateIntentInput["intent"],
  signal?: AbortSignal,
) => Promise<EvaluationResult>;

// --- Pipeline Types ---

type EvaluationOutput = EvaluationResult & { policy_only: boolean };

export type EvaluateIntentInput = {
  intent: {
    goal: string;
    reasoning: string;
    action_spec: ActionSpec;
    budget_limit?: BudgetLimit;
  };
  policy: WorkspacePolicy;
  llmEvaluator: LlmEvaluator;
  timeoutMs?: number;
};

const DEFAULT_EVAL_TIMEOUT_MS = 30_000;

// --- Policy Gate ---

export function checkPolicyGate(
  intent: PolicyGateIntent,
  policy: WorkspacePolicy,
): PolicyGateResult {
  const budgetCheck = checkBudgetCap(intent.budget_limit, policy.budget_cap);
  if (!budgetCheck.passed) return budgetCheck;

  const actionCheck = checkActionAllowlist(intent.action_spec, policy.allowed_actions);
  if (!actionCheck.passed) return actionCheck;

  return { passed: true };
}

// --- Internal pure checks ---

function checkBudgetCap(
  intentBudget: BudgetLimit | undefined,
  policyCap: BudgetLimit | undefined,
): PolicyGateResult {
  if (!policyCap || !intentBudget) {
    return { passed: true };
  }

  if (intentBudget.amount > policyCap.amount) {
    return {
      passed: false,
      reason: `Intent budget ${intentBudget.amount} ${intentBudget.currency} exceeds workspace budget cap of ${policyCap.amount} ${policyCap.currency}`,
    };
  }

  return { passed: true };
}

function checkActionAllowlist(
  actionSpec: ActionSpec,
  allowedActions: string[] | undefined,
): PolicyGateResult {
  if (!allowedActions) {
    return { passed: true };
  }

  const actionKey = `${actionSpec.provider}.${actionSpec.action}`;

  if (!allowedActions.includes(actionKey)) {
    return {
      passed: false,
      reason: `Action ${actionKey} is not in the workspace allowlist`,
    };
  }

  return { passed: true };
}

// --- Evaluate Intent Pipeline ---
// Policy gate -> LLM evaluation -> fallback on failure

export async function evaluateIntent(
  input: EvaluateIntentInput,
): Promise<EvaluationOutput> {
  // Step 1: Policy gate (short-circuit on reject)
  const policyResult = checkPolicyGate(input.intent, input.policy);
  if (!policyResult.passed) {
    return {
      decision: "REJECT",
      risk_score: 0,
      reason: policyResult.reason,
      policy_only: true,
    };
  }

  // Step 2: LLM evaluation with timeout
  const timeoutMs = input.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const llmResult = await input.llmEvaluator(input.intent, controller.signal);
    return { ...llmResult, policy_only: false };
  } catch (error) {
    // Step 3: Fallback to policy-only approval on any LLM failure
    const reason = isAbortError(error)
      ? "LLM evaluation timeout — falling back to policy-only"
      : "LLM evaluation failed — falling back to policy-only";
    return {
      decision: "APPROVE",
      risk_score: 0,
      reason,
      policy_only: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
