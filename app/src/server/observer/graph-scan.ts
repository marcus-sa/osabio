/**
 * Graph scan: periodic workspace-wide analysis for contradictions and anomalies.
 *
 * Pure query functions that gather scan signals from the workspace graph,
 * then delegate to the observer agent for contradiction analysis.
 *
 * Scan types:
 *   1. Decision-implementation contradictions: confirmed decisions vs completed tasks
 *   2. Stale blocked tasks: tasks blocked longer than threshold (14 days)
 */

import { RecordId, type Surreal } from "surrealdb";
import type { LanguageModel } from "ai";
import { createObservation, listWorkspaceOpenObservations, type ObserveTargetRecord } from "../observation/queries";
import { logInfo } from "../http/observability";
import { synthesizePatterns, type Anomaly } from "./llm-synthesis";
import { parseEntityRef } from "./evidence-validator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfirmedDecision = {
  id: RecordId<"decision">;
  summary: string;
  rationale?: string;
};

export type CompletedTask = {
  id: RecordId<"task">;
  title: string;
  description?: string;
};

export type StaleBlockedTask = {
  id: RecordId<"task">;
  title: string;
  description?: string;
  updated_at: string | Date;
  daysBlocked: number;
};

export type StatusDriftTask = {
  id: RecordId<"task">;
  title: string;
  status: string;
  dependency: {
    id: RecordId<"task">;
    title: string;
    status: string;
  };
};

