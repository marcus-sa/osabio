import { jsonError, jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { updateIntentStatus, listPendingIntents } from "./intent-queries";
import { evaluateIntent, createLlmEvaluator } from "./authorizer";
import { routeByRisk } from "./risk-router";
import type { ServerDependencies } from "../runtime/types";
import type { IntentRecord } from "./types";

// --- Route Handler Types ---

type IntentRouteHandlers = {
  handleEvaluate: (request: Request) => Promise<Response>;
  handleVeto: (workspaceId: string, intentId: string, request: Request) => Promise<Response>;
  handleListPending: (workspaceId: string) => Promise<Response>;
};

// --- Factory ---

export function createIntentRouteHandlers(deps: ServerDependencies): IntentRouteHandlers {
  const { surreal } = deps;

  const llmEvaluator = createLlmEvaluator(deps.extractionModel);

  const handleEvaluate = async (request: Request): Promise<Response> => {
    // Called by SurrealQL EVENT via http::post - receives full intent record as body
    let body: IntentRecord;
    try {
      body = await request.json() as IntentRecord;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const intentId = typeof body.id === "object" && body.id !== undefined
      ? (body.id.id as string)
      : undefined;

    if (!intentId) {
      return jsonError("Missing intent id in body", 400);
    }

    if (!body.requester) {
      return jsonError("Missing requester in intent body", 400);
    }

    logInfo("intent.evaluate.received", "Evaluate endpoint received intent", {
      intentId,
      status: body.status,
      goal: body.goal,
    });

    // Idempotency guard: only process intents in pending_auth status
    if (body.status !== "pending_auth") {
      logInfo("intent.evaluate.skipped", "Intent not in pending_auth status", {
        intentId,
        currentStatus: body.status,
      });
      return jsonError(`Intent is in '${body.status}' status, expected 'pending_auth'`, 409);
    }

    try {
      // Pipeline: policy gate -> LLM evaluator -> risk router -> status update
      const requesterId = typeof body.requester === "object" && body.requester !== undefined
        ? (body.requester.id as string)
        : String(body.requester);

      const evaluation = await evaluateIntent({
        intent: {
          goal: body.goal,
          reasoning: body.reasoning,
          action_spec: body.action_spec,
          budget_limit: body.budget_limit,
          requester: requesterId,
        },
        policy: {},
        llmEvaluator,
      });

      const routing = routeByRisk(evaluation);
      const evaluationRecord = {
        ...evaluation,
        evaluated_at: new Date(),
      };

      switch (routing.route) {
        case "auto_approve": {
          const result = await updateIntentStatus(surreal, intentId, "authorized", {
            evaluation: evaluationRecord,
          });
          if (!result.ok) {
            logError("intent.evaluate.update_failed", result.error, { intentId });
            return jsonError(result.error, 409);
          }
          logInfo("intent.authorized", "Intent auto-approved", { intentId });
          return jsonResponse({ intentId, status: "authorized", evaluation }, 200);
        }

        case "veto_window": {
          const result = await updateIntentStatus(surreal, intentId, "pending_veto", {
            evaluation: evaluationRecord,
            veto_expires_at: routing.expires_at,
          });
          if (!result.ok) {
            logError("intent.evaluate.update_failed", result.error, { intentId });
            return jsonError(result.error, 409);
          }
          logInfo("intent.pending_veto", "Intent requires veto window", {
            intentId,
            veto_expires_at: routing.expires_at.toISOString(),
          });
          return jsonResponse({
            intentId,
            status: "pending_veto",
            evaluation,
            veto_expires_at: routing.expires_at.toISOString(),
          }, 200);
        }

        case "reject": {
          const result = await updateIntentStatus(surreal, intentId, "vetoed", {
            evaluation: evaluationRecord,
          });
          if (!result.ok) {
            logError("intent.evaluate.update_failed", result.error, { intentId });
            return jsonError(result.error, 409);
          }
          logInfo("intent.vetoed", "Intent rejected by evaluation", {
            intentId,
            reason: routing.reason,
          });
          return jsonResponse({ intentId, status: "vetoed", evaluation }, 200);
        }
      }
    } catch (error) {
      logError("intent.evaluate.error", error instanceof Error ? error.message : String(error), {
        intentId,
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
      logError("intent.veto.failed", result.error, { intentId, workspaceId });
      return jsonError(result.error, 409);
    }

    logInfo("intent.vetoed", "Intent vetoed by user", {
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

  return { handleEvaluate, handleVeto, handleListPending };
}
