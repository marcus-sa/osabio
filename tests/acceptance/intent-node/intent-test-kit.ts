/**
 * Intent Node Acceptance Test Kit
 *
 * Extends the orchestrator-test-kit with intent-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST /api/intents/:id/evaluate  (SurrealQL EVENT target)
 *   POST /api/intents/:id/veto      (human veto)
 *   MCP tools: create_intent, submit_intent, get_intent_status
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  createIntentDirectly,
  createIdentity,
  type ActionSpec,
} from "../shared-fixtures";

// Re-export everything from orchestrator-test-kit
export {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestProject,
  getTestUserBearerToken,
  fetchJson,
  fetchRaw,
  type OrchestratorTestRuntime,
  type TestUser,
  type TestUserWithToken,
  type TestWorkspace,
  type TestTask,
  type TestProject,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

import {
  fetchJson,
  type TestUser,
  type TestUserWithToken,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

// Re-export ActionSpec from shared-fixtures (single source of truth)
export type { ActionSpec } from "../shared-fixtures";

// ---------------------------------------------------------------------------
// Intent-Specific Types
// ---------------------------------------------------------------------------

export type IntentStatus =
  | "draft"
  | "pending_auth"
  | "pending_veto"
  | "authorized"
  | "executing"
  | "completed"
  | "vetoed"
  | "failed";

export type BudgetLimit = {
  amount: number;
  currency: string;
};

export type EvaluationResult = {
  decision: "APPROVE" | "REJECT";
  risk_score: number;
  reason: string;
  evaluated_at: string;
  policy_only: boolean;
};

export type IntentRecord = {
  id: RecordId<"intent">;
  goal: string;
  reasoning: string;
  status: IntentStatus;
  priority: number;
  action_spec: ActionSpec;
  budget_limit?: BudgetLimit;
  evaluation?: EvaluationResult;
  veto_expires_at?: string;
  veto_reason?: string;
  error_reason?: string;
  trace_id: RecordId<"trace">;
  created_at: string;
  updated_at?: string;
};

export type CreateIntentOptions = {
  goal: string;
  reasoning: string;
  priority?: number;
  action_spec: ActionSpec;
  budget_limit?: BudgetLimit;
  taskId?: string;
};

// ---------------------------------------------------------------------------
// Domain Helpers -- Business Language Layer
// ---------------------------------------------------------------------------

/**
 * Creates a draft intent directly in the database.
 * Used as a Given-step precondition for scenarios that start
 * with an intent already in draft status.
 */
export async function createDraftIntent(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: CreateIntentOptions,
): Promise<{ intentId: string; intentRecord: RecordId<"intent"> }> {
  const result = await createIntentDirectly(surreal, workspaceId, requesterId, {
    goal: opts.goal,
    reasoning: opts.reasoning,
    status: "draft",
    priority: opts.priority,
    actionSpec: opts.action_spec,
    budgetLimit: opts.budget_limit,
    taskId: opts.taskId,
  });
  return { intentId: result.intentId, intentRecord: result.intentRecord };
}

/**
 * Submits a draft intent for authorization.
 * Transitions draft -> pending_auth, which triggers the SurrealQL EVENT.
 */
export async function submitIntent(
  surreal: Surreal,
  intentId: string,
): Promise<void> {
  const intentRecord = new RecordId("intent", intentId);
  await surreal.query(
    `UPDATE $intent SET status = "pending_auth", updated_at = time::now();`,
    { intent: intentRecord },
  );
}

/**
 * Queries the current status of an intent from the database.
 */
export async function getIntentStatus(
  surreal: Surreal,
  intentId: string,
): Promise<IntentStatus> {
  const intentRecord = new RecordId("intent", intentId);
  const rows = (await surreal.query(`SELECT status FROM $intent;`, {
    intent: intentRecord,
  })) as Array<Array<{ status: IntentStatus }>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error(`Intent ${intentId} not found`);
  }
  return result.status;
}

/**
 * Queries the full intent record from the database.
 */
