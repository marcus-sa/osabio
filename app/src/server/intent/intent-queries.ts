import { RecordId, type Surreal } from "surrealdb";
import type { IntentRecord, IntentStatus, ActionSpec, BudgetLimit, EvaluationResult } from "./types";
import type { BrainAction } from "../oauth/types";
import { transitionStatus } from "./status-machine";

// --- Query Result Types ---

type CreateIntentParams = {
  goal: string;
  reasoning: string;
  priority: number;
  action_spec: ActionSpec;
  budget_limit?: BudgetLimit;
  trace_id: RecordId<"trace", string>;
  requester: RecordId<"identity", string>;
  workspace: RecordId<"workspace", string>;
  expiry?: Date;
  authorization_details?: BrainAction[];
  dpop_jwk_thumbprint?: string;
};

type StatusUpdateFields = {
  evaluation?: EvaluationResult & { evaluated_at: Date; policy_only: boolean };
  veto_expires_at?: Date;
  veto_reason?: string;
  error_reason?: string;
};

type ListFilters = {
  status?: IntentStatus;
  limit?: number;
};

// --- Trace Creation ---

export type TraceType = "tool_call" | "message" | "subagent_spawn" | "intent_submission" | "bridge_exchange";

export type CreateTraceParams = {
  type: TraceType;
  actor: RecordId<"identity", string>;
  workspace: RecordId<"workspace", string>;
  session?: RecordId<"agent_session", string>;
  parent_trace?: RecordId<"trace", string>;
  tool_name?: string;
  input?: Record<string, unknown>;
};

export async function createTrace(
  surreal: Surreal,
  params: CreateTraceParams,
): Promise<RecordId<"trace", string>> {
  const id = crypto.randomUUID();
  const record = new RecordId("trace", id);

  const content: Record<string, unknown> = {
    type: params.type,
    actor: params.actor,
    workspace: params.workspace,
    created_at: new Date(),
  };

  if (params.session) content.session = params.session;
  if (params.parent_trace) content.parent_trace = params.parent_trace;
  if (params.tool_name) content.tool_name = params.tool_name;
  if (params.input) content.input = params.input;

  await surreal.query("CREATE $record CONTENT $content;", { record, content });

  return record;
}

// --- Query Functions ---

export async function createIntent(
  surreal: Surreal,
  params: CreateIntentParams,
): Promise<RecordId<"intent", string>> {
  const now = new Date();
  const id = crypto.randomUUID();
  const record = new RecordId("intent", id);

  const content: Record<string, unknown> = {
    goal: params.goal,
    reasoning: params.reasoning,
    status: "draft" satisfies IntentStatus,
    priority: params.priority,
    action_spec: params.action_spec,
    trace_id: params.trace_id,
    requester: params.requester,
    workspace: params.workspace,
    created_at: now,
  };

  if (params.budget_limit) {
    content.budget_limit = params.budget_limit;
  }
  if (params.expiry) {
    content.expiry = params.expiry;
  }
  if (params.authorization_details) {
    content.authorization_details = params.authorization_details;
  }
  if (params.dpop_jwk_thumbprint) {
    content.dpop_jwk_thumbprint = params.dpop_jwk_thumbprint;
  }

  await surreal.query(
    "CREATE $record CONTENT $content;",
    { record, content },
  );

  return record;
}

export async function getIntentById(
  surreal: Surreal,
  intentId: string,
): Promise<IntentRecord | undefined> {
  const record = new RecordId("intent", intentId);
  const [rows] = await surreal.query<[IntentRecord[]]>(
    "SELECT * FROM $record;",
    { record },
  );
  return rows[0];
}

export async function updateIntentStatus(
  surreal: Surreal,
  intentId: string,
  newStatus: IntentStatus,
  updates?: StatusUpdateFields,
): Promise<{ ok: true; record: IntentRecord } | { ok: false; error: string }> {
  const existing = await getIntentById(surreal, intentId);
  if (!existing) {
    return { ok: false, error: `Intent ${intentId} not found` };
  }

  const transition = transitionStatus(existing.status, newStatus);
  if (!transition.ok) {
    return { ok: false, error: transition.error };
  }

  const record = new RecordId("intent", intentId);
  const now = new Date();

  const setFields: Record<string, unknown> = {
    status: newStatus,
    updated_at: now,
  };

  if (updates?.evaluation) {
    setFields.evaluation = updates.evaluation;
  }
  if (updates?.veto_expires_at) {
    setFields.veto_expires_at = updates.veto_expires_at;
  }
  if (updates?.veto_reason) {
    setFields.veto_reason = updates.veto_reason;
  }
  if (updates?.error_reason) {
    setFields.error_reason = updates.error_reason;
  }

  const [rows] = await surreal.query<[IntentRecord[]]>(
    "UPDATE $record MERGE $fields RETURN AFTER;",
    {
      record,
      fields: setFields,
    },
  );

  return { ok: true, record: rows[0] };
}

export async function recordTokenIssuance(
  surreal: Surreal,
  intentId: string,
  tokenIssuedAt: Date,
  tokenExpiresAt: Date,
): Promise<void> {
  const record = new RecordId("intent", intentId);
  await surreal.query(
    "UPDATE $record MERGE $fields;",
    {
      record,
      fields: {
        token_issued_at: tokenIssuedAt,
        token_expires_at: tokenExpiresAt,
      },
    },
  );
}

export async function listPendingIntents(
  surreal: Surreal,
  workspaceId: string,
): Promise<IntentRecord[]> {
  const workspace = new RecordId("workspace", workspaceId);
  const [rows] = await surreal.query<[IntentRecord[]]>(
    `SELECT * FROM intent
     WHERE workspace = $workspace
       AND status = "pending_veto"
     ORDER BY created_at DESC;`,
    { workspace },
  );
  return rows;
}

export async function queryExpiredVetoIntents(
  surreal: Surreal,
): Promise<IntentRecord[]> {
  const [rows] = await surreal.query<[IntentRecord[]]>(
    `SELECT * FROM intent
     WHERE status = "pending_veto"
       AND veto_expires_at < time::now();`,
  );
  return rows;
}

export async function listIntentsByWorkspace(
  surreal: Surreal,
  workspaceId: string,
  filters?: ListFilters,
): Promise<IntentRecord[]> {
  const workspace = new RecordId("workspace", workspaceId);
  const limit = filters?.limit ?? 50;

  if (filters?.status) {
    const [rows] = await surreal.query<[IntentRecord[]]>(
      `SELECT * FROM intent
       WHERE workspace = $workspace
         AND status = $status
       ORDER BY created_at DESC
       LIMIT $limit;`,
      { workspace, status: filters.status, limit },
    );
    return rows;
  }

  const [rows] = await surreal.query<[IntentRecord[]]>(
    `SELECT * FROM intent
     WHERE workspace = $workspace
     ORDER BY created_at DESC
     LIMIT $limit;`,
    { workspace, limit },
  );
  return rows;
}
