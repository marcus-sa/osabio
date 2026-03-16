/**
 * Intent LLM Traces Acceptance Test Kit
 *
 * Extends observer-test-kit and intent-test-kit with helpers
 * for testing LLM reasoning persistence on observations and intents.
 *
 * Driving ports:
 *   createObservation()          — observation query function
 *   updateIntentStatus()         — intent query function
 *   POST /api/intents/:id/evaluate  — intent evaluation endpoint
 *   GET /api/workspaces/:ws/observer/observations — observation list API
 */
import { RecordId, type Surreal } from "surrealdb";

export { setupAcceptanceSuite } from "../acceptance-test-kit";
export {
  createTestUser,
  createTestWorkspace,
  fetchJson,
  fetchRaw,
  type TestUser,
  type TestWorkspace,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

import { fetchRaw, type TestUser } from "../coding-agent-orchestrator/orchestrator-test-kit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObservationSeverity = "info" | "warning" | "conflict";
export type ObservationStatus = "open" | "acknowledged" | "resolved";
export type ObservationType =
  | "contradiction"
  | "duplication"
  | "missing"
  | "deprecated"
  | "pattern"
  | "anomaly"
  | "validation"
  | "error";

export type ObservationRow = {
  id: RecordId<"observation">;
  text: string;
  severity: ObservationSeverity;
  status: ObservationStatus;
  observation_type?: ObservationType;
  source_agent: string;
  reasoning?: string;
  verified?: boolean;
  workspace: RecordId<"workspace">;
  created_at: string;
};

export type IntentRow = {
  id: RecordId<"intent">;
  goal: string;
  reasoning: string;
  status: string;
  llm_reasoning?: string;
  evaluation?: {
    decision: string;
    risk_score: number;
    reason: string;
    evaluated_at: string;
    policy_only: boolean;
  };
  workspace: RecordId<"workspace">;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

import { setupAcceptanceSuite } from "../acceptance-test-kit";

export function setupReasoningSuite(
  suiteName: string,
): () => import("../acceptance-test-kit").AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Workspace Setup Helper
// ---------------------------------------------------------------------------

/**
 * Creates a test workspace and identity for reasoning tests.
 */
export async function setupReasoningWorkspace(
  baseUrl: string,
  surreal: Surreal,
  suffix: string,
): Promise<{
  user: TestUser;
  workspaceId: string;
  identityId: string;
}> {
  const { createTestUser, createTestWorkspace } = await import(
    "../coding-agent-orchestrator/orchestrator-test-kit"
  );

  const user = await createTestUser(baseUrl, suffix);
  const workspace = await createTestWorkspace(baseUrl, user);

  const identityId = `id-${crypto.randomUUID()}`;
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: `Reasoning Test Agent ${suffix}`,
      type: "agent",
      identity_status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return { user, workspaceId: workspace.workspaceId, identityId };
}

// ---------------------------------------------------------------------------
// Observation Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an observation with optional LLM reasoning attached.
 * Used to test that reasoning text persists alongside the observation.
 */
export async function createObservationWithReasoning(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    text: string;
    severity: ObservationSeverity;
    sourceAgent: string;
    reasoning?: string;
    observationType?: ObservationType;
    verified?: boolean;
  },
): Promise<{ observationId: string }> {
  const observationId = `obs-${crypto.randomUUID()}`;
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const content: Record<string, unknown> = {
    text: opts.text,
    severity: opts.severity,
    status: "open",
    source_agent: opts.sourceAgent,
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
  };

  if (opts.reasoning !== undefined) {
    content.reasoning = opts.reasoning;
  }
  if (opts.observationType !== undefined) {
    content.observation_type = opts.observationType;
  }
  if (opts.verified !== undefined) {
    content.verified = opts.verified;
  }

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content,
  });

  return { observationId };
}

/**
 * Creates an observation without any reasoning (deterministic path).
 */
export async function createDeterministicObservation(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    text: string;
    severity: ObservationSeverity;
    sourceAgent: string;
    observationType?: ObservationType;
  },
): Promise<{ observationId: string }> {
  return createObservationWithReasoning(surreal, workspaceId, {
    ...opts,
    reasoning: undefined,
  });
}

/**
 * Reads the full observation record from the database.
 */
export async function getObservationRecord(
  surreal: Surreal,
  observationId: string,
): Promise<ObservationRow> {
  const record = new RecordId("observation", observationId);
  const rows = (await surreal.query(`SELECT * FROM $obs;`, {
    obs: record,
  })) as Array<Array<ObservationRow>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error(`Observation ${observationId} not found`);
  }
  return result;
}

/**
 * Queries observations in a workspace that have reasoning attached.
 */