export async function getIntentRecord(
  surreal: Surreal,
  intentId: string,
): Promise<IntentRecord> {
  const intentRecord = new RecordId("intent", intentId);
  const rows = (await surreal.query(`SELECT * FROM $intent;`, {
    intent: intentRecord,
  })) as Array<Array<IntentRecord>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error(`Intent ${intentId} not found`);
  }
  return result;
}

/**
 * Queries the evaluation result for an intent.
 */
export async function getIntentEvaluation(
  surreal: Surreal,
  intentId: string,
): Promise<EvaluationResult | undefined> {
  const record = await getIntentRecord(surreal, intentId);
  return record.evaluation;
}

/**
 * Human vetoes an intent within the veto window.
 * Exercises the driving port: POST /api/intents/:id/veto
 */
export async function vetoIntent(
  baseUrl: string,
  user: TestUser | TestUserWithToken,
  workspaceId: string,
  intentId: string,
  reason: string,
): Promise<{ vetoed: boolean }> {
  return fetchJson<{ vetoed: boolean }>(
    `${baseUrl}/api/workspaces/${workspaceId}/intents/${intentId}/veto`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ reason }),
    },
  );
}

/**
 * Lists intents in the governance feed that are pending human review.
 */
export async function listPendingIntents(
  surreal: Surreal,
  workspaceId: string,
): Promise<IntentRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT * FROM intent
     WHERE workspace = $ws AND status IN ["pending_veto"]
     ORDER BY priority DESC, created_at ASC;`,
    { ws: workspaceRecord },
  )) as Array<IntentRecord[]>;
  return rows[0] ?? [];
}

/**
 * Creates an intent via the MCP tool endpoint (driving port).
 */
export async function createIntentViaMcp(
  baseUrl: string,
  user: TestUserWithToken,
  workspaceId: string,
  opts: CreateIntentOptions,
): Promise<{ intentId: string }> {
  const res = await user.mcpFetch(
    `/api/mcp/${workspaceId}/tools/create_intent`,
    {
      body: {
        goal: opts.goal,
        reasoning: opts.reasoning,
        priority: opts.priority ?? 50,
        action_spec: opts.action_spec,
        budget_limit: opts.budget_limit,
        task_id: opts.taskId,
      },
    },
  );
  if (!res.ok) throw new Error(`createIntentViaMcp failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ intentId: string }>;
}

/**
 * Submits an intent via the MCP tool endpoint (driving port).
 */
export async function submitIntentViaMcp(
  baseUrl: string,
  user: TestUserWithToken,
  workspaceId: string,
  intentId: string,
): Promise<{ status: IntentStatus }> {
  const res = await user.mcpFetch(
    `/api/mcp/${workspaceId}/tools/submit_intent`,
    { body: { intent_id: intentId } },
  );
  if (!res.ok) throw new Error(`submitIntentViaMcp failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ status: IntentStatus }>;
}

/**
 * Gets intent status via the MCP tool endpoint (driving port).
 */
export async function getIntentStatusViaMcp(
  baseUrl: string,
  user: TestUserWithToken,
  workspaceId: string,
  intentId: string,
): Promise<{ intentId: string; status: IntentStatus }> {
  const res = await user.mcpFetch(
    `/api/mcp/${workspaceId}/tools/get_intent_status`,
    { body: { intent_id: intentId } },
  );
  if (!res.ok) throw new Error(`getIntentStatusViaMcp failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ intentId: string; status: IntentStatus }>;
}

/**
 * Polls until an intent reaches the target status or times out.
 * Used to wait for async evaluation pipeline (SurrealQL EVENT -> evaluate -> status update).
 */
export async function waitForIntentStatus(
  surreal: Surreal,
  intentId: string,
  targetStatus: IntentStatus | IntentStatus[],
  timeoutMs = 30_000,
): Promise<IntentStatus> {
  const targets = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const current = await getIntentStatus(surreal, intentId);
    if (targets.includes(current)) {
      return current;
    }
    await Bun.sleep(250);
  }

  const finalStatus = await getIntentStatus(surreal, intentId);
  throw new Error(
    `Intent ${intentId} did not reach ${targets.join("|")} within ${timeoutMs}ms. ` +
    `Current status: ${finalStatus}`,
  );
}

