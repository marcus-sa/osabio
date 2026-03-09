import type { RecordId } from "surrealdb";

// --- Intent Status (state machine states) ---

export type IntentStatus =
  | "draft"
  | "pending_auth"
  | "pending_veto"
  | "authorized"
  | "executing"
  | "completed"
  | "vetoed"
  | "failed";

// --- Action Specification ---

export type ActionSpec = {
  provider: string;
  action: string;
  params?: Record<string, unknown>;
};

// --- Budget Limit ---

export type BudgetLimit = {
  amount: number;
  currency: string;
};

// --- Evaluation Result ---

export type EvaluationResult = {
  decision: "APPROVE" | "REJECT";
  risk_score: number;
  reason: string;
};

// --- Routing Decision (discriminated union) ---

export type RoutingDecision =
  | { route: "auto_approve" }
  | { route: "veto_window"; expires_at: Date }
  | { route: "reject"; reason: string };

// --- Intent Record ---

export type IntentRecord = {
  id: RecordId<"intent", string>;
  goal: string;
  reasoning: string;
  status: IntentStatus;
  priority: number;
  action_spec: ActionSpec;
  budget_limit?: BudgetLimit;
  evaluation?: EvaluationResult & {
    evaluated_at: Date;
    policy_only: boolean;
  };
  veto_expires_at?: Date;
  veto_reason?: string;
  error_reason?: string;
  trace_id: string;
  requester: RecordId<"identity", string>;
  workspace: RecordId<"workspace", string>;
  created_at: Date;
  updated_at?: Date;
  expiry?: Date;
};
