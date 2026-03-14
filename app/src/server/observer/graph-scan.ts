/**
 * Graph scan: periodic workspace-wide analysis for contradictions and anomalies.
 *
 * Pure query functions that gather scan signals from the workspace graph,
 * then delegate to the observer agent for contradiction analysis.
 *
 * Scan types:
 *   1. Decision-implementation contradictions: confirmed decisions vs completed tasks
 *   2. Stale blocked tasks: tasks blocked longer than threshold (14 days)
 *   3. Coherence: orphaned decisions (confirmed, no implementing task/commit after threshold)
 *   4. Coherence: stale objectives (active, no supports edges after threshold)
 */

import { RecordId, type Surreal } from "surrealdb";
import type { LanguageModel, embed } from "ai";
import { createObservation, listWorkspaceOpenObservations, type ObserveTargetRecord } from "../observation/queries";
import { logInfo } from "../http/observability";
import { detectContradictions, evaluateAnomalies, synthesizePatterns, type Anomaly, type AnomalyCandidate } from "./llm-synthesis";
import { parseEntityRef } from "./evidence-validator";
import { runDiagnosticClustering, queryWorkspaceBehaviorTrends, proposeBehaviorLearning, checkBehaviorLearningRateLimit } from "./learning-diagnosis";

type EmbeddingModel = Parameters<typeof embed>[0]["model"];

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

export type OrphanedDecision = {
  id: RecordId<"decision">;
  summary: string;
  created_at: string | Date;
};

export type StaleObjective = {
  id: RecordId<"objective">;
  title: string;
  created_at: string | Date;
};

export type CoherenceScanResult = {
  orphaned_decisions_found: number;
  stale_objectives_found: number;
  observations_created: number;
};