/**
 * Simulates the evaluation endpoint completing (for tests where the
 * SurrealQL EVENT may not fire in the test environment).
 * Directly updates the intent with an evaluation result and new status.
 */
export async function simulateEvaluation(
  surreal: Surreal,
  intentId: string,
  evaluation: {
    decision: "APPROVE" | "REJECT";
    risk_score: number;
    reason: string;
    policy_only?: boolean;
  },
  resultStatus: IntentStatus,
): Promise<void> {
  const intentRecord = new RecordId("intent", intentId);
  const evalContent = {
    decision: evaluation.decision,
    risk_score: evaluation.risk_score,
    reason: evaluation.reason,
    evaluated_at: new Date(),
    policy_only: evaluation.policy_only ?? false,
  };

  const updates: Record<string, unknown> = {
    status: resultStatus,
    evaluation: evalContent,
    updated_at: new Date(),
  };

  // If entering veto window, set expiry
  if (resultStatus === "pending_veto") {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min default
    updates.veto_expires_at = expiresAt;
  }

  await surreal.query(`UPDATE $intent MERGE $updates;`, {
    intent: intentRecord,
    updates,
  });
}

/**
 * Queries the identity record for a user to get the identity ID.
 * Needed because intent.requester links to identity, not user.
 */
export async function getIdentityId(
  surreal: Surreal,
): Promise<string> {
  const rows = (await surreal.query(
    `SELECT id FROM identity LIMIT 1;`,
  )) as Array<Array<{ id: RecordId<"identity"> }>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error("No identity found -- create a test user first");
  }
  return result.id.id as string;
}

/**
 * Creates a test identity directly in the database.
 * Used when we need an identity record without going through auth.
 */
export async function createTestIdentity(
  surreal: Surreal,
  name: string,
  type: "human" | "agent" = "agent",
  workspaceId?: string,
): Promise<string> {
  if (workspaceId) {
    const result = await createIdentity(surreal, workspaceId, name, type);
    return result.identityId;
  }
  // Legacy: identity without workspace (no member_of edge)
  const identityId = crypto.randomUUID();
  const identityRecord = new RecordId("identity", identityId);
  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: { name, type, created_at: new Date() },
  });
  return identityId;
}

/**
 * Wires the SurrealQL EVENT that fires when an intent transitions to
 * pending_auth. The EVENT calls http::post to the real test server's
 * evaluate endpoint, enabling true E2E testing of the async evaluation flow.
 *
 * Callback host can be overridden via INTENT_EVAL_CALLBACK_HOST.
 * Call this in beforeAll after the test server has booted.
 */
export async function wireIntentEvaluationEvent(
  surreal: Surreal,
  port: number,
): Promise<void> {
  const configuredHost = process.env.INTENT_EVAL_CALLBACK_HOST?.trim();
  const candidateHosts = configuredHost && configuredHost.length > 0
    ? [configuredHost]
    : ["127.0.0.1", "host.docker.internal"];

  let baseUrl: string | undefined;
  let lastError = "";

  for (const host of candidateHosts) {
    const candidateBaseUrl = `http://${host}:${port}`;

    try {
      await surreal.query(`RETURN http::head($url);`, {
        url: `${candidateBaseUrl}/healthz`,
      });
      baseUrl = candidateBaseUrl;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!baseUrl) {
    throw new Error(
      `Unable to reach acceptance server from SurrealDB for intent callback. ` +
      `Tried hosts: ${candidateHosts.join(", ")} on port ${port}. ` +
      `Last error: ${lastError}`,
    );
  }

  await surreal.query(`
    DEFINE EVENT OVERWRITE intent_pending_auth ON intent
      ASYNC
      RETRY 3
      WHEN $before.status != "pending_auth" AND $after.status = "pending_auth"
      THEN {
        http::post("${baseUrl}/api/intents/" + <string> meta::id($after.id) + "/evaluate", $after)
      };
  `);
}
