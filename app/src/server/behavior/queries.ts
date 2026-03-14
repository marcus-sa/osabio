/**
 * Behavior CRUD Queries
 *
 * Driven port implementations for behavior record persistence.
 * All queries use RecordId objects per project convention.
 * Behavior records are append-only -- no UPDATE queries.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { IntentEvaluationContext } from "../policy/types";
import type {
  BehaviorDefinitionRecord,
  CreateBehaviorDefinitionInput,
  UpdateBehaviorDefinitionInput,
  DefinitionStatus,
} from "./definition-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BehaviorInput = {
  metricType: string;
  score: number;
  sourceTelemetry: Record<string, unknown>;
  workspaceId: string;
  sessionId?: string;
  definitionId?: string;
  definitionVersion?: number;
};

export type BehaviorRow = {
  id: RecordId<"behavior">;
  metric_type: string;
  score: number;
  source_telemetry: Record<string, unknown>;
  definition: RecordId<"behavior_definition">;
  definition_version: number;
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

  if (input.definitionId) {
    content.definition = new RecordId("behavior_definition", input.definitionId);
  }

  if (input.definitionVersion !== undefined) {
    content.definition_version = input.definitionVersion;
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
  workspaceId?: string,
  limit = 50,
): Promise<BehaviorRow[]> {
  const identityRecord = new RecordId("identity", identityId);

  // Traverse exhibits edges from identity to behavior
  const edgeRows = (await surreal.query(
    `SELECT ->exhibits->behavior AS behaviors FROM $identity;`,
    { identity: identityRecord },
  )) as Array<Array<{ behaviors: RecordId[] }>>;

  const behaviorIds = edgeRows[0]?.[0]?.behaviors ?? [];
  if (behaviorIds.length === 0) return [];

  const conditions = ["id IN $ids"];
  const params: Record<string, unknown> = { ids: behaviorIds, limit };

  if (metricType) {
    conditions.push("metric_type = $mt");
    params.mt = metricType;
  }
  if (workspaceId) {
    conditions.push("workspace = $ws");
    params.ws = new RecordId("workspace", workspaceId);
  }

  const query = `SELECT * FROM behavior WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $limit;`;
  const rows = (await surreal.query(query, params)) as Array<BehaviorRow[]>;
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

  const query = metricType
    ? `SELECT * FROM behavior WHERE workspace = $ws AND metric_type = $mt ORDER BY created_at DESC LIMIT $limit;`
    : `SELECT * FROM behavior WHERE workspace = $ws ORDER BY created_at DESC LIMIT $limit;`;
  const rows = (await surreal.query(query, { ws: workspaceRecord, mt: metricType, limit })) as Array<BehaviorRow[]>;
  return rows[0] ?? [];
}

// ---------------------------------------------------------------------------
// Status Transition Validation (pure function)
// ---------------------------------------------------------------------------

const VALID_STATUS_TRANSITIONS: Record<DefinitionStatus, DefinitionStatus[]> = {
  draft: ["active", "archived"],
  active: ["archived"],
  archived: [],
};

/**
 * Validates a status transition for a behavior definition.
 * Valid transitions: draft->active, draft->archived, active->archived.
 * Returns an error message if invalid, undefined if valid.
 */
