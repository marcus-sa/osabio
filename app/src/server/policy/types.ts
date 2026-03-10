import type { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Rule Predicates & Conditions
// ---------------------------------------------------------------------------

export type RulePredicate = {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "lt"
    | "lte"
    | "gt"
    | "gte"
    | "in"
    | "not_in"
    | "exists";
  value: string | number | boolean | string[];
};

export type RuleCondition = RulePredicate | RulePredicate[];

// ---------------------------------------------------------------------------
// Policy Domain Types
// ---------------------------------------------------------------------------

export type PolicyRule = {
  id: string;
  condition: RuleCondition;
  effect: "allow" | "deny";
  priority: number;
};

export type PolicySelector = {
  workspace?: string;
  agent_role?: string;
  resource?: string;
};

export type PolicyStatus =
  | "draft"
  | "testing"
  | "active"
  | "deprecated"
  | "superseded";

export type PolicyRecord = {
  id: RecordId<"policy">;
  title: string;
  description?: string;
  version: number;
  status: PolicyStatus;
  selector: PolicySelector;
  rules: PolicyRule[];
  human_veto_required: boolean;
  max_ttl?: string;
  created_by: RecordId<"identity">;
  workspace: RecordId<"workspace">;
  supersedes?: RecordId<"policy">;
  created_at: Date;
  updated_at?: Date;
};

// ---------------------------------------------------------------------------
// Policy Trace (recorded on intent.evaluation)
// ---------------------------------------------------------------------------

export type PolicyTraceEntry = {
  policy_id: string;
  policy_version: number;
  rule_id: string;
  effect: "allow" | "deny";
  matched: boolean;
  priority: number;
};

// ---------------------------------------------------------------------------
// Policy Gate Result (output of policy evaluation pipeline)
// ---------------------------------------------------------------------------

export type PolicyGateWarning = {
  rule_id: string;
  field: string;
  policy_id: string;
};

export type PolicyGateResult =
  | {
      passed: true;
      policy_trace: PolicyTraceEntry[];
      human_veto_required: boolean;
      warnings: PolicyGateWarning[];
    }
  | {
      passed: false;
      reason: string;
      policy_trace: PolicyTraceEntry[];
      deny_rule_id: string;
      warnings: PolicyGateWarning[];
    };

// ---------------------------------------------------------------------------
// Intent Evaluation Context (input to policy gate)
// ---------------------------------------------------------------------------

export type IntentEvaluationContext = {
  goal: string;
  reasoning: string;
  priority: number;
  action_spec: {
    provider: string;
    action: string;
    params?: Record<string, unknown>;
  };
  budget_limit?: { amount: number; currency: string };
  authorization_details?: Array<{
    type: string;
    action: string;
    resource: string;
    constraints?: Record<string, unknown>;
  }>;
  requester_type: string;
  requester_role?: string;
};
