import { RecordId, type Surreal } from "surrealdb";
import { evaluateIntent, createLlmEvaluator } from "./authorizer";
import type { LlmEvaluator } from "./authorizer";
import { stripRecordIdEscaping } from "../graph/record-id";
import {
  updateIntentStatus,
  getIntentById,
  countConfirmedDecisions,
  countCompletedTasks,
  transitionEnforcementToHard,
  transitionEnforcementToSoft,
} from "./intent-queries";
import { shouldTransitionToHardEnforcement, shouldTransitionToSoftEnforcement } from "./maturity-transition";
import { routeByRisk } from "./risk-router";
import type { IntentRecord, EvaluationResult } from "./types";
import type { EvidenceEnforcementMode } from "./evidence-types";
import type { ServerDependencies } from "../runtime/types";
import {
  findAlignedObjectivesSurreal,
  createSupportsEdgeSurreal,
  createAlignmentWarningObservation,
} from "../objective/alignment-adapter";

type EvaluatePendingIntentDeps = {
  surreal: Surreal;
  extractionModel?: ServerDependencies["extractionModel"];
  llmEvaluator?: LlmEvaluator;
};

type EvaluatedStatus = "authorized" | "pending_veto" | "vetoed";

type EvaluatedIntent = {
  intentId: string;
  status: EvaluatedStatus;
  evaluation: EvaluationResult & {
    evaluated_at: Date;
    policy_only: boolean;
    policy_trace?: import("../policy/types").PolicyTraceEntry[];
    human_veto_required?: boolean;
  };
  vetoExpiresAt?: Date;
};

type EvaluatePendingIntentResult =
  | { ok: true; value: EvaluatedIntent }
  | { ok: false; error: string; httpStatus: number };

type EvaluatePendingIntentOptions = {
  intent?: IntentRecord;
};

/**
 * Resolves a record reference to a typed RecordId.
 *
 * Handles three input shapes:
 * 1. RecordId object (SDK response) -- extracts .id directly
 * 2. String "table:\`uuid\`" (SurrealDB EVENT webhook serialization) -- strips
 *    table prefix and backtick/angle-bracket escaping
 * 3. Plain string UUID -- used as-is
 */
function resolveRecordId<T extends string>(
  table: T,
  ref: unknown,
): RecordId<T> {
  if (typeof ref === "object" && ref !== null) {
    return new RecordId(table, (ref as { id: unknown }).id as string);
  }
  const s = String(ref);
  // Strip table prefix if present (e.g. "identity:`uuid`" -> "`uuid`")
  const colonIdx = s.indexOf(":");
  const afterPrefix = colonIdx >= 0 ? s.slice(colonIdx + 1) : s;
  return new RecordId(table, stripRecordIdEscaping(afterPrefix));
}

type TransitionPlan = {
  status: EvaluatedStatus;
  updateFields: Record<string, unknown>;
  vetoExpiresAt?: Date;
};

function toTransition(
  routing: ReturnType<typeof routeByRisk>,
  evaluationRecord: EvaluatedIntent["evaluation"],
): TransitionPlan {
  switch (routing.route) {
    case "auto_approve":
      return {
        status: "authorized",
        updateFields: { evaluation: evaluationRecord },
      };
    case "veto_window":
      return {
        status: "pending_veto",
        updateFields: { evaluation: evaluationRecord, veto_expires_at: routing.expires_at },
        vetoExpiresAt: routing.expires_at,
      };
    case "reject":
      return {
        status: "vetoed",
        updateFields: { evaluation: evaluationRecord },
      };
  }
}

