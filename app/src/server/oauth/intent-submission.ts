/**
 * Intent Submission with DPoP Thumbprint Binding
 *
 * OAuth 2.1 RAR+DPoP intent submission endpoint.
 * Validates authorization_details with type "brain_action" and dpop_jwk_thumbprint,
 * creates intent record, triggers evaluation pipeline.
 *
 * Pure validation functions + HTTP handler factory.
 */

import { RecordId } from "surrealdb";
import type { BrainAction } from "./types";
import type { ActionSpec } from "../intent/types";
import type { ServerDependencies } from "../runtime/types";
import { jsonError, jsonResponse } from "../http/response";
import { createIntent, createTrace, updateIntentStatus } from "../intent/intent-queries";
import { evaluateIntent, createLlmEvaluator } from "../intent/authorizer";
import { routeByRisk } from "../intent/risk-router";
import {
  checkIdentityAllowed,
  type LookupIdentity,
  type LookupManager,
} from "./identity-lifecycle";

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export type IntentSubmissionInput = {
  workspace_id: string;
  identity_id: string;
  authorization_details: BrainAction[];
  dpop_jwk_thumbprint: string;
  goal: string;
  reasoning: string;
  priority?: number;
};

type ValidationResult =
  | { valid: true; data: IntentSubmissionInput }
  | { valid: false; error: string };

// ---------------------------------------------------------------------------
// Pure Validation
// ---------------------------------------------------------------------------

const LOW_RISK_ACTIONS = new Set(["read", "list", "get", "search", "query"]);

export function validateIntentSubmission(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { valid: false, error: "Request body must be a non-null object" };
  }

  const body = input as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ["workspace_id", "identity_id", "goal", "reasoning"] as const;
  for (const field of requiredStrings) {
    if (typeof body[field] !== "string" || (body[field] as string).trim().length === 0) {
      return { valid: false, error: `${field} is required and must be a non-empty string` };
    }
  }

  // dpop_jwk_thumbprint
  if (typeof body.dpop_jwk_thumbprint !== "string" || (body.dpop_jwk_thumbprint as string).trim().length === 0) {
    return { valid: false, error: "dpop_jwk_thumbprint is required and must be a non-empty string" };
  }

  // authorization_details
  if (!Array.isArray(body.authorization_details)) {
    return { valid: false, error: "authorization_details is required and must be an array" };
  }

  if (body.authorization_details.length === 0) {
    return { valid: false, error: "authorization_details must contain at least one entry" };
  }

  for (let i = 0; i < body.authorization_details.length; i++) {
    const entry = body.authorization_details[i] as Record<string, unknown>;
    const validationError = validateBrainActionEntry(entry, i);
    if (validationError) {
      return { valid: false, error: validationError };
    }
  }

  // Optional priority
  const priority = typeof body.priority === "number" ? body.priority : undefined;

  return {
    valid: true,
    data: {
      workspace_id: (body.workspace_id as string).trim(),
      identity_id: (body.identity_id as string).trim(),
      authorization_details: body.authorization_details as BrainAction[],
      dpop_jwk_thumbprint: (body.dpop_jwk_thumbprint as string).trim(),
      goal: (body.goal as string).trim(),
      reasoning: (body.reasoning as string).trim(),
      ...(priority !== undefined ? { priority } : {}),
    },
  };
}

