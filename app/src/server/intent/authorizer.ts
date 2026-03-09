import type { ActionSpec, BudgetLimit } from "./types";

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
