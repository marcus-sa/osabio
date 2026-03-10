/**
 * Bridge Session-to-Token Exchange
 *
 * POST /api/auth/bridge/exchange accepting Better Auth session cookie +
 * DPoP proof + authorization_details. Validates session, resolves human
 * identity, creates implicit intent, evaluates via pipeline, issues
 * DPoP-bound token.
 *
 * Pure validation functions + HTTP handler factory.
 *
 * Step: 04-01
 */
import { RecordId, type Surreal } from "surrealdb";
import type { BrainAction } from "./types";
import type { ServerDependencies } from "../runtime/types";
import { validateDPoPProof } from "./dpop";
import { issueAccessToken } from "./token-issuer";
import { createIntent, createTrace, updateIntentStatus, recordTokenIssuance } from "../intent/intent-queries";
import {
  isLowRiskReadAction,
  deriveActionSpec,
  validateBrainActionEntry,
} from "./intent-submission";
import { evaluateIntent, createLlmEvaluator } from "../intent/authorizer";
import { routeByRisk } from "../intent/risk-router";
import { jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { logAuditEvent, createAuditEvent } from "./audit";
import { oauthErrorResponse } from "./oauth-errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BridgeExchangeInput = {
  authorizationDetails: BrainAction[];
};

type BridgeValidation =
  | { valid: true; data: BridgeExchangeInput }
  | { valid: false; error: string };

// ---------------------------------------------------------------------------
// Pure Validation: Request Body
// ---------------------------------------------------------------------------

export function validateBridgeExchangeRequest(body: unknown): BridgeValidation {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a non-null object" };
  }

  const input = body as Record<string, unknown>;

  if (!Array.isArray(input.authorization_details)) {
    return {
      valid: false,
      error: "authorization_details is required and must be an array",
    };
  }

  if (input.authorization_details.length === 0) {
    return {
      valid: false,
      error: "authorization_details must contain at least one entry",
    };
  }

  for (let i = 0; i < input.authorization_details.length; i++) {
    const entry = input.authorization_details[i] as Record<string, unknown>;
    const validationError = validateBrainActionEntry(entry, i);
    if (validationError) {
      return { valid: false, error: validationError };
    }
  }

  return {
    valid: true,
    data: {
      authorizationDetails: input.authorization_details as BrainAction[],
    },
  };
}

// ---------------------------------------------------------------------------
// Identity + Workspace Resolution
// ---------------------------------------------------------------------------

type HumanContext = {
  identityId: string;
  workspaceId: string;
};

/**
 * Resolves a person's identity and primary workspace via graph traversal.
 * person -> identity_person -> identity -> member_of -> workspace
 */
async function resolveHumanContext(
  surreal: Surreal,
  personId: string,
): Promise<HumanContext | undefined> {
  const person = new RecordId("person", personId);

  // Step 1: person -> identity via identity_person spoke
  const [identityRows] = await surreal.query<[Array<RecordId<"identity", string>>]>(
    "SELECT VALUE in FROM identity_person WHERE out = $person LIMIT 1;",
    { person },
  );
  if (!identityRows || identityRows.length === 0) return undefined;

  const identityRecord = identityRows[0];
  const identityId = identityRecord.id as string;

  // Step 2: identity -> workspace via member_of edge
  const [workspaceRows] = await surreal.query<[Array<{ out: RecordId<"workspace", string> }>]>(
    "SELECT out FROM member_of WHERE in = $identity LIMIT 1;",
    { identity: identityRecord },
  );
  if (!workspaceRows || workspaceRows.length === 0) return undefined;

  const workspaceId = workspaceRows[0].out.id as string;

  return { identityId, workspaceId };
}

// ---------------------------------------------------------------------------
// HTTP Handler Factory
// ---------------------------------------------------------------------------