export async function listObservationsWithReasoning(
  surreal: Surreal,
  workspaceId: string,
  opts?: { limit?: number; since?: Date },
): Promise<ObservationRow[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const limit = opts?.limit ?? 50;

  if (opts?.since) {
    const rows = (await surreal.query(
      `SELECT * FROM observation
       WHERE workspace = $ws
         AND reasoning IS NOT NONE
         AND created_at >= $since
       ORDER BY created_at DESC
       LIMIT $limit;`,
      { ws: workspaceRecord, since: opts.since, limit },
    )) as Array<ObservationRow[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM observation
     WHERE workspace = $ws
       AND reasoning IS NOT NONE
     ORDER BY created_at DESC
     LIMIT $limit;`,
    { ws: workspaceRecord, limit },
  )) as Array<ObservationRow[]>;
  return rows[0] ?? [];
}

/**
 * Queries observations in a workspace that have no reasoning (deterministic).
 */
export async function listObservationsWithoutReasoning(
  surreal: Surreal,
  workspaceId: string,
  opts?: { limit?: number },
): Promise<ObservationRow[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const limit = opts?.limit ?? 50;

  const rows = (await surreal.query(
    `SELECT * FROM observation
     WHERE workspace = $ws
       AND reasoning IS NONE
     ORDER BY created_at DESC
     LIMIT $limit;`,
    { ws: workspaceRecord, limit },
  )) as Array<ObservationRow[]>;
  return rows[0] ?? [];
}

// ---------------------------------------------------------------------------
// Intent Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a draft intent with a trace record.
 */
export async function createDraftIntent(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: {
    goal: string;
    reasoning: string;
    priority?: number;
    action_spec: { provider: string; action: string; params?: Record<string, unknown> };
  },
): Promise<{ intentId: string }> {
  const intentId = `intent-${crypto.randomUUID()}`;
  const intentRecord = new RecordId("intent", intentId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const requesterRecord = new RecordId("identity", requesterId);
  const traceId = `trace-${intentId}`;
  const traceRecord = new RecordId("trace", traceId);

  await surreal.query(`CREATE $trace CONTENT $content;`, {
    trace: traceRecord,
    content: {
      type: "intent_submission",
      actor: requesterRecord,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  await surreal.query(`CREATE $intent CONTENT $content;`, {
    intent: intentRecord,
    content: {
      goal: opts.goal,
      reasoning: opts.reasoning,
      status: "draft",
      priority: opts.priority ?? 50,
      action_spec: opts.action_spec,
      trace_id: traceRecord,
      requester: requesterRecord,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return { intentId };
}

/**
 * Simulates an LLM evaluation completing and persisting llm_reasoning on the intent.
 * This mimics what the authorizer does after the LLM evaluator returns.
 */
export async function simulateEvaluationWithReasoning(
  surreal: Surreal,
  intentId: string,
  opts: {
    decision: "APPROVE" | "REJECT";
    risk_score: number;
    reason: string;
    llm_reasoning: string;
    resultStatus: string;
    policy_only?: boolean;
  },
): Promise<void> {
  const intentRecord = new RecordId("intent", intentId);

  const updates: Record<string, unknown> = {
    status: opts.resultStatus,
    evaluation: {
      decision: opts.decision,
      risk_score: opts.risk_score,
      reason: opts.reason,
      evaluated_at: new Date(),
      policy_only: opts.policy_only ?? false,
    },
    llm_reasoning: opts.llm_reasoning,
    updated_at: new Date(),
  };

  if (opts.resultStatus === "pending_veto") {
    updates.veto_expires_at = new Date(Date.now() + 5 * 60 * 1000);
  }

  await surreal.query(`UPDATE $intent MERGE $updates;`, {
    intent: intentRecord,
    updates,
  });
}

/**
 * Simulates a policy-only evaluation (no LLM reasoning).
 */
export async function simulatePolicyOnlyEvaluation(
  surreal: Surreal,
  intentId: string,
  opts: {
    decision: "APPROVE" | "REJECT";
    risk_score: number;
    reason: string;
    resultStatus: string;
  },
): Promise<void> {
  const intentRecord = new RecordId("intent", intentId);

  const updates: Record<string, unknown> = {
    status: opts.resultStatus,
    evaluation: {
      decision: opts.decision,
      risk_score: opts.risk_score,
      reason: opts.reason,
      evaluated_at: new Date(),
      policy_only: true,
    },
    updated_at: new Date(),
  };

  await surreal.query(`UPDATE $intent MERGE $updates;`, {
    intent: intentRecord,
    updates,
  });
}

/**
 * Reads the full intent record from the database.
 */
export async function getIntentRecord(
  surreal: Surreal,
  intentId: string,
): Promise<IntentRow> {
  const record = new RecordId("intent", intentId);
  const rows = (await surreal.query(`SELECT * FROM $intent;`, {
    intent: record,
  })) as Array<Array<IntentRow>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error(`Intent ${intentId} not found`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// API Helpers
// ---------------------------------------------------------------------------

/**
 * Fetches observations from the workspace API endpoint.
 */
export async function fetchObservationsApi(
  baseUrl: string,
  workspaceId: string,
  user: TestUser,
  opts?: { includeReasoning?: boolean },
): Promise<Response> {
  const params = new URLSearchParams();
  if (opts?.includeReasoning) {
    params.set("include_reasoning", "true");
  }
  const queryString = params.toString();
  const url = `${baseUrl}/api/workspaces/${workspaceId}/observer/observations${queryString ? `?${queryString}` : ""}`;

  return fetchRaw(url, {
    method: "GET",
    headers: { ...user.headers },
  });
}