export async function evaluatePendingIntent(
  intentId: string,
  deps: EvaluatePendingIntentDeps,
  options?: EvaluatePendingIntentOptions,
): Promise<EvaluatePendingIntentResult> {
  const intent = options?.intent ?? await getIntentById(deps.surreal, intentId);
  if (!intent) {
    return { ok: false, error: "Intent not found", httpStatus: 404 };
  }

  if (intent.status !== "pending_auth") {
    return {
      ok: false,
      error: `Intent is in '${intent.status}' status, expected 'pending_auth'`,
      httpStatus: 409,
    };
  }

  const identityId = resolveRecordId("identity", intent.requester);
  const workspaceRecord = resolveRecordId("workspace", intent.workspace);
  const intentRecord = new RecordId("intent", intentId);

  const [identityRows] = await deps.surreal.query<[Array<{ type?: string; role?: string; name?: string }>]>(
    `SELECT type, role, name FROM $identity;`,
    { identity: identityId },
  );
  const identityInfo = identityRows[0];

  const llmEvaluator = deps.llmEvaluator
    ?? (deps.extractionModel ? createLlmEvaluator(deps.extractionModel) : undefined);
  if (!llmEvaluator) {
    return { ok: false, error: "Missing evaluator model", httpStatus: 500 };
  }

  // Read workspace evidence enforcement mode, minimum evidence age, and maturity threshold
  let evidenceEnforcementMode: EvidenceEnforcementMode = "bootstrap";
  let minEvidenceAgeMinutes: number | undefined;
  try {
    const [wsRows] = await deps.surreal.query<[Array<{
      evidence_enforcement?: string;
      min_evidence_age_minutes?: number;
      evidence_enforcement_threshold?: { min_decisions?: number; min_tasks?: number };
    }>]>(
      `SELECT evidence_enforcement, min_evidence_age_minutes, evidence_enforcement_threshold FROM $ws;`,
      { ws: workspaceRecord },
    );
    evidenceEnforcementMode =
      (wsRows[0]?.evidence_enforcement as EvidenceEnforcementMode) ?? "bootstrap";
    minEvidenceAgeMinutes = wsRows[0]?.min_evidence_age_minutes;

    // Lazy maturity evaluation (WD-08): check if bootstrap -> soft transition is warranted
    if (evidenceEnforcementMode === "bootstrap") {
      const confirmedDecisionCount = await countConfirmedDecisions(deps.surreal, workspaceRecord);
      if (shouldTransitionToSoftEnforcement({
        currentMode: evidenceEnforcementMode,
        confirmedDecisionCount,
      })) {
        const transitioned = await transitionEnforcementToSoft(deps.surreal, workspaceRecord);
        if (transitioned) {
          evidenceEnforcementMode = "soft";
        }
      }
    }

    // Lazy maturity evaluation (WD-08): check if soft -> hard transition is warranted
    const threshold = wsRows[0]?.evidence_enforcement_threshold;
    if (evidenceEnforcementMode === "soft" && threshold?.min_decisions !== undefined && threshold?.min_tasks !== undefined) {
      const [confirmedDecisionCount, completedTaskCount] = await Promise.all([
        countConfirmedDecisions(deps.surreal, workspaceRecord),
        countCompletedTasks(deps.surreal, workspaceRecord),
      ]);

      if (shouldTransitionToHardEnforcement({
        currentMode: evidenceEnforcementMode,
        confirmedDecisionCount,
        completedTaskCount,
        threshold: { min_decisions: threshold.min_decisions, min_tasks: threshold.min_tasks },
      })) {
        const transitioned = await transitionEnforcementToHard(deps.surreal, workspaceRecord);
        if (transitioned) {
          evidenceEnforcementMode = "hard";
        }
      }
    }
  } catch {
    // Default to bootstrap if enforcement mode cannot be read
  }

  const evaluation = await evaluateIntent({
    intent: {
      goal: intent.goal,
      reasoning: intent.reasoning,
      action_spec: intent.action_spec,
      budget_limit: intent.budget_limit,
      priority: intent.priority,
    },
    surreal: deps.surreal,
    identityId,
    workspaceId: workspaceRecord,
    requesterType: identityInfo?.type ?? "agent",
    requesterRole: identityInfo?.role,
    llmEvaluator,
    intentId: intentRecord,
    intentText: intent.goal,
    findAlignedObjectives: findAlignedObjectivesSurreal(deps.surreal),
    createSupportsEdge: createSupportsEdgeSurreal(deps.surreal),
    createAlignmentWarning: (ws, iId, score) =>
      createAlignmentWarningObservation(deps.surreal, ws, iId, score),
    evidenceRefs: intent.evidence_refs,
    evidenceEnforcementMode,
    intentCreatedAt: intent.created_at,
    requesterAgent: identityInfo?.name,
    minEvidenceAgeMinutes,
  });

  // --- Hard enforcement rejection: transition to "failed" without LLM evaluation record ---
  if (evaluation.hard_enforcement_rejection) {
    const failResult = await updateIntentStatus(
      deps.surreal,
      intentId,
      "failed",
      {
        error_reason: evaluation.reason,
        evidence_verification: evaluation.evidence_verification,
      },
    );
    if (!failResult.ok) {
      return { ok: false, error: failResult.error, httpStatus: 409 };
    }
    return {
      ok: true,
      value: {
        intentId,
        status: "vetoed" as EvaluatedStatus, // Return type requires EvaluatedStatus but intent is "failed" in DB
        evaluation: {
          decision: evaluation.decision,
          risk_score: evaluation.risk_score,
          reason: evaluation.reason,
          evaluated_at: new Date(),
          policy_only: false,
        },
      },
    };
  }

  // Strip `alignment` and `evidence_verification` — they are stored separately
  const { alignment: _alignment, evidence_verification, ...evaluationForDb } = evaluation;
  const evaluationRecord: EvaluatedIntent["evaluation"] = {
    ...evaluationForDb,
    evaluated_at: new Date(),
  };
  const routing = routeByRisk(evaluation, {
    humanVetoRequired: evaluation.human_veto_required,
    evidenceVerification: evidence_verification,
  });
  const transition = toTransition(routing, evaluationRecord);

  // Include evidence_verification in the status update
  if (evidence_verification) {
    transition.updateFields.evidence_verification = evidence_verification;
  }

  const result = await updateIntentStatus(
    deps.surreal,
    intentId,
    transition.status,
    transition.updateFields,
  );
  if (!result.ok) {
    return { ok: false, error: result.error, httpStatus: 409 };
  }

  return {
    ok: true,
    value: {
      intentId,
      status: transition.status,
      evaluation: evaluationRecord,
      ...(transition.vetoExpiresAt ? { vetoExpiresAt: transition.vetoExpiresAt } : {}),
    },
  };
}
