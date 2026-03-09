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
  fetchRaw,
  type TestUser,
  type TestUserWithToken,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

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

export type ActionSpec = {
  provider: string;
  action: string;
  params?: Record<string, unknown>;
};

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
  trace_id: string;
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
  const intentId = `intent-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const intentRecord = new RecordId("intent", intentId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const requesterRecord = new RecordId("identity", requesterId);

  const content: Record<string, unknown> = {
    goal: opts.goal,
    reasoning: opts.reasoning,
    status: "draft",
    priority: opts.priority ?? 50,
    action_spec: opts.action_spec,
    trace_id: `trace-${intentId}`,
    requester: requesterRecord,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (opts.budget_limit) {
    content.budget_limit = opts.budget_limit;
  }

  await surreal.query(`CREATE $intent CONTENT $content;`, {
    intent: intentRecord,
    content,
  });

  // Link to originating task if provided
  if (opts.taskId) {
    const taskRecord = new RecordId("task", opts.taskId);
    await surreal.query(
      `RELATE $intent->triggered_by->$task SET created_at = time::now();`,
      { intent: intentRecord, task: taskRecord },
    );
  }

  return { intentId, intentRecord };
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
  const headers = "bearerHeaders" in user
    ? (user as TestUserWithToken).bearerHeaders
    : { "Content-Type": "application/json", ...user.headers };

  return fetchJson<{ vetoed: boolean }>(
    `${baseUrl}/api/workspaces/${workspaceId}/intents/${intentId}/veto`,
    {
      method: "POST",
      headers,
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
  return fetchJson<{ intentId: string }>(
    `${baseUrl}/api/mcp/${workspaceId}/tools/create_intent`,
    {
      method: "POST",
      headers: user.bearerHeaders,
      body: JSON.stringify({
        goal: opts.goal,
        reasoning: opts.reasoning,
        priority: opts.priority ?? 50,
        action_spec: opts.action_spec,
        budget_limit: opts.budget_limit,
        task_id: opts.taskId,
      }),
    },
  );
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
  return fetchJson<{ status: IntentStatus }>(
    `${baseUrl}/api/mcp/${workspaceId}/tools/submit_intent`,
    {
      method: "POST",
      headers: user.bearerHeaders,
      body: JSON.stringify({ intent_id: intentId }),
    },
  );
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
  return fetchJson<{ intentId: string; status: IntentStatus }>(
    `${baseUrl}/api/mcp/${workspaceId}/tools/get_intent_status`,
    {
      method: "POST",
      headers: user.bearerHeaders,
      body: JSON.stringify({ intent_id: intentId }),
    },
  );
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
  const identityId = `id-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const identityRecord = new RecordId("identity", identityId);

  const content: Record<string, unknown> = {
    name,
    type,
    created_at: new Date(),
  };

  if (workspaceId) {
    content.workspace = new RecordId("workspace", workspaceId);
  }

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content,
  });
  return identityId;
}

/**
 * Wires the SurrealQL EVENT that fires when an intent transitions to
 * pending_auth. The EVENT calls http::post to the real test server's
 * evaluate endpoint, enabling true E2E testing of the async evaluation flow.
 *
 * Call this in beforeAll after the test server has booted.
 */
export async function wireIntentEvaluationEvent(
  surreal: Surreal,
  port: number,
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}`;
  await surreal.query(`
    DEFINE EVENT OVERWRITE intent_pending_auth ON intent
      WHEN $before.status != "pending_auth" AND $after.status = "pending_auth"
      THEN {
        http::post("${baseUrl}/api/intents/" + <string> meta::id($after.id) + "/evaluate", $after)
      };
  `);
}