export type GraphScanResult = {
  contradictions_found: number;
  stale_blocked_found: number;
  status_drift_found: number;
  observations_created: number;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STALE_BLOCKED_THRESHOLD_DAYS = 14;

// ---------------------------------------------------------------------------
// Graph queries (pure data gathering)
// ---------------------------------------------------------------------------

async function queryConfirmedDecisions(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ConfirmedDecision[]> {
  const [rows] = await surreal.query<[ConfirmedDecision[]]>(
    `SELECT id, summary, rationale, created_at FROM decision
     WHERE workspace = $ws AND status = "confirmed"
     ORDER BY created_at DESC
     LIMIT 50;`,
    { ws: workspaceRecord },
  );
  return rows ?? [];
}

async function queryCompletedTasks(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<CompletedTask[]> {
  const [rows] = await surreal.query<[CompletedTask[]]>(
    `SELECT id, title, description, updated_at FROM task
     WHERE workspace = $ws AND status IN ["completed", "done"]
     ORDER BY updated_at DESC
     LIMIT 50;`,
    { ws: workspaceRecord },
  );
  return rows ?? [];
}

async function queryStaleBlockedTasks(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<StaleBlockedTask[]> {
  const thresholdDate = new Date(
    Date.now() - STALE_BLOCKED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  );

  const [rows] = await surreal.query<
    [Array<{ id: RecordId<"task">; title: string; description?: string; updated_at: string }>]
  >(
    `SELECT id, title, description, updated_at FROM task
     WHERE workspace = $ws
       AND status = "blocked"
       AND updated_at < $threshold
     ORDER BY updated_at ASC
     LIMIT 50;`,
    { ws: workspaceRecord, threshold: thresholdDate },
  );

  return (rows ?? []).map((row) => {
    const updatedAt = new Date(row.updated_at);
    const daysBlocked = Math.floor(
      (Date.now() - updatedAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    return { ...row, daysBlocked };
  });
}

async function queryStatusDriftTasks(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<StatusDriftTask[]> {
  // Two-step approach: first find completed tasks with dependencies,
  // then filter for incomplete dependencies in application code
  const [rows] = await surreal.query<[Array<{
    id: RecordId<"task">;
    title: string;
    status: string;
    dep_ids: RecordId<"task">[];
    dep_titles: string[];
    dep_statuses: string[];
  }>]>(
    `SELECT
       id, title, status,
       ->depends_on->task.id AS dep_ids,
       ->depends_on->task.title AS dep_titles,
       ->depends_on->task.status AS dep_statuses
     FROM task
     WHERE workspace = $ws
       AND status IN ["completed", "done"]
       AND array::len(->depends_on->task) > 0
     LIMIT 50;`,
    { ws: workspaceRecord },
  );

  return (rows ?? []).flatMap((row) => {
    const depIds = row.dep_ids ?? [];
    const depTitles = row.dep_titles ?? [];
    const depStatuses = row.dep_statuses ?? [];

    const drifts: StatusDriftTask[] = [];
    for (let i = 0; i < depIds.length; i++) {
      const depStatus = depStatuses[i];
      if (depStatus !== "completed" && depStatus !== "done") {
        drifts.push({
          id: row.id,
          title: row.title,
          status: row.status,
          dependency: {
            id: depIds[i],
            title: depTitles[i],
            status: depStatus,
          },
        });
      }
    }
    return drifts;
  });
}

// ---------------------------------------------------------------------------
// Entity-level deduplication query
// ---------------------------------------------------------------------------

/**
 * Queries existing open observer observations linked to a specific entity.
 * Used for entity-level dedup -- if the observer already has an open observation
 * on this entity, we skip creating another.
 */
const ALLOWED_OBSERVER_TABLES = ["project", "feature", "task", "decision", "question", "intent", "git_commit", "observation"];

async function queryExistingObserverObservationsForEntity(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  entityRecord: RecordId<string, string>,
): Promise<Array<{ text: string; severity: string; status: string }>> {
  if (!ALLOWED_OBSERVER_TABLES.includes(entityRecord.table.name)) {
    throw new Error(`Invalid entity table for observer dedup query: ${entityRecord.table.name}`);
  }

  const [rows] = await surreal.query<[Array<{ text: string; severity: string; status: string }>]>(
    `SELECT text, severity, status FROM observation
     WHERE workspace = $ws
       AND source_agent = "observer_agent"
       AND status IN ["open", "acknowledged"]
       AND ->observes->${entityRecord.table.name}.id CONTAINS $entity
     LIMIT 20;`,
    { ws: workspaceRecord, entity: entityRecord },
  );
  return rows ?? [];
}

// ---------------------------------------------------------------------------
// Contradiction detection (deterministic heuristic)
// ---------------------------------------------------------------------------

/**
 * Simple keyword-based contradiction detection between decisions and tasks.
 * Looks for signals that a completed task contradicts a confirmed decision.
 *
 * Returns pairs of (decision, task) that appear contradictory.
 */
function detectContradictions(
  decisions: ConfirmedDecision[],
  tasks: CompletedTask[],
): Array<{ decision: ConfirmedDecision; task: CompletedTask }> {
  const contradictions: Array<{ decision: ConfirmedDecision; task: CompletedTask }> = [];

  for (const decision of decisions) {
    const decisionText = decision.summary.toLowerCase();

    for (const task of tasks) {
      const taskText = `${task.title} ${task.description ?? ""}`.toLowerCase();

      // Detect technology contradictions
      // e.g., decision says "use tRPC" but task implements "REST" or "Express"
      if (detectsTechnologyContradiction(decisionText, taskText)) {
        contradictions.push({ decision, task });
      }
    }
  }

  return contradictions;
}

/**
 * Detects when a task uses a technology that contradicts a decision mandate.
 * Checks known technology pairs (e.g., tRPC vs REST, GraphQL vs REST).
 */
function detectsTechnologyContradiction(
  decisionText: string,
  taskText: string,
): boolean {
  const technologyPairs: Array<{ mandated: string[]; contradicting: string[] }> = [
    {
      mandated: ["trpc"],
      contradicting: ["rest", "express"],
    },
    {
      mandated: ["graphql"],
      contradicting: ["rest", "express"],
    },
    {
      mandated: ["typescript"],
      contradicting: ["javascript"],
    },
  ];

  for (const pair of technologyPairs) {
    const mandatesThis = pair.mandated.some((term) => decisionText.includes(term));
    const taskUsesContradicting = pair.contradicting.some((term) => taskText.includes(term));

    if (mandatesThis && taskUsesContradicting) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

type ExistingObservation = {
  text: string;
  severity: string;
  status: string;
};

function isAlreadyObserved(
  existingObservations: ExistingObservation[],
  newText: string,
): boolean {
  const normalizedNew = newText.toLowerCase();

  return existingObservations.some((obs) => {
    if (obs.status === "resolved") return false;
    const normalizedExisting = obs.text.toLowerCase();
    // Check if the core issue is already covered
    return (
      normalizedExisting.includes(normalizedNew.slice(0, 40)) ||
      normalizedNew.includes(normalizedExisting.slice(0, 40))
    );
  });
}

// ---------------------------------------------------------------------------
// Scan orchestrator
// ---------------------------------------------------------------------------

export async function runGraphScan(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  observerModel?: LanguageModel,
): Promise<GraphScanResult> {
  const result: GraphScanResult = {
    contradictions_found: 0,
    stale_blocked_found: 0,
    status_drift_found: 0,
    observations_created: 0,
  };

  // Load existing observations for deduplication
  const existingObservations = await listWorkspaceOpenObservations({
    surreal,
    workspaceRecord,
    limit: 100,
  });

  // 1. Detect decision-implementation contradictions
  const [decisions, completedTasks] = await Promise.all([
    queryConfirmedDecisions(surreal, workspaceRecord),
    queryCompletedTasks(surreal, workspaceRecord),
  ]);

  const contradictions = detectContradictions(decisions, completedTasks);
  result.contradictions_found = contradictions.length;

  for (const { decision, task } of contradictions) {
    // Entity-level dedup: check if observer already has an open observation on this decision
    const existingForDecision = await queryExistingObserverObservationsForEntity(
      surreal, workspaceRecord,
      decision.id as RecordId<string, string>,
    );

    const observationText =
      `Contradiction detected: Decision "${decision.summary}" conflicts with completed task "${task.title}". ` +
      `The task appears to implement an approach that contradicts the confirmed decision.`;

    if (existingForDecision.length > 0 || isAlreadyObserved(existingObservations, observationText)) {
      logInfo("observer.scan.dedup", "Skipping duplicate contradiction observation", {
        decisionId: decision.id.id,
        taskId: task.id.id,
      });
      continue;
    }

    const now = new Date();
    await createObservation({
      surreal,
      workspaceRecord,
      text: observationText,
      severity: "conflict",
      sourceAgent: "observer_agent",
      observationType: "contradiction",
      now,
      relatedRecord: decision.id as RecordId<"project" | "feature" | "task" | "decision" | "question", string>,
    });

    result.observations_created += 1;
  }

  // 2. Detect stale blocked tasks
  const staleBlocked = await queryStaleBlockedTasks(surreal, workspaceRecord);
  result.stale_blocked_found = staleBlocked.length;

  for (const task of staleBlocked) {
    // Entity-level dedup: check if observer already has an open observation on this task
    const existingForTask = await queryExistingObserverObservationsForEntity(
      surreal, workspaceRecord,
      task.id as RecordId<string, string>,
    );

    const observationText =
      `Task blocked for ${task.daysBlocked} days: "${task.title}". ` +
      `This task has been blocked since ${new Date(task.updated_at).toISOString().slice(0, 10)} ` +
      `(exceeds the ${STALE_BLOCKED_THRESHOLD_DAYS}-day threshold).`;

    if (existingForTask.length > 0 || isAlreadyObserved(existingObservations, observationText)) {
      logInfo("observer.scan.dedup", "Skipping duplicate stale-blocked observation", {
        taskId: task.id.id,
      });
      continue;
    }

    const now = new Date();
    await createObservation({
      surreal,
      workspaceRecord,
      text: observationText,
      severity: "warning",
      sourceAgent: "observer_agent",
      observationType: "anomaly",
      now,
      relatedRecord: task.id as RecordId<"project" | "feature" | "task" | "decision" | "question", string>,
    });

    result.observations_created += 1;
  }

  // 3. Detect status drift (completed tasks with incomplete dependencies)
  const driftTasks = await queryStatusDriftTasks(surreal, workspaceRecord);
  result.status_drift_found = driftTasks.length;

  for (const drift of driftTasks) {
    // Entity-level dedup
    const existingForTask = await queryExistingObserverObservationsForEntity(
      surreal, workspaceRecord,
      drift.id as RecordId<string, string>,
    );

    const observationText =
      `Status drift detected: Task "${drift.title}" is marked as ${drift.status}, ` +
      `but its dependency "${drift.dependency.title}" is still ${drift.dependency.status}. ` +
      `A task should not be completed before its dependencies.`;

    if (existingForTask.length > 0 || isAlreadyObserved(existingObservations, observationText)) {
      logInfo("observer.scan.dedup", "Skipping duplicate status-drift observation", {
        taskId: drift.id.id,
        depTaskId: drift.dependency.id.id,
      });
      continue;
    }

    const now = new Date();
    await createObservation({
      surreal,
      workspaceRecord,
      text: observationText,
      severity: "warning",
      sourceAgent: "observer_agent",
      observationType: "anomaly",
      now,
      relatedRecord: drift.id as RecordId<"project" | "feature" | "task" | "decision" | "question", string>,
    });

    result.observations_created += 1;
  }

  // 4. LLM pattern synthesis (when model configured and anomalies exist)
  if (observerModel) {
    const anomalies: Anomaly[] = [];

    for (const { decision, task } of contradictions) {
      anomalies.push({
        type: "contradiction",
        text: `Decision "${decision.summary}" conflicts with task "${task.title}"`,
        entityId: decision.id.id as string,
        entityTable: "decision",
      });
    }
    for (const task of staleBlocked) {
      anomalies.push({
        type: "stale_blocked",
        text: `Task "${task.title}" blocked for ${task.daysBlocked} days`,
        entityId: task.id.id as string,
        entityTable: "task",
      });
    }
    for (const drift of driftTasks) {
      anomalies.push({
        type: "status_drift",
        text: `Task "${drift.title}" completed but dependency "${drift.dependency.title}" is ${drift.dependency.status}`,
        entityId: drift.id.id as string,
        entityTable: "task",
      });
    }

    if (anomalies.length > 0) {
      const patterns = await synthesizePatterns(observerModel, anomalies);

      if (patterns) {
        for (const pattern of patterns) {
          // Dedup: check if a similar pattern observation already exists
          const patternText = `${pattern.pattern_name}: ${pattern.description}`;
          if (isAlreadyObserved(existingObservations, patternText)) {
            logInfo("observer.scan.synthesis_dedup", "Skipping duplicate pattern", {
              pattern: pattern.pattern_name,
            });
            continue;
          }

          // Build related records from contributing entities
          const relatedRecords: ObserveTargetRecord[] = [];
          for (const ref of pattern.contributing_entities) {
            const parsed = parseEntityRef(ref);
            if (parsed) {
              relatedRecords.push(new RecordId(parsed.table, parsed.id) as ObserveTargetRecord);
            }
          }

          const now = new Date();
          await createObservation({
            surreal,
            workspaceRecord,
            text: patternText,
            severity: pattern.severity,
            sourceAgent: "observer_agent",
            observationType: "pattern",
            now,
            relatedRecords: relatedRecords.length > 0 ? relatedRecords : undefined,
          });

          result.observations_created += 1;
        }

        logInfo("observer.scan.synthesis", "Pattern synthesis completed", {
          patternsFound: patterns.length,
        });
      } else {
        logInfo("observer.llm.fallback", "Pattern synthesis failed, anomalies reported individually", {
          anomalyCount: anomalies.length,
        });
      }
    }
  }

  logInfo("observer.scan.completed", "Graph scan completed", {
    workspaceId: workspaceRecord.id,
    ...result,
  });

  return result;
}
