/**
 * Create Intent Handler -- Effect boundary for brain-native create_intent tool
 *
 * Handles the agent self-escalation flow:
 *   1. Parse and validate input arguments
 *   2. Derive authorization_details from action_spec
 *   3. Create intent record in SurrealDB (draft)
 *   4. Evaluate through policy gate
 *   5. If denied: transition to vetoed (no gates edge)
 *   6. If approved: transition to authorized, create gates edge
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
import { evaluatePolicyGate } from "../policy/policy-gate";
import { log } from "../telemetry/logger";
import { EVIDENCE_TABLE_ALLOWLIST } from "../intent/evidence-constants";

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
  readonly evidence_refs?: RecordId[];
};

export type CreateIntentOutcome =
  | { readonly status: "authorized"; readonly intentId: string }
  | { readonly status: "pending_veto"; readonly intentId: string }
  | { readonly status: "vetoed"; readonly intentId: string; readonly reason: string }
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

  // Validate evidence_refs if provided
  const evidenceResult = validateEvidenceRefs(args.evidence_refs);
  if ("error" in evidenceResult) {
    return { error: evidenceResult.error };
  }

  return {
    goal: goal.trim(),
    reasoning: reasoning.trim(),
    action_spec: {
      provider: actionSpec.provider.trim(),
      action: actionSpec.action.trim(),
      params: actionSpec.params,
    },
    ...(evidenceResult.refs.length > 0 ? { evidence_refs: evidenceResult.refs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Pure: validate evidence_refs input (defense in depth at handler boundary)
// ---------------------------------------------------------------------------

const SORTED_ALLOWLIST_DISPLAY = [...EVIDENCE_TABLE_ALLOWLIST].sort().join(", ");

/**
 * Validates evidence_refs from MCP input against the table allowlist.
 * Returns parsed RecordIds or an error identifying the unsupported type.
 */
export function validateEvidenceRefs(
  refs: unknown,
): { refs: RecordId[] } | { error: string } {
  if (refs === undefined || refs === null) {
    return { refs: [] };
  }

  if (!Array.isArray(refs)) {
    return { error: "evidence_refs must be an array of 'table:id' strings" };
  }

  const parsed: RecordId[] = [];

  for (const ref of refs) {
    if (typeof ref !== "string") {
      return { error: "Each evidence_ref must be a 'table:id' string" };
    }

    const colonIdx = ref.indexOf(":");
    if (colonIdx === -1) {
      return { error: `Invalid evidence_ref format: '${ref}'. Expected 'table:id'` };
    }

    const table = ref.slice(0, colonIdx);
    const id = ref.slice(colonIdx + 1);

    if (!EVIDENCE_TABLE_ALLOWLIST.has(table)) {
      return {
        error: `Unsupported evidence entity type: '${table}'. Allowed types: ${SORTED_ALLOWLIST_DISPLAY}`,
      };
    }

    if (id.length === 0) {
      return { error: `Empty ID in evidence_ref: '${ref}'` };
    }

    parsed.push(new RecordId(table, id));
  }

  return { refs: parsed };
}

// ---------------------------------------------------------------------------
// Handler (effect boundary)
// ---------------------------------------------------------------------------

/**
 * Handle a create_intent brain-native tool call.
 *
 * Pipeline:
 *   validate input -> derive auth details -> create trace -> create intent (draft)
 *   -> transition to pending_auth -> evaluate policy gate
 *   -> if denied: transition to vetoed (no gates edge)
 *   -> if approved: transition to authorized -> create gates edge
 *   -> return outcome
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
    ...(parsed.evidence_refs ? { evidence_refs: parsed.evidence_refs } : {}),
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

  // 6. Evaluate policy gate
  const identityRecord = new RecordId("identity", context.identityId);
  const workspaceRecord = new RecordId("workspace", context.workspaceId);

  const policyResult = await evaluatePolicyGate(
    surreal,
    identityRecord,
    workspaceRecord,
    {
      goal: parsed.goal,
      reasoning: parsed.reasoning,
      priority: 50,
      action_spec: actionSpec,
      requester_type: "agent",
    },
  );

  // 7. If policy denies: transition to vetoed, no gates edge
  if (!policyResult.passed) {
    const toVetoed = await updateIntentStatus(surreal, intentId, "vetoed", {
      veto_reason: policyResult.reason,
    });

    if (!toVetoed.ok) {
      log.error("create_intent.transition_failed", "Failed to transition intent to vetoed", {
        intent_id: intentId,
        error: toVetoed.error,
      });
      return { status: "error", reason: `Intent transition failed: ${toVetoed.error}` };
    }

    log.info("create_intent.vetoed", "Intent denied by policy gate", {
      intent_id: intentId,
      workspace_id: context.workspaceId,
      action: `${actionSpec.provider}:${actionSpec.action}`,
      deny_rule_id: policyResult.deny_rule_id,
    });

    return { status: "vetoed", intentId, reason: policyResult.reason };
  }

  // 8. Policy passed but human veto required: transition to pending_veto, create gates edge
  if (policyResult.human_veto_required) {
    const toPendingVeto = await updateIntentStatus(surreal, intentId, "pending_veto");
    if (!toPendingVeto.ok) {
      log.error("create_intent.transition_failed", "Failed to transition intent to pending_veto", {
        intent_id: intentId,
        error: toPendingVeto.error,
      });
      return { status: "error", reason: `Intent transition failed: ${toPendingVeto.error}` };
    }

    // Create gates edge: intent -> gates -> session (needed for scope computation after approval)
    const sessionRecordForVeto = new RecordId("agent_session", context.sessionId);
    await surreal.query(
      `RELATE $intent->gates->$sess SET created_at = time::now();`,
      { intent: intentRecord, sess: sessionRecordForVeto },
    );

    log.info("create_intent.pending_veto", "Intent requires human veto review", {
      intent_id: intentId,
      session_id: context.sessionId,
      workspace_id: context.workspaceId,
      action: `${actionSpec.provider}:${actionSpec.action}`,
    });

    return { status: "pending_veto", intentId };
  }

  // 9. Policy passed, no veto required: transition pending_auth -> authorized
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

  // 9. Create gates edge: intent -> gates -> session
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
