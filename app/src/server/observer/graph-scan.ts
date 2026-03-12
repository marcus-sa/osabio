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
import { detectContradictions, evaluateAnomalies, synthesizePatterns, type Anomaly, type AnomalyCandidate } from "./llm-synthesis";
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
  llm_filtered_count: number;
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
// Static query map: one pre-built query string per allowed table, eliminating
// dynamic interpolation at the call site (prevents SurrealQL injection).
const OBSERVER_DEDUP_QUERIES: Record<string, string> = Object.fromEntries(
  ["project", "feature", "task", "decision", "question", "intent", "git_commit", "observation"].map(
    (table) => [
      table,
      `SELECT text, severity, status FROM observation
       WHERE workspace = $ws
         AND source_agent = "observer_agent"
         AND status IN ["open", "acknowledged"]
         AND ->observes->${table}.id CONTAINS $entity
       LIMIT 20;`,
    ],
  ),
);

export async function queryExistingObserverObservationsForEntity(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  entityRecord: RecordId<string, string>,
): Promise<Array<{ text: string; severity: string; status: string }>> {
  const query = OBSERVER_DEDUP_QUERIES[entityRecord.table.name];
  if (!query) {
    throw new Error(`Invalid entity table for observer dedup query: ${entityRecord.table.name}`);
  }

  const [rows] = await surreal.query<[Array<{ text: string; severity: string; status: string }>]>(
    query,
    { ws: workspaceRecord, entity: entityRecord },
  );
  return rows ?? [];
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
  entityId?: string,
): boolean {
  const normalizedNew = newText.toLowerCase();

  return existingObservations.some((obs) => {
    if (obs.status === "resolved") return false;

    // When entity ID is available, require it to appear in the existing text
    // so observations about different entities are never considered duplicates
    if (entityId && !obs.text.toLowerCase().includes(entityId.toLowerCase())) {
      return false;
    }

    const normalizedExisting = obs.text.toLowerCase();
    // Check if the core issue is already covered using a meaningful prefix
    const prefixLen = Math.min(80, normalizedNew.length);
    return (
      normalizedExisting.includes(normalizedNew.slice(0, prefixLen)) ||
      normalizedNew.includes(normalizedExisting.slice(0, prefixLen))
    );
  });
}

// ---------------------------------------------------------------------------
// Scan orchestrator
// ---------------------------------------------------------------------------

