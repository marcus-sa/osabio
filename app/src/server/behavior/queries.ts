/**
 * Behavior CRUD Queries
 *
 * Driven port implementations for behavior record persistence.
 * All queries use RecordId objects per project convention.
 * Behavior records are append-only -- no UPDATE queries.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { IntentEvaluationContext } from "../policy/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BehaviorInput = {
  metricType: string;
  score: number;
  sourceTelemetry: Record<string, unknown>;
  workspaceId: string;
  sessionId?: string;
};

export type BehaviorRow = {
  id: RecordId<"behavior">;
  metric_type: string;
  score: number;
  source_telemetry: Record<string, unknown>;
  workspace: RecordId<"workspace">;
  session?: RecordId<"agent_session">;
  created_at: string;
};

export type ExhibitsEdgeRow = {
  id: RecordId<"exhibits">;
  in: RecordId<"identity">;
  out: RecordId<"behavior">;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Create Behavior Record (append-only)
// ---------------------------------------------------------------------------

/**
 * Creates a behavior record and the exhibits edge linking identity to behavior.
 * Append-only: never updates existing records.
 */
export async function createBehavior(
  surreal: Surreal,
  identityId: string,
  input: BehaviorInput,
): Promise<{ behaviorId: string }> {
  const behaviorId = `beh-${crypto.randomUUID()}`;
  const behaviorRecord = new RecordId("behavior", behaviorId);
  const workspaceRecord = new RecordId("workspace", input.workspaceId);
  const identityRecord = new RecordId("identity", identityId);

  const content: Record<string, unknown> = {
    metric_type: input.metricType,
    score: input.score,
    source_telemetry: input.sourceTelemetry,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  if (input.sessionId) {
    content.session = new RecordId("agent_session", input.sessionId);
  }

  await surreal.query(`CREATE $behavior CONTENT $content;`, {
    behavior: behaviorRecord,
    content,
  });

  // Create exhibits edge: identity ->exhibits-> behavior
  await surreal.query(
    `RELATE $identity->exhibits->$behavior SET created_at = time::now();`,
    { identity: identityRecord, behavior: behaviorRecord },
  );

  return { behaviorId };
}

// ---------------------------------------------------------------------------
// Query Behavior Records
// ---------------------------------------------------------------------------

/**
 * Lists behavior records for an identity, optionally filtered by metric type.
 * Returns records ordered by created_at DESC (most recent first).
 */
export async function listBehaviors(
  surreal: Surreal,
  identityId: string,
  metricType?: string,
): Promise<BehaviorRow[]> {
  const identityRecord = new RecordId("identity", identityId);

  // Traverse exhibits edges from identity to behavior
  const edgeRows = (await surreal.query(
    `SELECT ->exhibits->behavior AS behaviors FROM $identity;`,
    { identity: identityRecord },
  )) as Array<Array<{ behaviors: RecordId[] }>>;

  const behaviorIds = edgeRows[0]?.[0]?.behaviors ?? [];
  if (behaviorIds.length === 0) return [];

  if (metricType) {
    const rows = (await surreal.query(
      `SELECT * FROM behavior WHERE id IN $ids AND metric_type = $mt ORDER BY created_at DESC;`,
      { ids: behaviorIds, mt: metricType },
    )) as Array<BehaviorRow[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM behavior WHERE id IN $ids ORDER BY created_at DESC;`,
    { ids: behaviorIds },
  )) as Array<BehaviorRow[]>;
  return rows[0] ?? [];
}

/**
 * Gets the latest behavior score for an identity and metric type.
 */
export async function getLatestScore(
  surreal: Surreal,
  identityId: string,
  metricType: string,
): Promise<number | undefined> {
  const records = await listBehaviors(surreal, identityId, metricType);
  return records[0]?.score;
}

/**
 * Gets the latest score per unique metric_type for an identity.
 * Returns a map of metric_type -> score, using the most recent record per metric.
 * Used for context enrichment before policy gate evaluation.
 */
export async function getLatestBehaviorScores(
  surreal: Surreal,
  identityId: string,
): Promise<Record<string, number>> {
  const allRecords = await listBehaviors(surreal, identityId);

  // Records are already sorted by created_at DESC from listBehaviors.
  // Take the first (most recent) score per metric_type.
  const scores: Record<string, number> = {};
  for (const record of allRecords) {
    if (!(record.metric_type in scores)) {
      scores[record.metric_type] = record.score;
    }
  }

  return scores;
}

/**
 * Enriches an IntentEvaluationContext with behavior scores for an identity.
 * Context enrichment happens before policy gate evaluation, not inside it.
 * Returns a new context object (immutable -- does not mutate the input).
 */
export async function enrichBehaviorScores(
  surreal: Surreal,
  identityId: string,
  context: IntentEvaluationContext,
): Promise<IntentEvaluationContext> {
  const scores = await getLatestBehaviorScores(surreal, identityId);
  return { ...context, behavior_scores: scores };
}

/**
 * Lists behavior records for a workspace, optionally filtered by metric type.
 */
export async function listWorkspaceBehaviors(
  surreal: Surreal,
  workspaceId: string,
  metricType?: string,
  limit = 50,
): Promise<BehaviorRow[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  if (metricType) {
    const rows = (await surreal.query(
      `SELECT * FROM behavior WHERE workspace = $ws AND metric_type = $mt ORDER BY created_at DESC LIMIT $limit;`,
      { ws: workspaceRecord, mt: metricType, limit },
    )) as Array<BehaviorRow[]>;
    return rows[0] ?? [];
  }

  const rows = (await surreal.query(
    `SELECT * FROM behavior WHERE workspace = $ws ORDER BY created_at DESC LIMIT $limit;`,
    { ws: workspaceRecord, limit },
  )) as Array<BehaviorRow[]>;
  return rows[0] ?? [];
}