export function validateBrainActionEntry(entry: Record<string, unknown>, index: number): string | undefined {
  if (!entry || typeof entry !== "object") {
    return `authorization_details[${index}] must be an object`;
  }

  if (entry.type !== "brain_action") {
    return `authorization_details[${index}].type must be "brain_action"`;
  }

  if (typeof entry.action !== "string" || entry.action.trim().length === 0) {
    return `authorization_details[${index}].action is required and must be a non-empty string`;
  }

  if (typeof entry.resource !== "string" || entry.resource.trim().length === 0) {
    return `authorization_details[${index}].resource is required and must be a non-empty string`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Pure Transformations
// ---------------------------------------------------------------------------

/** Derive backward-compatible ActionSpec from first BrainAction */
export function deriveActionSpec(actions: BrainAction[]): ActionSpec {
  const first = actions[0];
  return {
    provider: "brain",
    action: first.action,
    params: { resource: first.resource },
  };
}

/** Check if all actions are low-risk read operations */
export function isLowRiskReadAction(actions: BrainAction[]): boolean {
  return actions.every((a) => LOW_RISK_ACTIONS.has(a.action.toLowerCase()));
}

// ---------------------------------------------------------------------------
// HTTP Handler Factory
// ---------------------------------------------------------------------------

export type IntentSubmissionDeps = {
  lookupIdentity: LookupIdentity;
  lookupManager: LookupManager;
};

export type SubmitIntentForAuthorizationDeps = {
  surreal: import("surrealdb").Surreal;
  extractionModel: ServerDependencies["extractionModel"];
  identityDeps?: IntentSubmissionDeps;
};

export type SubmitIntentForAuthorizationResult = {
  intentId: string;
  status: "authorized" | "pending_auth";
  traceId: string;
};

export async function submitIntentForAuthorization(
  input: IntentSubmissionInput,
  deps: SubmitIntentForAuthorizationDeps,
): Promise<SubmitIntentForAuthorizationResult> {
  const { surreal } = deps;
  const llmEvaluator = createLlmEvaluator(deps.extractionModel);
  const lookupIdentity: LookupIdentity = deps.identityDeps?.lookupIdentity ?? createSurrealIdentityLookup(surreal);
  const lookupManager: LookupManager = deps.identityDeps?.lookupManager ?? createSurrealManagerLookup(surreal);

  const requester = new RecordId("identity", input.identity_id);
  const workspace = new RecordId("workspace", input.workspace_id);

  const identityCheck = await checkIdentityAllowed(
    input.identity_id,
    lookupIdentity,
    lookupManager,
  );

  if (!identityCheck.allowed) {
    log.info("intent.submission.identity_blocked", "Intent submission blocked by identity check", {
      identityId: input.identity_id,
      reason: identityCheck.reason,
      code: identityCheck.code,
    });
    throw new Error(identityCheck.reason);
  }

  const actionSpec = deriveActionSpec(input.authorization_details);

  const traceRecord = await createTrace(surreal, {
    type: "intent_submission",
    actor: requester,
    workspace,
    input: { authorization_details: input.authorization_details, goal: input.goal },
  });

  const intentId = await createIntent(surreal, {
    goal: input.goal,
    reasoning: input.reasoning,
    priority: input.priority ?? 0,
    action_spec: actionSpec,
    trace_id: traceRecord,
    requester,
    workspace,
    authorization_details: input.authorization_details,
    dpop_jwk_thumbprint: input.dpop_jwk_thumbprint,
  });

  log.info("intent.submission.created", "Intent created via OAuth submission", {
    intentId: intentId.id as string,
    traceId: traceRecord.id as string,
    workspaceId: input.workspace_id,
  });

  const transitionResult = await updateIntentStatus(
    surreal,
    intentId.id as string,
    "pending_auth",
  );

  if (!transitionResult.ok) {
    log.error(
      "intent.submission.transition_failed",
      "Failed to transition intent to pending_auth",
      new Error(transitionResult.error),
      { intentId: intentId.id as string },
    );
    throw new Error("Failed to submit intent for evaluation");
  }

  if (isLowRiskReadAction(input.authorization_details)) {
    try {
      const evaluation = await evaluateIntent({
        intent: {
          goal: input.goal,
          reasoning: input.reasoning,
          action_spec: actionSpec,
        },
        surreal,
        identityId: requester,
        workspaceId: workspace,
        requesterType: "agent",
        llmEvaluator,
        timeoutMs: 10_000,
      });

      const routing = routeByRisk(evaluation);
      const evaluationRecord = {
        ...evaluation,
        evaluated_at: new Date(),
      };

      if (routing.route === "auto_approve" || (routing.route === "veto_window")) {
        await updateIntentStatus(surreal, intentId.id as string, "authorized", {
          evaluation: evaluationRecord,
        });

        log.info("intent.submission.auto_approved", "Low-risk read intent auto-approved", {
          intentId: intentId.id as string,
        });

        return {
          intentId: intentId.id as string,
          status: "authorized",
          traceId: traceRecord.id as string,
        };
      }
    } catch (error) {
      log.error(
        "intent.submission.inline_eval_failed",
        "Inline evaluation failed, falling back to async",
        error,
        { intentId: intentId.id as string },
      );
    }
  }

  return {
    intentId: intentId.id as string,
    status: "pending_auth",
    traceId: traceRecord.id as string,
  };
}

export function createIntentSubmissionHandler(
  deps: ServerDependencies,
  identityDeps?: IntentSubmissionDeps,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const validation = validateIntentSubmission(body);
    if (!validation.valid) {
      return jsonError(validation.error, 400);
    }

    try {
      const result = await submitIntentForAuthorization(validation.data, {
        surreal: deps.surreal,
        extractionModel: deps.extractionModel,
        ...(identityDeps ? { identityDeps } : {}),
      });
      return jsonResponse({
        intent_id: result.intentId,
        status: result.status,
        trace_id: result.traceId,
      }, 201);
    } catch (error) {
      if (error instanceof Error && (
        error.message === "Identity not found" ||
        error.message === "Identity has been revoked" ||
        error.message === "Identity is suspended" ||
        error.message === "Managing human identity not found" ||
        error.message === "Managing human is inactive"
      )) {
        return jsonError(error.message, 403);
      }
      log.error("intent.submission.error", "Intent submission failed", error);
      return jsonError("Internal server error", 500);
    }
  };
}

// ---------------------------------------------------------------------------
// SurrealDB Identity Lookups (adapter functions)
// ---------------------------------------------------------------------------

import type { Surreal } from "surrealdb";
import type { ResolvedIdentity, ResolvedManager } from "./identity-lifecycle";
import { log } from "../telemetry/logger";

type SurrealIdentityRow = {
  identityId: string;
  identityType: string;
  identityStatus?: string;
  managedBy?: string;
  revokedAt?: string;
};

export function createSurrealIdentityLookup(surreal: Surreal): LookupIdentity {
  return async (identityId: string) => {
    const rows = await surreal.query<[SurrealIdentityRow[]]>(
      `SELECT meta::id(id) AS identityId, type AS identityType, identity_status AS identityStatus, managed_by AS managedBy, revoked_at AS revokedAt FROM $identity;`,
      { identity: new RecordId("identity", identityId) },
    );

    const row = rows[0]?.[0];
    if (!row) return undefined;

    return {
      identityId: row.identityId,
      identityType: row.identityType as ResolvedIdentity["identityType"],
      identityStatus: (row.identityStatus ?? "active") as ResolvedIdentity["identityStatus"],
      managedBy: row.managedBy,
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
    };
  };
}

export function createSurrealManagerLookup(surreal: Surreal): LookupManager {
  return async (managerId: string) => {
    // Manager ID stored as raw string reference; look up identity by searching
    const rows = await surreal.query<[Array<{ identityStatus?: string }>]>(
      `SELECT identity_status AS identityStatus FROM identity WHERE meta::id(id) = $managerId LIMIT 1;`,
      { managerId },
    );

    const row = rows[0]?.[0];
    if (!row) return undefined;

    return {
      identityId: managerId,
      identityStatus: (row.identityStatus ?? "active") as ResolvedManager["identityStatus"],
    };
  };
}
