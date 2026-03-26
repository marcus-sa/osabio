/**
 * Intent Evidence Acceptance Test Kit
 *
 * Extends intent-test-kit with evidence-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   MCP tools: create_intent (with evidence_refs)
 *   POST /api/intents/:id/evaluate  (SurrealQL EVENT target)
 *   Workspace settings (direct DB for enforcement mode)
 *   GET /api/workspaces/:ws/feed (governance feed)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  createDecisionDirectly,
  createTaskDirectly,
  createObservationDirectly,
  createIntentDirectly,
  createIdentity,
  type CreateDecisionOpts,
  type CreateTaskOpts,
  type CreateObservationOpts,
} from "../shared-fixtures";

// Re-export everything from intent-test-kit
export {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestProject,
  getTestUserBearerToken,
  fetchJson,
  fetchRaw,
  createDraftIntent,
  submitIntent,
  getIntentStatus,
  getIntentRecord,
  getIntentEvaluation,
  waitForIntentStatus,
  vetoIntent,
  listPendingIntents,
  createTestIdentity,
  wireIntentEvaluationEvent,
  simulateEvaluation,
  createIntentViaMcp,
  submitIntentViaMcp,
  getIntentStatusViaMcp,
  type IntentStatus,
  type IntentRecord,
  type EvaluationResult,
  type CreateIntentOptions,
  type BudgetLimit,
  type ActionSpec,
  type OrchestratorTestRuntime,
  type TestUser,
  type TestUserWithToken,
  type TestWorkspace,
  type TestTask,
  type TestProject,
} from "../intent-node/intent-test-kit";

// ---------------------------------------------------------------------------
// Evidence-Specific Types
// ---------------------------------------------------------------------------

export type EvidenceEnforcementMode = "bootstrap" | "soft" | "hard";

export type EvidenceVerification = {
  verified_count: number;
  failed_refs?: string[];
  verification_time_ms: number;
  warnings?: string[];
};

export type EvidenceEnforcementThreshold = {
  min_decisions: number;
  min_tasks: number;
};

// ---------------------------------------------------------------------------
// Evidence Entity Creation Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a confirmed decision to use as evidence.
 * Returns the record ID for use in evidence_refs.
 */
export async function createEvidenceDecision(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    summary: string;
    status?: string;
    created_at?: Date;
  },
): Promise<{ decisionId: string; decisionRecord: RecordId<"decision"> }> {
  return createDecisionDirectly(surreal, workspaceId, {
    summary: opts.summary,
    status: opts.status ?? "confirmed",
    created_at: opts.created_at,
  });
}

/**
 * Creates a completed task to use as evidence.
 * Returns the record ID for use in evidence_refs.
 */
export async function createEvidenceTask(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    title: string;
    status?: string;
  },
): Promise<{ taskId: string; taskRecord: RecordId<"task"> }> {
  return createTaskDirectly(surreal, workspaceId, {
    title: opts.title,
    status: opts.status ?? "completed",
  });
}

/**
 * Creates a verified observation to use as evidence.
 * Returns the record ID for use in evidence_refs.
 */
export async function createEvidenceObservation(
  surreal: Surreal,
  workspaceId: string,
  opts: {
    text: string;
    sourceAgent: string;
    severity?: "info" | "warning" | "conflict";
  },
): Promise<{ observationId: string; observationRecord: RecordId<"observation"> }> {
  return createObservationDirectly(surreal, workspaceId, {
    text: opts.text,
    sourceAgent: opts.sourceAgent,
    severity: opts.severity ?? "info",
  });
}

// ---------------------------------------------------------------------------
// Intent with Evidence Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a draft intent with evidence references.
 * The evidence_refs are stored as an array of RecordId on the intent.
 */
export async function createIntentWithEvidence(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: {
    goal: string;
    reasoning: string;
    priority?: number;
    evidenceRefs: RecordId[];
    actionSpec?: { provider: string; action: string; params: Record<string, unknown> };
  },
): Promise<{ intentId: string; intentRecord: RecordId<"intent"> }> {
  const result = await createIntentDirectly(surreal, workspaceId, requesterId, {
    goal: opts.goal,
    reasoning: opts.reasoning,
    priority: opts.priority,
    actionSpec: opts.actionSpec ?? { provider: "test", action: "test", params: {} },
  });

  // Add evidence_refs to the intent record
  await surreal.query(
    `UPDATE $intent SET evidence_refs = $refs;`,
    {
      intent: result.intentRecord,
      refs: opts.evidenceRefs,
    },
  );

  return { intentId: result.intentId, intentRecord: result.intentRecord };
}

/**
 * Creates a draft intent without evidence references.
 * Used for scenarios testing missing evidence behavior.
 */
export async function createIntentWithoutEvidence(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: {
    goal: string;
    reasoning: string;
    priority?: number;
    actionSpec?: { provider: string; action: string; params: Record<string, unknown> };
  },
): Promise<{ intentId: string; intentRecord: RecordId<"intent"> }> {
  const result = await createIntentDirectly(surreal, workspaceId, requesterId, {
    goal: opts.goal,
    reasoning: opts.reasoning,
    priority: opts.priority,
    actionSpec: opts.actionSpec ?? { provider: "test", action: "test", params: {} },
  });

  return { intentId: result.intentId, intentRecord: result.intentRecord };
}

// ---------------------------------------------------------------------------
// Workspace Enforcement Configuration
// ---------------------------------------------------------------------------

