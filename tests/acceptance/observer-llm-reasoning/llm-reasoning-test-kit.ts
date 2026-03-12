/**
 * Observer LLM Reasoning Acceptance Test Kit
 *
 * Extends the observer-test-kit with LLM reasoning-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Key difference from observer-agent tests: these tests exercise real LLM calls
 * via the configured OBSERVER_MODEL. No mocking of LLM responses.
 *
 * Driving ports:
 *   POST /api/observe/:table/:id         (SurrealQL EVENT target)
 *   POST /api/observe/scan/:workspaceId  (periodic graph scan)
 *   SurrealDB direct queries             (verification of outcomes)
 */
import { RecordId, type Surreal } from "surrealdb";

// Re-export everything from observer-test-kit
export {
  setupObserverSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createTaskWithCommit,
  createGitCommit,
  createCompletedIntent,
  createObservationByAgent,
  createConfirmedDecision,
  triggerTaskCompletion,
  triggerIntentCompletion,
  triggerDecisionConfirmation,
  waitForObservation,
  getObservationsForEntity,
  getWorkspaceObservations,
  triggerGraphScan,
  createMockGitHubServer,
  type ObservationRecord,
  type ObservationSeverity,
  type ObservationStatus,
  type ObservationType,
} from "../observer-agent/observer-test-kit";

import {
  waitForObservation,
  getObservationsForEntity,
  getWorkspaceObservations,
  type ObservationRecord,
} from "../observer-agent/observer-test-kit";

// ---------------------------------------------------------------------------
// LLM Reasoning-Specific Types
// ---------------------------------------------------------------------------

export type LlmObservationRecord = ObservationRecord & {
  confidence?: number;
  evidence_refs?: RecordId[];
};

// ---------------------------------------------------------------------------
// LLM Reasoning-Specific Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a confirmed decision linked to a project in the graph.
 * Used to set up semantic contradiction scenarios where the LLM
 * evaluates task alignment against decision text.
 */
export async function createDecisionInProject(
  surreal: Surreal,
  workspaceId: string,
  projectId: string,
  opts: {
    summary: string;
    rationale?: string;
    status?: string;
  },
): Promise<{ decisionId: string }> {
  const decisionId = `dec-${crypto.randomUUID()}`;
  const decisionRecord = new RecordId("decision", decisionId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const projectRecord = new RecordId("project", projectId);

  await surreal.query(`CREATE $dec CONTENT $content;`, {
    dec: decisionRecord,
    content: {
      summary: opts.summary,
      rationale: opts.rationale ?? "Confirmed for testing",
      status: opts.status ?? "confirmed",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  // Link decision to project
  await surreal.query(
    `RELATE $dec->belongs_to->$project SET added_at = time::now();`,
    { dec: decisionRecord, project: projectRecord },
  );

  return { decisionId };
}

/**
 * Creates a project in the workspace.
 */
export async function createProject(
  surreal: Surreal,
  workspaceId: string,
  name: string,
): Promise<{ projectId: string }> {
  const projectId = `proj-${crypto.randomUUID()}`;
  const projectRecord = new RecordId("project", projectId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $proj CONTENT $content;`, {
    proj: projectRecord,
    content: {
      name,
      status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return { projectId };
}

/**
 * Creates a task linked to a project (and optionally a commit) in the graph.
 * Used to set up scenarios where the LLM evaluates task alignment against decisions.
 */
export async function createTaskInProject(
  surreal: Surreal,
  workspaceId: string,
  projectId: string,
  opts: {
    title: string;
    description?: string;
    status?: string;
  },
): Promise<{ taskId: string }> {
  const taskId = `task-${crypto.randomUUID()}`;
  const taskRecord = new RecordId("task", taskId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const projectRecord = new RecordId("project", projectId);

  await surreal.query(`CREATE $task CONTENT $content;`, {
    task: taskRecord,
    content: {
      title: opts.title,
      description: opts.description ?? "Test task for LLM reasoning",
      status: opts.status ?? "in_progress",
      workspace: workspaceRecord,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  // Link task to project
  await surreal.query(
    `RELATE $task->belongs_to->$project SET added_at = time::now();`,
    { task: taskRecord, project: projectRecord },
  );

  return { taskId };
}

/**
 * Sets workspace settings for observer skip optimization.
 */
export async function setWorkspaceObserverSkip(
  surreal: Surreal,
  workspaceId: string,
  skipDeterministic: boolean,
): Promise<void> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  await surreal.query(
    `UPDATE $ws SET settings = { observer_skip_deterministic: $skip };`,
    { ws: workspaceRecord, skip: skipDeterministic },
  );
}

/**
 * Waits for an observation with a specific source (e.g. "llm", "deterministic_fallback").
 * Useful when multiple observations may exist for an entity.
 */
export async function waitForObservationWithSource(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
  source: string,
  timeoutMs = 30_000,
): Promise<LlmObservationRecord[]> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const observations = await getObservationsForEntity(surreal, entityTable, entityId);
    const matching = observations.filter((o) => o.source === source);
    if (matching.length > 0) {
      return matching as LlmObservationRecord[];
    }
    await Bun.sleep(500);
  }

  throw new Error(
    `No observation with source="${source}" found for ${entityTable}:${entityId} within ${timeoutMs}ms`,
  );
}

/**
 * Waits for an observation of a specific type linked to an entity.
 */
export async function waitForObservationOfType(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
  observationType: string,
  timeoutMs = 30_000,
): Promise<LlmObservationRecord[]> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const observations = await getObservationsForEntity(surreal, entityTable, entityId);
    const matching = observations.filter((o) => o.observation_type === observationType);
    if (matching.length > 0) {
      return matching as LlmObservationRecord[];
    }
    await Bun.sleep(500);
  }

  throw new Error(
    `No observation with type="${observationType}" found for ${entityTable}:${entityId} within ${timeoutMs}ms`,
  );
}

/**
 * Gets all observes edges from a specific observation.
 * Returns the target entity record IDs.
 */
export async function getObservesTargets(
  surreal: Surreal,
  observationId: string,
): Promise<RecordId[]> {
  const obsRecord = new RecordId("observation", observationId);

  const rows = (await surreal.query(
    `SELECT ->observes->? AS targets FROM $obs;`,
    { obs: obsRecord },
  )) as Array<Array<{ targets: RecordId[] }>>;

  return rows[0]?.[0]?.targets ?? [];
}

/**
 * Counts observations matching criteria in a workspace.
 * Useful for verifying deduplication and count assertions.
 */
export async function countObservations(
  surreal: Surreal,
  workspaceId: string,
  filters: {
    observationType?: string;
    sourceAgent?: string;
    source?: string;
    status?: string;
  },
): Promise<number> {
  const wsRecord = new RecordId("workspace", workspaceId);
  let query = `SELECT count() AS count FROM observation WHERE workspace = $ws`;
  const params: Record<string, unknown> = { ws: wsRecord };

  if (filters.observationType) {
    query += ` AND observation_type = $obsType`;
    params.obsType = filters.observationType;
  }
  if (filters.sourceAgent) {
    query += ` AND source_agent = $agent`;
    params.agent = filters.sourceAgent;
  }
  if (filters.source) {
    query += ` AND source = $source`;
    params.source = filters.source;
  }
  if (filters.status) {
    query += ` AND status = $status`;
    params.status = filters.status;
  }

  query += ` GROUP ALL;`;

  const rows = (await surreal.query(query, params)) as Array<Array<{ count: number }>>;
  return rows[0]?.[0]?.count ?? 0;
}