export function createBridgeExchangeHandler(
  deps: ServerDependencies,
): (request: Request) => Promise<Response> {
  const { surreal, auth, asSigningKey } = deps;
  const llmEvaluator = createLlmEvaluator(deps.extractionModel);

  return async (request: Request): Promise<Response> => {
    // 1. Validate session via Better Auth
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) {
      return oauthErrorResponse(
        "invalid_session",
        "Valid session required",
        401,
      );
    }

    const personId = session.user.id;

    // 2. Extract and validate DPoP proof
    const dpopHeader = request.headers.get("DPoP");
    if (!dpopHeader) {
      return oauthErrorResponse(
        "invalid_request",
        "DPoP proof required",
        400,
      );
    }

    const requestUrl = new URL(request.url);
    const dpopResult = await validateDPoPProof(
      dpopHeader,
      "POST",
      `${requestUrl.origin}/api/auth/bridge/exchange`,
    );

    if (!dpopResult.valid) {
      return oauthErrorResponse("invalid_dpop_proof", dpopResult.error, 400);
    }

    // 3. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return oauthErrorResponse("invalid_request", "Invalid JSON body", 400);
    }

    const validation = validateBridgeExchangeRequest(body);
    if (!validation.valid) {
      return oauthErrorResponse("invalid_request", validation.error, 400);
    }

    const { authorizationDetails } = validation.data;

    // 4. Resolve human identity and workspace from person
    const humanContext = await resolveHumanContext(surreal, personId);
    if (!humanContext) {
      return oauthErrorResponse(
        "invalid_session",
        "No identity found for session user",
        401,
      );
    }

    const { identityId, workspaceId } = humanContext;
    const requester = new RecordId("identity", identityId);
    const workspace = new RecordId("workspace", workspaceId);

    try {
      // 5. Create trace + implicit intent
      const actionSpec = deriveActionSpec(authorizationDetails);

      const traceRecord = await createTrace(surreal, {
        type: "bridge_exchange",
        actor: requester,
        workspace,
        input: { authorization_details: authorizationDetails, source: "bridge_exchange" },
      });

      const intentRecord = await createIntent(surreal, {
        goal: `Bridge exchange: ${authorizationDetails.map((a) => `${a.action} ${a.resource}`).join(", ")}`,
        reasoning: "Implicit intent created by bridge session-to-token exchange",
        priority: 0,
        action_spec: actionSpec,
        trace_id: traceRecord,
        requester,
        workspace,
        authorization_details: authorizationDetails,
        dpop_jwk_thumbprint: dpopResult.thumbprint,
      });

      const intentId = intentRecord.id as string;

      await logAuditEvent(surreal, createAuditEvent("intent_submitted", {
        actor: new RecordId("identity", identityId),
        workspace: new RecordId("workspace", workspaceId),
        intent_id: intentRecord,
        dpop_thumbprint: dpopResult.thumbprint,
        payload: {
          source: "bridge_exchange",
          authorization_details: authorizationDetails,
        },
      })).catch(() => {});

      // 6. Transition to pending_auth
      await updateIntentStatus(surreal, intentId, "pending_auth");

      // 7. Evaluate intent
      const isLowRisk = isLowRiskReadAction(authorizationDetails);

      const evaluation = await evaluateIntent({
        intent: {
          goal: `Bridge exchange: ${authorizationDetails[0].action} ${authorizationDetails[0].resource}`,
          reasoning: "Human operator bridge exchange",
          action_spec: actionSpec,
        },
        surreal,
        identityId: requester,
        workspaceId: workspace,
        requesterType: "human",
        llmEvaluator,
        timeoutMs: 10_000,
      });

      const routing = routeByRisk(evaluation);
      const evaluationRecord = {
        ...evaluation,
        evaluated_at: new Date(),
      };

      // 8. Route by risk
      if (routing.route === "reject") {
        await updateIntentStatus(surreal, intentId, "failed", {
          evaluation: evaluationRecord,
          error_reason: routing.reason,
        });

        await logAuditEvent(surreal, createAuditEvent("token_rejected", {
          actor: new RecordId("identity", identityId),
          workspace: new RecordId("workspace", workspaceId),
          intent_id: new RecordId("intent", intentId),
          dpop_thumbprint: dpopResult.thumbprint,
          payload: { reason: routing.reason, route: "reject" },
        })).catch(() => {});

        return oauthErrorResponse(
          "access_denied",
          routing.reason,
          403,
        );
      }

      if (routing.route === "veto_window" && !isLowRisk) {
        await updateIntentStatus(surreal, intentId, "pending_veto", {
          evaluation: evaluationRecord,
          veto_expires_at: routing.expires_at,
        });

        return jsonResponse(
          {
            status: "pending_veto",
            intent_id: intentId,
            veto_expires_at: routing.expires_at.toISOString(),
          },
          202,
        );
      }

      // 9. Auto-approve: authorize intent and issue token
      await updateIntentStatus(surreal, intentId, "authorized", {
        evaluation: evaluationRecord,
      });

      logInfo("bridge.exchange.authorized", "Bridge intent auto-approved", {
        intentId,
      });

      // 10. Issue DPoP-bound token
      const tokenResult = await issueAccessToken(asSigningKey, {
        sub: `identity:${identityId}`,
        thumbprint: dpopResult.thumbprint,
        authorizationDetails,
        intentId,
        workspace: workspaceId,
        actorType: "human",
      });

      if (!tokenResult.ok) {
        return oauthErrorResponse("server_error", tokenResult.error, 500);
      }

      // 11. Update intent with token timestamps
      const now = new Date();
      await recordTokenIssuance(surreal, intentId, now, tokenResult.expiresAt)
        .catch((err) => {
          logError("bridge.exchange.update_intent", "Failed to update intent with token timestamps", err);
        });

      await logAuditEvent(surreal, createAuditEvent("token_issued", {
        actor: new RecordId("identity", identityId),
        workspace: new RecordId("workspace", workspaceId),
        intent_id: intentRecord,
        dpop_thumbprint: dpopResult.thumbprint,
        payload: {
          expires_at: tokenResult.expiresAt.toISOString(),
          authorization_details: authorizationDetails,
          actor_type: "human",
          source: "bridge_exchange",
        },
      })).catch(() => {});

      const expiresIn = Math.floor(
        (tokenResult.expiresAt.getTime() - now.getTime()) / 1000,
      );

      return jsonResponse(
        {
          access_token: tokenResult.token,
          token_type: "DPoP",
          expires_in: expiresIn,
        },
        200,
      );
    } catch (error) {
      logError("bridge.exchange.error", "Bridge exchange failed", error, {
        personId,
      });
      return oauthErrorResponse("server_error", "Internal server error", 500);
    }
  };
}