export type GraphScanResult = {
  contradictions_found: number;
  stale_blocked_found: number;
  status_drift_found: number;
  orphaned_decisions_found: number;
  stale_objectives_found: number;
  observations_created: number;
  llm_filtered_count: number;
  learning_proposals_created: number;
  clusters_found: number;
  coverage_skips: number;
  behavior_learning_proposals: number;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STALE_BLOCKED_THRESHOLD_DAYS = 14;
export const COHERENCE_AGE_THRESHOLD_DAYS = 14;

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
  ["project", "feature", "task", "decision", "question", "intent", "git_commit", "observation", "objective"].map(
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
// Coherence queries (deterministic, no LLM needed)
// ---------------------------------------------------------------------------

/**
 * Finds confirmed decisions older than the coherence threshold with no
 * implementing task or commit (via implemented_by edges).
 */
export async function queryOrphanedDecisions(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<OrphanedDecision[]> {
  const thresholdDate = new Date(
    Date.now() - COHERENCE_AGE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  );

  const [rows] = await surreal.query<[OrphanedDecision[]]>(
    `SELECT id, summary, created_at FROM decision
     WHERE workspace = $ws
       AND status = "confirmed"
       AND created_at < $threshold
       AND array::len(<-implemented_by<-git_commit) = 0
       AND array::len(<-implemented_by<-pull_request) = 0
     ORDER BY created_at ASC
     LIMIT 50;`,
    { ws: workspaceRecord, threshold: thresholdDate },
  );
  return rows ?? [];
}

/**
 * Finds active objectives older than the coherence threshold with no
 * supporting intents (via supports edges).
 */
export async function queryStaleObjectives(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<StaleObjective[]> {
  const thresholdDate = new Date(
    Date.now() - COHERENCE_AGE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  );

  const [rows] = await surreal.query<[StaleObjective[]]>(
    `SELECT id, title, created_at FROM objective
     WHERE workspace = $ws
       AND status = "active"
       AND created_at < $threshold
       AND array::len(<-supports<-intent) = 0
     ORDER BY created_at ASC
     LIMIT 50;`,
    { ws: workspaceRecord, threshold: thresholdDate },
  );
  return rows ?? [];
}

/**
 * Runs coherence scans: detects orphaned decisions and stale objectives,
 * creates observations for disconnected patterns.
 *
 * Deterministic -- no LLM filtering needed.
 */
export async function runCoherenceScans(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<CoherenceScanResult> {
  const result: CoherenceScanResult = {
    orphaned_decisions_found: 0,
    stale_objectives_found: 0,
    observations_created: 0,
  };

  // Load existing observations for deduplication
  const existingObservations = await listWorkspaceOpenObservations({
    surreal,
    workspaceRecord,
    limit: 100,
  });

  const [orphanedDecisions, staleObjectives] = await Promise.all([
    queryOrphanedDecisions(surreal, workspaceRecord),
    queryStaleObjectives(surreal, workspaceRecord),
  ]);

  result.orphaned_decisions_found = orphanedDecisions.length;
  result.stale_objectives_found = staleObjectives.length;

  // Create observations for orphaned decisions
  for (const decision of orphanedDecisions) {
    const existingForDecision = await queryExistingObserverObservationsForEntity(
      surreal,
      workspaceRecord,
      decision.id as RecordId<string, string>,
    );

    const observationText =
      `Orphaned decision: "${decision.summary}" was confirmed but has no implementing task or commit ` +
      `after ${COHERENCE_AGE_THRESHOLD_DAYS} days. Consider creating implementation tasks or revisiting this decision.`;

    if (
      existingForDecision.length > 0 ||
      isAlreadyObserved(existingObservations, observationText, decision.id.id as string)
    ) {
      logInfo("observer.coherence.dedup", "Skipping duplicate orphaned decision observation", {
        decisionId: decision.id.id,
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
      relatedRecords: [
        decision.id as ObserveTargetRecord,
      ],
    });
    result.observations_created += 1;
  }

  // Create observations for stale objectives
  for (const objective of staleObjectives) {
    const existingForObjective = await queryExistingObserverObservationsForEntity(
      surreal,
      workspaceRecord,
      objective.id as RecordId<string, string>,
    );

    const observationText =
      `Stale objective: "${objective.title}" has been active for over ${COHERENCE_AGE_THRESHOLD_DAYS} days ` +
      `with no supporting intents. Consider aligning work to this objective or archiving it.`;

    if (
      existingForObjective.length > 0 ||
      isAlreadyObserved(existingObservations, observationText, objective.id.id as string)
    ) {
      logInfo("observer.coherence.dedup", "Skipping duplicate stale objective observation", {
        objectiveId: objective.id.id,
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
      relatedRecords: [
        objective.id as ObserveTargetRecord,
      ],
    });
    result.observations_created += 1;
  }

  logInfo("observer.coherence.completed", "Coherence scan completed", {
    workspaceId: workspaceRecord.id,
    ...result,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Scan orchestrator
// ---------------------------------------------------------------------------

export async function runGraphScan(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  observerModel: LanguageModel,
  embeddingModel: EmbeddingModel,
  embeddingDimension: number,
): Promise<GraphScanResult> {
  const result: GraphScanResult = {
    contradictions_found: 0,
    stale_blocked_found: 0,
    status_drift_found: 0,
    orphaned_decisions_found: 0,
    stale_objectives_found: 0,
    observations_created: 0,
    llm_filtered_count: 0,
    learning_proposals_created: 0,
    clusters_found: 0,
    coverage_skips: 0,
    behavior_learning_proposals: 0,
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
        decision.id as ObserveTargetRecord,
        task.id as ObserveTargetRecord,
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

  // Create observations for anomalies (stale-blocked + status-drift), LLM-filtered
  type AnomalyObservation = {
    entityRef: string;
    taskRecord: RecordId<"task">;
    observationText: string;
    anomalyType: string;
    dedupContext?: Record<string, unknown>;
  };

  const anomalyObservations: AnomalyObservation[] = [
    ...staleBlocked.map((task): AnomalyObservation => {
      const llmReasoning = evaluationMap.get(`task:${task.id.id as string}`)?.reasoning;
      return {
        entityRef: `task:${task.id.id as string}`,
        taskRecord: task.id,
        anomalyType: "stale-blocked",
        observationText: llmReasoning
          ? `Task blocked for ${task.daysBlocked} days: "${task.title}". ${llmReasoning}`
          : `Task blocked for ${task.daysBlocked} days: "${task.title}". ` +
            `This task has been blocked since ${new Date(task.updated_at).toISOString().slice(0, 10)} ` +
            `(exceeds the ${STALE_BLOCKED_THRESHOLD_DAYS}-day threshold).`,
        dedupContext: { taskId: task.id.id },
      };
    }),
    ...driftTasks.map((drift): AnomalyObservation => {
      const llmReasoning = evaluationMap.get(`task:${drift.id.id as string}`)?.reasoning;
      return {
        entityRef: `task:${drift.id.id as string}`,
        taskRecord: drift.id,
        anomalyType: "status-drift",
        observationText: llmReasoning
          ? `Status drift: Task "${drift.title}" is ${drift.status} but dependency "${drift.dependency.title}" is ${drift.dependency.status}. ${llmReasoning}`
          : `Status drift detected: Task "${drift.title}" is marked as ${drift.status}, ` +
            `but its dependency "${drift.dependency.title}" is still ${drift.dependency.status}. ` +
            `A task should not be completed before its dependencies.`,
        dedupContext: { taskId: drift.id.id, depTaskId: drift.dependency.id.id },
      };
    }),
  ];

  for (const anomaly of anomalyObservations) {
    const evaluation = evaluationMap.get(anomaly.entityRef);

    if (evaluation && !evaluation.relevant) {
      logInfo("observer.scan.llm_filtered", `${anomaly.anomalyType} task filtered by LLM as not relevant`, {
        taskId: (anomaly.taskRecord.id as string),
        reasoning: evaluation.reasoning,
      });
      result.llm_filtered_count += 1;
      continue;
    }

    const existingForTask = await queryExistingObserverObservationsForEntity(
      surreal, workspaceRecord,
      anomaly.taskRecord as RecordId<string, string>,
    );

    if (existingForTask.length > 0 || isAlreadyObserved(existingObservations, anomaly.observationText, anomaly.taskRecord.id as string)) {
      logInfo("observer.scan.dedup", `Skipping duplicate ${anomaly.anomalyType} observation`, anomaly.dedupContext ?? {});
      continue;
    }

    const severity = evaluation?.severity ?? "warning";
    const now = new Date();
    await createObservation({
      surreal,
      workspaceRecord,
      text: anomaly.observationText,
      severity,
      sourceAgent: "observer_agent",
      observationType: "anomaly",
      now,
      relatedRecords: [anomaly.taskRecord as ObserveTargetRecord],
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

  // 5. Coherence scans (deterministic, no LLM)
  const coherenceResult = await runCoherenceScans(surreal, workspaceRecord);
  result.orphaned_decisions_found = coherenceResult.orphaned_decisions_found;
  result.stale_objectives_found = coherenceResult.stale_objectives_found;
  result.observations_created += coherenceResult.observations_created;

  // 6. Diagnostic learning proposals: cluster observations and check coverage
  try {
    const diagnostic = await runDiagnosticClustering(surreal, workspaceRecord, observerModel, embeddingModel, embeddingDimension);
    result.clusters_found = diagnostic.result.clusters_found;
    result.coverage_skips = diagnostic.result.coverage_skips;
    result.learning_proposals_created = diagnostic.result.learning_proposals_created;

    logInfo("observer.scan.diagnostic", "Diagnostic clustering completed", {
      workspaceId: workspaceRecord.id,
      clustersFound: diagnostic.result.clusters_found,
      coverageSkips: diagnostic.result.coverage_skips,
      uncoveredClusters: diagnostic.uncoveredClusters.length,
    });
  } catch (error) {
    logInfo("observer.scan.diagnostic_error", "Diagnostic clustering failed, continuing scan", {
      workspaceId: workspaceRecord.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 7. Behavior trend learning proposals: detect drift/flat patterns, propose learnings
  try {
    const rateLimitCheck = await checkBehaviorLearningRateLimit({
      surreal,
      workspaceRecord,
    });

    if (rateLimitCheck.blocked) {
      logInfo("observer.scan.behavior_rate_limited", "Behavior learning proposals rate-limited", {
        workspaceId: workspaceRecord.id,
        recentProposalCount: rateLimitCheck.count,
      });
    } else {
      const behaviorTrends = await queryWorkspaceBehaviorTrends(surreal, workspaceRecord);
      const actionableTrends = behaviorTrends.filter(
        (t) => t.trend.pattern === "drift" || (t.trend.pattern === "flat" && t.trend.belowThreshold),
      );

      for (const trend of actionableTrends) {
        const proposalResult = await proposeBehaviorLearning({
          surreal,
          workspaceRecord,
          identityId: trend.identityId,
          metricType: trend.metricType,
          behaviorIds: trend.behaviorIds,
          trendPattern: trend.trend.pattern,
          now: new Date(),
        });

        if (proposalResult.created) {
          result.behavior_learning_proposals += 1;
        }
      }

      logInfo("observer.scan.behavior_trends", "Behavior trend analysis completed", {
        workspaceId: workspaceRecord.id,
        totalTrends: behaviorTrends.length,
        actionableTrends: actionableTrends.length,
        proposalsCreated: result.behavior_learning_proposals,
      });
    }
  } catch (error) {
    logInfo("observer.scan.behavior_error", "Behavior trend analysis failed, continuing scan", {
      workspaceId: workspaceRecord.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logInfo("observer.scan.completed", "Graph scan completed", {
    workspaceId: workspaceRecord.id,
    ...result,
  });

  return result;
}