/**
 * Sets the evidence enforcement mode on a workspace.
 * Modes: "bootstrap" (no requirements), "soft" (penalty), "hard" (reject).
 */
export async function setWorkspaceEnforcementMode(
  surreal: Surreal,
  workspaceId: string,
  mode: EvidenceEnforcementMode,
): Promise<void> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  await surreal.query(
    `UPDATE $ws SET evidence_enforcement = $mode;`,
    { ws: workspaceRecord, mode },
  );
}

/**
 * Sets the evidence enforcement maturity threshold on a workspace.
 * When the workspace reaches this threshold, enforcement auto-transitions.
 */
export async function setEnforcementThreshold(
  surreal: Surreal,
  workspaceId: string,
  threshold: EvidenceEnforcementThreshold,
): Promise<void> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  await surreal.query(
    `UPDATE $ws SET evidence_enforcement_threshold = $threshold;`,
    { ws: workspaceRecord, threshold },
  );
}

/**
 * Sets the minimum evidence age (in minutes) on a workspace.
 */
export async function setMinimumEvidenceAge(
  surreal: Surreal,
  workspaceId: string,
  minutes: number,
): Promise<void> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  await surreal.query(
    `UPDATE $ws SET min_evidence_age_minutes = $minutes;`,
    { ws: workspaceRecord, minutes },
  );
}

// ---------------------------------------------------------------------------
// Evidence Verification Queries
// ---------------------------------------------------------------------------

/**
 * Reads the evidence verification result from an intent record.
 */
export async function getEvidenceVerification(
  surreal: Surreal,
  intentId: string,
): Promise<EvidenceVerification | undefined> {
  const intentRecord = new RecordId("intent", intentId);
  const rows = (await surreal.query(
    `SELECT evidence_verification FROM $intent;`,
    { intent: intentRecord },
  )) as Array<Array<{ evidence_verification?: EvidenceVerification }>>;
  return rows[0]?.[0]?.evidence_verification;
}

/**
 * Reads the evidence_refs from an intent record.
 */
export async function getEvidenceRefs(
  surreal: Surreal,
  intentId: string,
): Promise<RecordId[] | undefined> {
  const intentRecord = new RecordId("intent", intentId);
  const rows = (await surreal.query(
    `SELECT evidence_refs FROM $intent;`,
    { intent: intentRecord },
  )) as Array<Array<{ evidence_refs?: RecordId[] }>>;
  return rows[0]?.[0]?.evidence_refs;
}

/**
 * Reads the workspace enforcement mode.
 */
export async function getWorkspaceEnforcementMode(
  surreal: Surreal,
  workspaceId: string,
): Promise<EvidenceEnforcementMode | undefined> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT evidence_enforcement FROM $ws;`,
    { ws: workspaceRecord },
  )) as Array<Array<{ evidence_enforcement?: EvidenceEnforcementMode }>>;
  return rows[0]?.[0]?.evidence_enforcement;
}

/**
 * Counts confirmed decisions in a workspace.
 */
export async function countConfirmedDecisions(
  surreal: Surreal,
  workspaceId: string,
): Promise<number> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT count() AS total FROM decision WHERE workspace = $ws AND status = "confirmed" GROUP ALL;`,
    { ws: workspaceRecord },
  )) as Array<Array<{ total: number }>>;
  return rows[0]?.[0]?.total ?? 0;
}

/**
 * Counts completed tasks in a workspace.
 */
export async function countCompletedTasks(
  surreal: Surreal,
  workspaceId: string,
): Promise<number> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT count() AS total FROM task WHERE workspace = $ws AND status = "completed" GROUP ALL;`,
    { ws: workspaceRecord },
  )) as Array<Array<{ total: number }>>;
  return rows[0]?.[0]?.total ?? 0;
}

/**
 * Creates a decision in a different workspace (for cross-workspace scope tests).
 */
export async function createDecisionInOtherWorkspace(
  surreal: Surreal,
  opts: {
    summary: string;
    otherWorkspaceName?: string;
  },
): Promise<{
  decisionId: string;
  decisionRecord: RecordId<"decision">;
  otherWorkspaceId: string;
}> {
  // Create the "other" workspace
  const otherWsId = `ws-other-${crypto.randomUUID()}`;
  const otherWsRecord = new RecordId("workspace", otherWsId);
  await surreal.query(`CREATE $ws CONTENT $content;`, {
    ws: otherWsRecord,
    content: {
      name: opts.otherWorkspaceName ?? "Other Organization",
      status: "active",
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
      created_at: new Date(),
    },
  });

  const { decisionId, decisionRecord } = await createDecisionDirectly(surreal, otherWsId, {
    summary: opts.summary,
  });

  return { decisionId, decisionRecord, otherWorkspaceId: otherWsId };
}

/**
 * Creates multiple identities to test authorship independence.
 * Returns an array of identity IDs.
 */
export async function createMultipleAgentIdentities(
  surreal: Surreal,
  workspaceId: string,
  agents: Array<{ name: string; type?: "human" | "agent" }>,
): Promise<Array<{ name: string; identityId: string; identityRecord: RecordId<"identity"> }>> {
  const results: Array<{ name: string; identityId: string; identityRecord: RecordId<"identity"> }> = [];
  for (const agent of agents) {
    const { identityId, identityRecord } = await createIdentity(
      surreal,
      workspaceId,
      agent.name,
      agent.type ?? "agent",
    );
    results.push({ name: agent.name, identityId, identityRecord });
  }
  return results;
}
