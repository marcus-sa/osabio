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
import { createObservation } from "../observation/queries";
import { listWorkspaceOpenObservations } from "../observation/queries";
import { logInfo, logError } from "../http/observability";

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

export type GraphScanResult = {
  contradictions_found: number;
  stale_blocked_found: number;
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
): Promise<GraphScanResult> {
  const result: GraphScanResult = {
    contradictions_found: 0,
    stale_blocked_found: 0,
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
    const observationText =
      `Contradiction detected: Decision "${decision.summary}" conflicts with completed task "${task.title}". ` +
      `The task appears to implement an approach that contradicts the confirmed decision.`;

    if (isAlreadyObserved(existingObservations, observationText)) {
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

    // Also link to the task via a second observes edge
    // (The createObservation already links to the decision)

    result.observations_created += 1;
  }

  // 2. Detect stale blocked tasks
  const staleBlocked = await queryStaleBlockedTasks(surreal, workspaceRecord);
  result.stale_blocked_found = staleBlocked.length;

  for (const task of staleBlocked) {
    const observationText =
      `Task blocked for ${task.daysBlocked} days: "${task.title}". ` +
      `This task has been blocked since ${new Date(task.updated_at).toISOString().slice(0, 10)} ` +
      `(exceeds the ${STALE_BLOCKED_THRESHOLD_DAYS}-day threshold).`;

    if (isAlreadyObserved(existingObservations, observationText)) {
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

  logInfo("observer.scan.completed", "Graph scan completed", {
    workspaceId: workspaceRecord.id,
    ...result,
  });

  return result;
}
