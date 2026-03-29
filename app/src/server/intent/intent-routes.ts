import { RecordId } from "surrealdb";
import { jsonError, jsonResponse } from "../http/response";
import { updateIntentStatus, listPendingIntents, getIntentById } from "./intent-queries";
import { evaluatePendingIntent } from "./intent-evaluation";
import { renderConsentDisplay, validateTighterBounds } from "../oauth/consent-renderer";
import type { ServerDependencies } from "../runtime/types";
import type { IntentRecord } from "./types";
import type { OsabioAction } from "../oauth/types";
import { log } from "../telemetry/logger";

// --- Route Handler Types ---

type IntentRouteHandlers = {
  handleEvaluate: (intentId: string, request: Request) => Promise<Response>;
  handleVeto: (workspaceId: string, intentId: string, request: Request) => Promise<Response>;
  handleListPending: (workspaceId: string) => Promise<Response>;
  handleConsent: (workspaceId: string, intentId: string) => Promise<Response>;
  handleApprove: (workspaceId: string, intentId: string) => Promise<Response>;
  handleConstrain: (workspaceId: string, intentId: string, request: Request) => Promise<Response>;
};

// --- Factory ---

export function createIntentRouteHandlers(deps: ServerDependencies): IntentRouteHandlers {
  const { surreal } = deps;

  const handleEvaluate = async (intentId: string, request: Request): Promise<Response> => {
    // Called by SurrealQL EVENT via http::post - receives full intent record as body
    let body: IntentRecord | undefined;
    try {
      body = await request.json() as IntentRecord;
    } catch {
      body = undefined;
    }

    const bodyIntentId = body && typeof body.id === "object" && body.id !== undefined
      ? (body.id.id as string)
      : undefined;

    if (bodyIntentId && bodyIntentId !== intentId) {
      return jsonError("Intent ID mismatch between path and payload", 400);
    }

    if (!body) {
      return jsonError("Invalid JSON body", 400);
    }

    if (!body.requester) {
      return jsonError("Missing requester in intent body", 400);
    }

    log.info("intent.evaluate.received", "Evaluate endpoint received intent", {
      intentId,
      status: body.status,
      goal: body.goal,
    });

    // Idempotency guard: only process intents in pending_auth status
    if (body.status !== "pending_auth") {
      log.info("intent.evaluate.skipped", "Intent not in pending_auth status", {
        intentId,
        currentStatus: body.status,
      });
      return jsonError(`Intent is in '${body.status}' status, expected 'pending_auth'`, 409);
    }

    try {
      const evaluation = await evaluatePendingIntent(
        intentId,
        {
          surreal,
          extractionModel: deps.extractionModel,
        },
        { intent: body },
      );
      if (!evaluation.ok) {
        return jsonError(evaluation.error, evaluation.httpStatus);
      }

      const response = {
        intentId,
        status: evaluation.value.status,
        evaluation: evaluation.value.evaluation,
        ...(evaluation.value.vetoExpiresAt
          ? { veto_expires_at: evaluation.value.vetoExpiresAt.toISOString() }
          : {}),
      };

      log.info("intent.evaluate.completed", "Intent evaluation completed", {
        intentId,
        status: evaluation.value.status,
      });

      return jsonResponse(response, 200);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error("intent.evaluate.error", "Intent evaluation pipeline failed", error, {
        intentId,
        error_message: errMsg,
      });
      return jsonError("Internal evaluation error", 500);
    }
  };

  const handleVeto = async (
    workspaceId: string,
    intentId: string,
    request: Request,
  ): Promise<Response> => {
    let body: { reason: string };
    try {
      body = await request.json() as { reason: string };
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length === 0) {
      return jsonError("reason is required", 400);
    }

    const result = await updateIntentStatus(surreal, intentId, "vetoed", {
      veto_reason: body.reason.trim(),
    });

    if (!result.ok) {
      log.error("intent.veto.failed", "Failed to veto intent", new Error(result.error), {
        intentId,
        workspaceId,
      });
      return jsonError(result.error, 409);
    }

    log.info("intent.vetoed", "Intent vetoed by user", {
      intentId,
      workspaceId,
      reason: body.reason.trim(),
    });

    return jsonResponse({
      intentId,
      status: "vetoed",
    }, 200);
  };

  const handleListPending = async (workspaceId: string): Promise<Response> => {
    const intents = await listPendingIntents(surreal, workspaceId);

    return jsonResponse({
      intents: intents.map((intent) => ({
        id: intent.id.id as string,
        goal: intent.goal,
        reasoning: intent.reasoning,
        priority: intent.priority,
        action_spec: intent.action_spec,
        veto_expires_at: intent.veto_expires_at,
        created_at: intent.created_at,
      })),
    }, 200);
  };

  const handleConsent = async (
    _workspaceId: string,
    intentId: string,
  ): Promise<Response> => {
    const intent = await getIntentById(surreal, intentId);
    if (!intent) {
      return jsonError("Intent not found", 404);
    }

    // Only pending_veto intents have consent display
    if (intent.status !== "pending_veto") {
      return jsonError(`Intent is in '${intent.status}' status, expected 'pending_veto'`, 409);
    }

    const authDetails = intent.authorization_details ?? [];
    const firstAction = authDetails[0];

    const consentDisplay = firstAction
      ? renderConsentDisplay(firstAction)
      : { action_display: "Unknown", resource_display: "Unknown" };

    return jsonResponse({
      ...consentDisplay,
      risk_score: intent.evaluation?.risk_score ?? 0,
      reasoning: intent.evaluation?.reason ?? "",
      expires_at: intent.veto_expires_at
        ? (intent.veto_expires_at instanceof Date
          ? intent.veto_expires_at.toISOString()
          : String(intent.veto_expires_at))
        : "",
    }, 200);
  };

  const handleApprove = async (
    workspaceId: string,
    intentId: string,
  ): Promise<Response> => {
    const result = await updateIntentStatus(surreal, intentId, "authorized");

    if (!result.ok) {
      log.error("intent.approve.failed", "Failed to approve intent", new Error(result.error), {
        intentId,
        workspaceId,
      });
      return jsonError(result.error, 409);
    }

    log.info("intent.approved", "Intent approved by human", {
      intentId,
      workspaceId,
    });

    return jsonResponse({
      intentId,
      status: "authorized",
    }, 200);
  };

  const handleConstrain = async (
    workspaceId: string,
    intentId: string,
    request: Request,
  ): Promise<Response> => {
    let body: { constrained_authorization_details: OsabioAction[] };
    try {
      body = await request.json() as { constrained_authorization_details: OsabioAction[] };
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    if (!body.constrained_authorization_details || !Array.isArray(body.constrained_authorization_details)) {
      return jsonError("constrained_authorization_details is required", 400);
    }

    const intent = await getIntentById(surreal, intentId);
    if (!intent) {
      return jsonError("Intent not found", 404);
    }

    if (intent.status !== "pending_veto") {
      return jsonError(`Intent is in '${intent.status}' status, expected 'pending_veto'`, 409);
    }

    const originalDetails = intent.authorization_details ?? [];
    const proposedDetails = body.constrained_authorization_details;

    // Validate each proposed action against its original
    for (let i = 0; i < proposedDetails.length; i++) {
      const original = originalDetails[i];
      const proposed = proposedDetails[i];

      if (!original) {
        return jsonError(`No original authorization_details at index ${i}`, 400);
      }

      const boundsCheck = validateTighterBounds(original, proposed);
      if (!boundsCheck.valid) {
        return jsonError(
          `Constraint validation failed: ${boundsCheck.violations.join("; ")}`,
          400,
        );
      }
    }

    // Update intent with tighter constraints and authorize
    const record = await updateIntentStatus(surreal, intentId, "authorized", {});
    if (!record.ok) {
      return jsonError(record.error, 409);
    }

    // Update the authorization_details with the constrained version
    await surreal.query(
      "UPDATE $record SET authorization_details = $details;",
      {
        record: new RecordId("intent", intentId),
        details: proposedDetails,
      },
    );

    log.info("intent.constrained", "Intent constrained and authorized by human", {
      intentId,
      workspaceId,
    });

    return jsonResponse({
      intentId,
      status: "authorized",
    }, 200);
  };

  return { handleEvaluate, handleVeto, handleListPending, handleConsent, handleApprove, handleConstrain };
}
