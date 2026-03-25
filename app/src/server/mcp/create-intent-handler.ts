/**
 * Create Intent Handler -- Effect boundary for brain-native create_intent tool
 *
 * Handles the agent self-escalation flow:
 *   1. Parse and validate input arguments
 *   2. Derive authorization_details from action_spec
 *   3. Create intent record in SurrealDB (draft)
 *   4. Evaluate through policy gate (auto-approve path)
 *   5. Transition to authorized on approval
 *   6. Create gates edge linking intent to session
 *   7. Return CreateIntentOutcome
 *
 * Effect boundary: performs IO (SurrealDB writes, policy gate evaluation).
 * Pure derivation logic (authorization_details) is inline and testable.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { ActionSpec } from "../intent/types";
import type { BrainAction } from "../oauth/types";
import {
  createIntent,
  createTrace,
  updateIntentStatus,
} from "../intent/intent-queries";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateIntentInput = {
  readonly goal: string;
  readonly reasoning: string;
  readonly action_spec: {
    readonly provider: string;
    readonly action: string;
    readonly params?: Record<string, unknown>;
  };
};

export type CreateIntentOutcome =
  | { readonly status: "authorized"; readonly intentId: string }
  | { readonly status: "error"; readonly reason: string };

export type CreateIntentContext = {
  readonly workspaceId: string;
  readonly identityId: string;
  readonly sessionId: string;
};

// ---------------------------------------------------------------------------
// Pure: derive authorization_details from action_spec
// ---------------------------------------------------------------------------

export function deriveAuthorizationDetails(
  actionSpec: CreateIntentInput["action_spec"],
): BrainAction[] {
  return [
    {
      type: "brain_action",
      action: "execute",
      resource: `mcp_tool:${actionSpec.provider}:${actionSpec.action}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Input validation (pure)
// ---------------------------------------------------------------------------

function validateInput(
  args: Record<string, unknown>,
): CreateIntentInput | { error: string } {
  const goal = args.goal;
  const reasoning = args.reasoning;
  const actionSpec = args.action_spec as
    | { provider?: string; action?: string; params?: Record<string, unknown> }
    | undefined;

  if (typeof goal !== "string" || goal.trim().length === 0) {
    return { error: "Missing or empty 'goal' argument" };
  }

  if (typeof reasoning !== "string" || reasoning.trim().length === 0) {
    return { error: "Missing or empty 'reasoning' argument" };
  }

  if (!actionSpec || typeof actionSpec !== "object") {
    return { error: "Missing 'action_spec' argument" };
  }

  if (typeof actionSpec.provider !== "string" || actionSpec.provider.trim().length === 0) {
    return { error: "Missing or empty 'action_spec.provider'" };
  }

  if (typeof actionSpec.action !== "string" || actionSpec.action.trim().length === 0) {
    return { error: "Missing or empty 'action_spec.action'" };
  }

  return {
    goal: goal.trim(),
    reasoning: reasoning.trim(),
    action_spec: {
      provider: actionSpec.provider.trim(),
      action: actionSpec.action.trim(),
      params: actionSpec.params,
    },
  };
}

// ---------------------------------------------------------------------------
// Handler (effect boundary)
// ---------------------------------------------------------------------------

/**
 * Handle a create_intent brain-native tool call.
 *
 * Pipeline:
 *   validate input -> derive auth details -> create trace -> create intent (draft)
 *   -> transition to pending_auth -> transition to authorized -> create gates edge
 *   -> return outcome
 *
 * For this initial implementation, all intents are auto-approved (no policy gate
 * or LLM evaluator). The full policy gate wiring is added in subsequent steps.
 */
export async function handleCreateIntent(
  args: Record<string, unknown>,
  context: CreateIntentContext,
  surreal: Surreal,
): Promise<CreateIntentOutcome> {
  // 1. Validate input
  const parsed = validateInput(args);
  if ("error" in parsed) {
    return { status: "error", reason: parsed.error };
  }

  // 2. Derive authorization_details
  const authorizationDetails = deriveAuthorizationDetails(parsed.action_spec);

  // 3. Create trace record
  const traceRecord = await createTrace(surreal, {
    type: "intent_submission",
    actor: new RecordId("identity", context.identityId),
    workspace: new RecordId("workspace", context.workspaceId),
    session: new RecordId("agent_session", context.sessionId),
    tool_name: "create_intent",
    input: args,
  });

  // 4. Create intent record (draft)
  const actionSpec: ActionSpec = {
    provider: parsed.action_spec.provider,
    action: parsed.action_spec.action,
    params: parsed.action_spec.params ?? {},
  };

  const intentRecord = await createIntent(surreal, {
    goal: parsed.goal,
    reasoning: parsed.reasoning,
    priority: 50,
    action_spec: actionSpec,
    trace_id: traceRecord,
    requester: new RecordId("identity", context.identityId),
    workspace: new RecordId("workspace", context.workspaceId),
    authorization_details: authorizationDetails,
  });

  const intentId = intentRecord.id as string;

  // 5. Transition draft -> pending_auth
  const toPendingAuth = await updateIntentStatus(surreal, intentId, "pending_auth");
  if (!toPendingAuth.ok) {
    log.error("create_intent.transition_failed", "Failed to transition intent to pending_auth", {
      intent_id: intentId,
      error: toPendingAuth.error,
    });
    return { status: "error", reason: `Intent transition failed: ${toPendingAuth.error}` };
  }

  // 6. Auto-approve: transition pending_auth -> authorized
  const toAuthorized = await updateIntentStatus(surreal, intentId, "authorized", {
    evaluation: {
      decision: "APPROVE",
      risk_score: 0,
      reason: "Auto-approved: no blocking policy",
      evaluated_at: new Date(),
      policy_only: true,
    },
  });

  if (!toAuthorized.ok) {
    log.error("create_intent.transition_failed", "Failed to transition intent to authorized", {
      intent_id: intentId,
      error: toAuthorized.error,
    });
    return { status: "error", reason: `Intent transition failed: ${toAuthorized.error}` };
  }

  // 7. Create gates edge: intent -> gates -> session
  const sessionRecord = new RecordId("agent_session", context.sessionId);
  await surreal.query(
    `RELATE $intent->gates->$sess SET created_at = time::now();`,
    { intent: intentRecord, sess: sessionRecord },
  );

  log.info("create_intent.authorized", "Intent auto-approved and gates edge created", {
    intent_id: intentId,
    session_id: context.sessionId,
    workspace_id: context.workspaceId,
    action: `${actionSpec.provider}:${actionSpec.action}`,
  });

  return { status: "authorized", intentId };
}