export function validateStatusTransition(
  currentStatus: DefinitionStatus,
  newStatus: DefinitionStatus,
): string | undefined {
  if (currentStatus === newStatus) return undefined;
  const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    return `Invalid status transition: ${currentStatus} -> ${newStatus}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Behavior Definition CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a behavior definition in the database.
 * Definitions start in "draft" status at version 1 with "warn_only" enforcement.
 */
export async function createBehaviorDefinition(
  surreal: Surreal,
  workspaceId: string,
  createdById: string,
  input: CreateBehaviorDefinitionInput,
): Promise<{ definitionId: string }> {
  const definitionId = `def-${crypto.randomUUID()}`;
  const definitionRecord = new RecordId("behavior_definition", definitionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const createdByRecord = new RecordId("identity", createdById);

  const content: Record<string, unknown> = {
    title: input.title,
    goal: input.goal,
    scoring_logic: input.scoring_logic,
    telemetry_types: input.telemetry_types,
    status: "draft",
    version: 1,
    enforcement_mode: "warn_only",
    workspace: workspaceRecord,
    created_by: createdByRecord,
    created_at: new Date(),
  };

  if (input.category !== undefined) content.category = input.category;

  await surreal.query(`CREATE $definition CONTENT $content;`, {
    definition: definitionRecord,
    content,
  });

  return { definitionId };
}

/**
 * Retrieves a behavior definition by ID.
 * Returns undefined if not found.
 */
export async function getBehaviorDefinition(
  surreal: Surreal,
  definitionId: string,
): Promise<BehaviorDefinitionRecord | undefined> {
  const definitionRecord = new RecordId("behavior_definition", definitionId);
  const rows = (await surreal.query(
    `SELECT * FROM $definition;`,
    { definition: definitionRecord },
  )) as Array<BehaviorDefinitionRecord[]>;
  return rows[0]?.[0];
}

/**
 * Lists behavior definitions for a workspace, optionally filtered by status.
 * Returns records ordered by created_at DESC.
 */
export async function listBehaviorDefinitions(
  surreal: Surreal,
  workspaceId: string,
  status?: DefinitionStatus,
): Promise<BehaviorDefinitionRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const query = status
    ? `SELECT * FROM behavior_definition WHERE workspace = $ws AND status = $status ORDER BY created_at DESC;`
    : `SELECT * FROM behavior_definition WHERE workspace = $ws ORDER BY created_at DESC;`;
  const rows = (await surreal.query(query, { ws: workspaceRecord, status })) as Array<BehaviorDefinitionRecord[]>;
  return rows[0] ?? [];
}

/**
 * Updates a behavior definition.
 * - Validates status transitions (draft->active, active->archived, draft->archived only).
 * - Increments version when updating an active definition.
 * - Draft edits do not increment version.
 * Returns the updated record or throws on invalid transition.
 */
export async function updateBehaviorDefinition(
  surreal: Surreal,
  definitionId: string,
  input: UpdateBehaviorDefinitionInput,
): Promise<BehaviorDefinitionRecord> {
  const existing = await getBehaviorDefinition(surreal, definitionId);
  if (!existing) {
    throw new Error(`Behavior definition not found: ${definitionId}`);
  }

  // Validate status transition if status is being changed
  if (input.status && input.status !== existing.status) {
    const error = validateStatusTransition(existing.status, input.status);
    if (error) throw new Error(error);
  }

  const definitionRecord = new RecordId("behavior_definition", definitionId);

  // Determine whether to increment version:
  // Only increment when the definition is active and content fields are being updated
  const isActive = existing.status === "active";
  const isContentUpdate = input.goal !== undefined
    || input.scoring_logic !== undefined
    || input.telemetry_types !== undefined
    || input.category !== undefined;
  const shouldIncrementVersion = isActive && isContentUpdate;

  const setClauses: string[] = ["updated_at = time::now()"];
  const params: Record<string, unknown> = { def: definitionRecord };

  if (input.goal !== undefined) {
    setClauses.push("goal = $goal");
    params.goal = input.goal;
  }
  if (input.scoring_logic !== undefined) {
    setClauses.push("scoring_logic = $scoring_logic");
    params.scoring_logic = input.scoring_logic;
  }
  if (input.telemetry_types !== undefined) {
    setClauses.push("telemetry_types = $telemetry_types");
    params.telemetry_types = input.telemetry_types;
  }
  if (input.category !== undefined) {
    setClauses.push("category = $category");
    params.category = input.category;
  }
  if (input.status !== undefined) {
    setClauses.push("status = $status");
    params.status = input.status;
  }
  if (input.enforcement_mode !== undefined) {
    setClauses.push("enforcement_mode = $enforcement_mode");
    params.enforcement_mode = input.enforcement_mode;
  }
  if (input.enforcement_threshold !== undefined) {
    setClauses.push("enforcement_threshold = $enforcement_threshold");
    params.enforcement_threshold = input.enforcement_threshold;
  }
  if (shouldIncrementVersion) {
    setClauses.push("version = version + 1");
  }

  const query = `UPDATE $def SET ${setClauses.join(", ")};`;
  const rows = (await surreal.query(query, params)) as Array<BehaviorDefinitionRecord[]>;
  return rows[0][0];
}
