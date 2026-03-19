/**
 * Shared Test Fixtures — Canonical entity creation helpers
 *
 * Single source of truth for creating test entities in SurrealDB.
 * Domain-specific test kits compose these helpers rather than reimplementing them.
 *
 * Types here mirror the SurrealDB schema with all required fields enforced
 * at compile time, so schema changes only need updating in one place.
 */
import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Shared Types — Schema-aligned, required fields enforced
// ---------------------------------------------------------------------------

export type ActionSpec = {
  provider: string;
  action: string;
  params: Record<string, unknown>;
};

export type EvaluationResult = {
  decision: "APPROVE" | "REJECT";
  risk_score: number;
  reason: string;
  evaluated_at: Date;
  policy_only: boolean;
};

// ---------------------------------------------------------------------------
// Workspace + Identity (direct DB creation, no HTTP)
// ---------------------------------------------------------------------------

export type DirectWorkspaceResult = {
  workspaceId: string;
  workspaceRecord: RecordId<"workspace">;
  identityId: string;
  identityRecord: RecordId<"identity">;
};

/**
 * Creates a workspace + identity + member_of edge directly in SurrealDB.
 * Use when tests need an isolated workspace without going through HTTP signup.
 */
export async function createWorkspaceDirectly(
  surreal: Surreal,
  suffix: string,
  opts?: {
    workspaceName?: string;
    identityName?: string;
    identityType?: "human" | "agent";
  },
): Promise<DirectWorkspaceResult> {
  const workspaceId = `ws-${crypto.randomUUID()}`;
  const identityId = `id-${crypto.randomUUID()}`;
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const identityRecord = new RecordId("identity", identityId);

  await surreal.query(
    `CREATE $workspace CONTENT $content;`,
    {
      workspace: workspaceRecord,
      content: {
        name: opts?.workspaceName ?? `Test Workspace ${suffix}`,
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: new Date(),
        created_at: new Date(),
      },
    },
  );

  await surreal.query(
    `CREATE $identity CONTENT $content;`,
    {
      identity: identityRecord,
      content: {
        name: opts?.identityName ?? `Test User ${suffix}`,
        type: opts?.identityType ?? "human",
        identity_status: "active",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    },
  );

  await surreal.query(
    `RELATE $identity->member_of->$workspace SET added_at = time::now();`,
    { identity: identityRecord, workspace: workspaceRecord },
  );

  return { workspaceId, workspaceRecord, identityId, identityRecord };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Creates an identity record + member_of edge.
 * Use when you already have a workspace and need an additional identity.
 */
export async function createIdentity(
  surreal: Surreal,
  workspaceId: string,
  name: string,
  type: "human" | "agent" = "agent",
): Promise<{ identityId: string; identityRecord: RecordId<"identity"> }> {
  const identityId = `id-${crypto.randomUUID()}`;
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `CREATE $identity CONTENT $content;`,
    {
      identity: identityRecord,
      content: {
        name,
        type,
        identity_status: "active",
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    },
  );

  await surreal.query(
    `RELATE $identity->member_of->$workspace SET added_at = time::now();`,
    { identity: identityRecord, workspace: workspaceRecord },
  );

  return { identityId, identityRecord };
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export type CreateIntentOpts = {
  goal: string;
  reasoning?: string;
  status?: string;
  priority?: number;
  actionSpec?: ActionSpec;
  embedding?: number[];
  evaluation?: EvaluationResult;
  budgetLimit?: { amount: number; currency: string };
  taskId?: string;
};

/**
 * Creates an intent + trace record directly in SurrealDB.
 * Canonical helper — all intent creation in tests should use this.
 */
export async function createIntentDirectly(
  surreal: Surreal,
  workspaceId: string,
  requesterId: string,
  opts: CreateIntentOpts,
): Promise<{ intentId: string; intentRecord: RecordId<"intent">; traceRecord: RecordId<"trace"> }> {
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

  const intentContent: Record<string, unknown> = {
    goal: opts.goal,
    reasoning: opts.reasoning ?? "Test intent",
    status: opts.status ?? "draft",
    priority: opts.priority ?? 50,
    action_spec: opts.actionSpec ?? { provider: "test", action: "test", params: {} },
    trace_id: traceRecord,
    requester: requesterRecord,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (opts.embedding !== undefined) intentContent.embedding = opts.embedding;
  if (opts.evaluation !== undefined) intentContent.evaluation = opts.evaluation;
  if (opts.budgetLimit !== undefined) intentContent.budget_limit = opts.budgetLimit;

  await surreal.query(`CREATE $intent CONTENT $content;`, {
    intent: intentRecord,
    content: intentContent,
  });

  if (opts.taskId) {
    const taskRecord = new RecordId("task", opts.taskId);
    await surreal.query(
      `RELATE $intent->triggered_by->$task SET created_at = time::now();`,
      { intent: intentRecord, task: taskRecord },
    );
  }

  return { intentId, intentRecord, traceRecord };
}

// ---------------------------------------------------------------------------
// Git Commit
// ---------------------------------------------------------------------------

export type CreateGitCommitOpts = {
  message?: string;
  repository?: string;
  authorName?: string;
  url?: string;
};

/**
 * Creates a git_commit record directly in SurrealDB.
 */
export async function createGitCommitDirectly(
  surreal: Surreal,
  workspaceId: string,
  sha: string,
  opts?: CreateGitCommitOpts,
): Promise<{ commitId: string; commitRecord: RecordId<"git_commit"> }> {
  const commitId = `commit-${crypto.randomUUID()}`;
  const commitRecord = new RecordId("git_commit", commitId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `CREATE $commit CONTENT $content;`,
    {
      commit: commitRecord,
      content: {
        sha,
        repository: opts?.repository ?? "org/repo",
        message: opts?.message ?? "chore: test commit",
        author_name: opts?.authorName ?? "test-agent",
        url: opts?.url,
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    },
  );

  return { commitId, commitRecord };
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type CreateDecisionOpts = {
  summary: string;
  rationale?: string;
  status?: string;
  embedding?: number[];
  created_at?: Date;
};

/**
 * Creates a decision record directly in SurrealDB.
 */
export async function createDecisionDirectly(
  surreal: Surreal,
  workspaceId: string,
  opts: CreateDecisionOpts,
): Promise<{ decisionId: string; decisionRecord: RecordId<"decision"> }> {
  const decisionId = `decision-${crypto.randomUUID()}`;
  const decisionRecord = new RecordId("decision", decisionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $dec CONTENT $content;`, {
    dec: decisionRecord,
    content: {
      summary: opts.summary,
      rationale: opts.rationale ?? "Test decision",
      status: opts.status ?? "confirmed",
      workspace: workspaceRecord,
      created_at: opts.created_at ?? new Date(),
      updated_at: new Date(),
      ...(opts.embedding ? { embedding: opts.embedding } : {}),
    },
  });

  return { decisionId, decisionRecord };
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export type ObservationSeverity = "info" | "warning" | "conflict";
export type ObservationStatus = "open" | "acknowledged" | "resolved";

export type CreateObservationOpts = {
  text: string;
  severity: ObservationSeverity;
  observationType?: string;
  sourceAgent: string;
  targetTable?: string;
  targetId?: string;
};

/**
 * Creates an observation record directly in SurrealDB.
 * Optionally links to a target entity via an observes edge.
 */
export async function createObservationDirectly(
  surreal: Surreal,
  workspaceId: string,
  opts: CreateObservationOpts,
): Promise<{ observationId: string; observationRecord: RecordId<"observation"> }> {
  const observationId = `obs-${crypto.randomUUID()}`;
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content: {
      text: opts.text,
      severity: opts.severity,
      status: "open" as const,
      observation_type: opts.observationType,
      source_agent: opts.sourceAgent,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  if (opts.targetTable && opts.targetId) {
    const targetRecord = new RecordId(opts.targetTable, opts.targetId);
    await surreal.query(
      `RELATE $obs->observes->$target SET added_at = time::now();`,
      { obs: observationRecord, target: targetRecord },
    );
  }

  return { observationId, observationRecord };
}

// ---------------------------------------------------------------------------
// Workspace Observations Query
// ---------------------------------------------------------------------------

/**
 * Queries all observations in a workspace, optionally filtered by source agent.
 */
export async function queryWorkspaceObservations(
  surreal: Surreal,
  workspaceId: string,
  sourceAgent?: string,
): Promise<Array<{
  id: RecordId;
  text: string;
  severity: string;
  status: string;
  source_agent: string;
  observation_type?: string;
  workspace: RecordId<"workspace">;
  created_at: string;
  updated_at?: string;
}>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  type ObsRow = {
    id: RecordId;
    text: string;
    severity: string;
    status: string;
    source_agent: string;
    observation_type?: string;
    workspace: RecordId<"workspace">;
    created_at: string;
    updated_at?: string;
  };

  if (sourceAgent) {
    const rows = (await surreal.query(
      `SELECT * FROM observation WHERE workspace = $ws AND source_agent = $agent ORDER BY created_at DESC;`,
      { ws: workspaceRecord, agent: sourceAgent },
    )) as Array<ObsRow[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM observation WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<ObsRow[]>;
  return rows[0] ?? [];
}