export async function runGraphScan(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  observerModel: LanguageModel,
): Promise<GraphScanResult> {
  const result: GraphScanResult = {
    contradictions_found: 0,
    stale_blocked_found: 0,
    status_drift_found: 0,
    observations_created: 0,
    llm_filtered_count: 0,
  };

  // Load existing observations for deduplication
  const existingObservations = await listWorkspaceOpenObservations({
    surreal,
    workspaceRecord,
    limit: 100,
  });

  // 1. Detect decision-implementation contradictions (LLM-based)
  const [decisions, completedTasks] = await Promise.all([
    queryConfirmedDecisions(surreal, workspaceRecord),
    queryCompletedTasks(surreal, workspaceRecord),
  ]);

  type ContradictionPair = { decision: ConfirmedDecision; task: CompletedTask };
  const contradictions: ContradictionPair[] = [];

  if (decisions.length > 0 && completedTasks.length > 0) {
    const decisionMap = new Map(decisions.map((d) => [d.id.id as string, d]));
    const taskMap = new Map(completedTasks.map((t) => [t.id.id as string, t]));

    const detected = await detectContradictions(
      observerModel,
      decisions.map((d) => ({ id: d.id.id as string, summary: d.summary, rationale: d.rationale })),
      completedTasks.map((t) => ({ id: t.id.id as string, title: t.title, description: t.description })),
    );

    if (detected) {
      for (const c of detected) {
        const decisionId = parseEntityRef(c.decision_ref)?.id;
        const taskId = parseEntityRef(c.task_ref)?.id;
        const decision = decisionId ? decisionMap.get(decisionId) : undefined;
        const task = taskId ? taskMap.get(taskId) : undefined;
        if (decision && task) contradictions.push({ decision, task });
      }
    }
  }

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

    if (existingForDecision.length > 0 || isAlreadyObserved(existingObservations, observationText, decision.id.id as string)) {
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
      relatedRecords: [
        decision.id as RecordId<"project" | "feature" | "task" | "decision" | "question", string>,
        task.id as RecordId<"project" | "feature" | "task" | "decision" | "question", string>,
      ],
    });

    result.observations_created += 1;
  }

  // 2. Detect stale blocked tasks and status drift (concurrent queries)
  const [staleBlocked, driftTasks] = await Promise.all([
    queryStaleBlockedTasks(surreal, workspaceRecord),
    queryStatusDriftTasks(surreal, workspaceRecord),
  ]);
  result.stale_blocked_found = staleBlocked.length;
  result.status_drift_found = driftTasks.length;

  // 3. LLM anomaly evaluation: filter false positives before creating observations
  const anomalyCandidates: AnomalyCandidate[] = [];

  for (const task of staleBlocked) {
    anomalyCandidates.push({
      entityRef: `task:${task.id.id as string}`,
      type: "stale_blocked",
      title: task.title,
      description: task.description,
      detail: `Blocked for ${task.daysBlocked} days since ${new Date(task.updated_at).toISOString().slice(0, 10)}`,
    });
  }

  for (const drift of driftTasks) {
    anomalyCandidates.push({
      entityRef: `task:${drift.id.id as string}`,
      type: "status_drift",
      title: drift.title,
      description: undefined,
      detail: `Marked as ${drift.status} but dependency "${drift.dependency.title}" is still ${drift.dependency.status}`,
    });
  }

  // Build evaluation map: entityRef -> LLM verdict (fallback: all relevant with default severity)
  const evaluationMap = new Map<string, { relevant: boolean; reasoning: string; severity: "info" | "warning" | "conflict" }>();

  if (anomalyCandidates.length > 0) {
    const evaluations = await evaluateAnomalies(observerModel, anomalyCandidates);

    if (evaluations) {
      for (const ev of evaluations) {
        evaluationMap.set(ev.entity_ref, {
          relevant: ev.relevant,
          reasoning: ev.reasoning,
          severity: ev.suggested_severity,
        });
      }
    } else {
      logInfo("observer.llm.fallback", "Anomaly evaluation failed, treating all as relevant", {
        candidateCount: anomalyCandidates.length,
      });
    }
  }

  // Create observations for stale blocked tasks (LLM-filtered)
  for (const task of staleBlocked) {
    const entityRef = `task:${task.id.id as string}`;
    const evaluation = evaluationMap.get(entityRef);

    // When LLM evaluated and marked not relevant, skip
    if (evaluation && !evaluation.relevant) {
      logInfo("observer.scan.llm_filtered", "Stale-blocked task filtered by LLM as not relevant", {
        taskId: task.id.id,
        reasoning: evaluation.reasoning,
      });
      result.llm_filtered_count += 1;
      continue;
    }

    // Entity-level dedup
    const existingForTask = await queryExistingObserverObservationsForEntity(
      surreal, workspaceRecord,
      task.id as RecordId<string, string>,
    );

    const llmReasoning = evaluation?.reasoning;
    const severity = evaluation?.severity ?? "warning";

    const observationText = llmReasoning
      ? `Task blocked for ${task.daysBlocked} days: "${task.title}". ${llmReasoning}`
      : `Task blocked for ${task.daysBlocked} days: "${task.title}". ` +
        `This task has been blocked since ${new Date(task.updated_at).toISOString().slice(0, 10)} ` +
        `(exceeds the ${STALE_BLOCKED_THRESHOLD_DAYS}-day threshold).`;

    if (existingForTask.length > 0 || isAlreadyObserved(existingObservations, observationText, task.id.id as string)) {
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
      severity,
      sourceAgent: "observer_agent",
      observationType: "anomaly",
      now,
      relatedRecords: [task.id as RecordId<"project" | "feature" | "task" | "decision" | "question", string>],
    });

    result.observations_created += 1;
  }

  // Create observations for status drift tasks (LLM-filtered)
  for (const drift of driftTasks) {
    const entityRef = `task:${drift.id.id as string}`;
    const evaluation = evaluationMap.get(entityRef);

    // When LLM evaluated and marked not relevant, skip
    if (evaluation && !evaluation.relevant) {
      logInfo("observer.scan.llm_filtered", "Status-drift task filtered by LLM as not relevant", {
        taskId: drift.id.id,
        reasoning: evaluation.reasoning,
      });
      result.llm_filtered_count += 1;
      continue;
    }

    // Entity-level dedup
    const existingForTask = await queryExistingObserverObservationsForEntity(
      surreal, workspaceRecord,
      drift.id as RecordId<string, string>,
    );

    const llmReasoning = evaluation?.reasoning;
    const severity = evaluation?.severity ?? "warning";

    const observationText = llmReasoning
      ? `Status drift: Task "${drift.title}" is ${drift.status} but dependency "${drift.dependency.title}" is ${drift.dependency.status}. ${llmReasoning}`
      : `Status drift detected: Task "${drift.title}" is marked as ${drift.status}, ` +
        `but its dependency "${drift.dependency.title}" is still ${drift.dependency.status}. ` +
        `A task should not be completed before its dependencies.`;

    if (existingForTask.length > 0 || isAlreadyObserved(existingObservations, observationText, drift.id.id as string)) {
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
      severity,
      sourceAgent: "observer_agent",
      observationType: "anomaly",
      now,
      relatedRecords: [drift.id as RecordId<"project" | "feature" | "task" | "decision" | "question", string>],
    });

    result.observations_created += 1;
  }

  // 4. LLM pattern synthesis
  const anomalies: Anomaly[] = [];

  for (const { decision, task } of contradictions) {
    anomalies.push({
      type: "contradiction",
      text: `Decision "${decision.summary}" conflicts with task "${task.title}"`,
      entityId: decision.id.id as string,
      entityTable: "decision",
    });
    anomalies.push({
      type: "contradiction",
      text: `Task "${task.title}" contradicts decision "${decision.summary}"`,
      entityId: task.id.id as string,
      entityTable: "task",
    });
  }
  for (const task of staleBlocked) {
    const evaluation = evaluationMap.get(`task:${task.id.id as string}`);
    if (evaluation && !evaluation.relevant) continue; // skip LLM-filtered anomalies
    anomalies.push({
      type: "stale_blocked",
      text: `Task "${task.title}" blocked for ${task.daysBlocked} days`,
      entityId: task.id.id as string,
      entityTable: "task",
    });
  }
  for (const drift of driftTasks) {
    const evaluation = evaluationMap.get(`task:${drift.id.id as string}`);
    if (evaluation && !evaluation.relevant) continue; // skip LLM-filtered anomalies
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

  logInfo("observer.scan.completed", "Graph scan completed", {
    workspaceId: workspaceRecord.id,
    ...result,
  });

  return result;
}
