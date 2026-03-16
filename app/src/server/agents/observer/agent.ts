/**
 * Observer agent: verifies entity state changes and surfaces observations.
 *
 * Owns the full verification pipeline: deterministic + LLM reasoning.
 * Called by observer-route.ts (HTTP adapter) for each entity event.
 *
 * Pipeline: receive event -> gather signals -> deterministic verdict
 *           -> (optional) LLM reasoning -> persist observation
 */

import { RecordId, type Surreal } from "surrealdb";
import type { LanguageModel, embed } from "ai";
import { createObservation, type ObserveTargetRecord } from "../../observation/queries";
import { queryExistingObserverObservationsForEntity } from "../../observer/graph-scan";
import { gatherTaskSignals } from "../../observer/external-signals";
import { checkCiStatus } from "../../observer/external-signals";
import {
  compareTaskCompletion,
  compareIntentCompletion,
  compareCommitStatus,
  compareDecisionConfirmation,
  compareObservationPeerReview,
  shouldSkipLlm,
  applyLlmVerdict,
  type VerificationResult,
  type IntentSignals,
  type DecisionSignals,
  type ObservationPeerReviewSignals,
} from "../../observer/verification-pipeline";
import { buildEntityContext } from "../../observer/context-loader";
import { generateVerificationVerdict, generatePeerReviewVerdict } from "../../observer/llm-reasoning";
import { parseEntityRef } from "../../observer/evidence-validator";
import { runDiagnosticClustering } from "../../observer/learning-diagnosis";
import { log } from "../../telemetry/logger";

type EmbeddingModel = Parameters<typeof embed>[0]["model"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObserverVerdict = "match" | "mismatch" | "inconclusive";

export type ObserverAgentOutput = {
  observations_created: number;
  verdict: ObserverVerdict;
  evidence: string[];
};

export type ObserverAgentInput = {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  entityTable: string;
  entityId: string;
  entityBody?: Record<string, unknown>;
  observerModel: LanguageModel;
  embeddingModel?: EmbeddingModel;
  embeddingDimension?: number;
};

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

export async function runObserverAgent(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { entityTable } = input;

  let result: ObserverAgentOutput;

  switch (entityTable) {
    case "task":
      result = await verifyTask(input);
      break;
    case "intent":
      result = await verifyIntent(input);
      break;
    case "git_commit":
      result = await verifyCommit(input);
      break;
    case "decision":
      result = await verifyDecision(input);
      break;
    case "observation":
      result = await peerReviewObservation(input);
      break;
    case "trace":
      // Trace analysis is handled by the trace-response-analyzer at the route level.
      // This case exists for completeness; the route dispatches directly.
      return {
        observations_created: 0,
        verdict: "inconclusive",
        evidence: ["Trace analysis handled by trace-response-analyzer at route level"],
      };
    case "agent_session":
      // Session-end analysis is handled by the session-trace-analyzer at the route level.
      // This case exists for completeness; the route dispatches directly.
      return {
        observations_created: 0,
        verdict: "inconclusive",
        evidence: ["Session analysis handled by session-trace-analyzer at route level"],
      };
    default:
      return {
        observations_created: 0,
        verdict: "inconclusive",
        evidence: [`Entity type '${entityTable}' verification not yet implemented`],
      };
  }

  // Event-driven escalation: check if this entity now has enough
  // observations to trigger the diagnostic learning pipeline.
  // Skip for observation peer reviews (avoid recursive escalation).
  if (result.observations_created > 0 && entityTable !== "observation"
    && input.observerModel && input.embeddingModel && input.embeddingDimension) {
    await checkAndEscalate(
      input.surreal,
      input.workspaceRecord,
      input.entityTable,
      input.entityId,
      input.observerModel,
      input.embeddingModel,
      input.embeddingDimension,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Task verification (deterministic + LLM)
// ---------------------------------------------------------------------------

async function verifyTask(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { surreal, workspaceRecord, entityId: taskId, entityBody: body, observerModel } = input;
  const taskRecord = new RecordId("task", taskId);
  const evidence: string[] = [];

  // Deterministic: gather external signals (commits, CI)
  const signalsResult = await gatherTaskSignals(surreal, taskId);
  evidence.push(`Commits found: ${signalsResult.hasCommits}`);
  evidence.push(`Signal count: ${signalsResult.signals.length}`);

  const deterministicResult = compareTaskCompletion(signalsResult);
  evidence.push(`Verdict: ${deterministicResult.verdict}`);
  evidence.push(deterministicResult.text);

  // LLM reasoning path
  if (observerModel) {
    const skipDeterministic = await loadWorkspaceSkipSetting(surreal, workspaceRecord);

    if (shouldSkipLlm(deterministicResult, skipDeterministic)) {
      log.info("observer.llm.skip", "LLM skipped: deterministic match + CI passing", { taskId });
    } else {
      const context = await buildEntityContext(surreal, workspaceRecord, "task", taskId, body);

      // Only invoke LLM when there are decisions to check against.
      // Without decisions, semantic verification has nothing to compare --
      // the deterministic CI-based verdict should stand.
      if (context.relatedDecisions.length === 0) {
        log.info("observer.llm.skip", "LLM skipped: no related decisions to verify against", { taskId });
        await persistObservation(surreal, workspaceRecord, [taskRecord as ObserveTargetRecord], deterministicResult);
        return {
          observations_created: 1,
          verdict: deterministicResult.verdict,
          evidence,
        };
      }

      const llmVerdict = await generateVerificationVerdict(observerModel, context, deterministicResult);
      const finalVerdict = applyLlmVerdict(deterministicResult, llmVerdict);

      // Link contradicted decisions via observes edges
      const additionalRecords = extractDecisionRecords(llmVerdict?.evidence_refs);

      await persistObservation(surreal, workspaceRecord, [taskRecord as ObserveTargetRecord, ...additionalRecords], finalVerdict);

      return {
        observations_created: 1,
        verdict: finalVerdict.verdict,
        evidence,
      };
    }
  }

  // Deterministic-only path
  await persistObservation(surreal, workspaceRecord, [taskRecord as ObserveTargetRecord], deterministicResult);

  return {
    observations_created: 1,
    verdict: deterministicResult.verdict,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Intent verification (deterministic only)
// ---------------------------------------------------------------------------

async function verifyIntent(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { surreal, workspaceRecord, entityId: intentId, entityBody: body } = input;
  const intentRecord = new RecordId("intent", intentId);

  const intentSignals = await gatherIntentSignals(surreal, intentId, body);
  const result = compareIntentCompletion(intentSignals);

  await persistObservation(surreal, workspaceRecord, [intentRecord as ObserveTargetRecord], result);

  return {
    observations_created: 1,
    verdict: result.verdict,
    evidence: [result.text],
  };
}

// ---------------------------------------------------------------------------
// Commit verification (deterministic only)
// ---------------------------------------------------------------------------

async function verifyCommit(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { surreal, workspaceRecord, entityId: commitId, entityBody: body } = input;
  const commitRecord = new RecordId("git_commit", commitId);

  const sha = (body?.sha as string) ?? "";
  const repository = (body?.repository as string) ?? "";

  const signal = await checkCiStatus({ id: commitRecord, sha, repository });
  const result = compareCommitStatus({ signals: [signal], hasCommits: true });

  await persistObservation(surreal, workspaceRecord, [commitRecord as ObserveTargetRecord], result);

  return {
    observations_created: 1,
    verdict: result.verdict,
    evidence: [result.text],
  };
}

// ---------------------------------------------------------------------------
// Decision verification (deterministic + LLM check against completed tasks)
// ---------------------------------------------------------------------------

async function verifyDecision(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { surreal, workspaceRecord, entityId: decisionId, entityBody: body, observerModel } = input;
  const decisionRecord = new RecordId("decision", decisionId);

  // Skip initial CREATE events — only verify status transitions
  if (!body?.updated_at) {
    log.info("observer.decision.skipped_create", "Skipping decision CREATE event", { decisionId });
    return { observations_created: 0, verdict: "inconclusive", evidence: ["Skipped: CREATE event"] };
  }

  const decisionSignals = await gatherDecisionSignals(surreal, workspaceRecord, body);
  const deterministicResult = compareDecisionConfirmation(decisionSignals);

  await persistObservation(surreal, workspaceRecord, [decisionRecord as ObserveTargetRecord], deterministicResult);
  let observationsCreated = 1;

  // LLM: when decision confirmed, check completed tasks against it (concurrent)
  if (observerModel && body?.status === "confirmed" && decisionSignals.completedTaskCount > 0) {
    const completedTasks = await queryCompletedTasks(surreal, workspaceRecord);

    // Build contexts concurrently, then run LLM calls concurrently
    const taskContexts = await Promise.all(
      completedTasks.map(async (task) => {
        const taskId = task.id.id as string;
        const taskBody = { title: task.title, description: task.description, status: "completed" };
        const context = await buildEntityContext(surreal, workspaceRecord, "task", taskId, taskBody);
        return { task, taskId, context };
      }),
    );

    const verdicts = await Promise.allSettled(
      taskContexts.map(({ context }) =>
        generateVerificationVerdict(observerModel, context, deterministicResult),
      ),
    );

    for (let i = 0; i < verdicts.length; i++) {
      const settled = verdicts[i];
      if (settled.status === "rejected") {
        log.info("observer.llm.error", "LLM verification failed for task", {
          taskId: taskContexts[i].taskId,
          error: String(settled.reason),
        });
        continue;
      }

      const llmVerdict = settled.value;
      if (!llmVerdict || llmVerdict.verdict !== "mismatch") continue;

      const finalVerdict = applyLlmVerdict(deterministicResult, llmVerdict);
      const taskRecord = new RecordId("task", taskContexts[i].taskId) as ObserveTargetRecord;

      // Dedup: skip if observer already has an open observation on this task
      const existing = await queryExistingObserverObservationsForEntity(
        surreal, workspaceRecord, taskRecord as RecordId<string, string>,
      );
      if (existing.length > 0) {
        log.info("observer.decision.dedup", "Skipping duplicate mismatch observation", {
          decisionId, taskId: taskContexts[i].taskId,
        });
        continue;
      }

      await persistObservation(surreal, workspaceRecord, [decisionRecord as ObserveTargetRecord, taskRecord], finalVerdict);
      observationsCreated += 1;
    }
  }

  return {
    observations_created: observationsCreated,
    verdict: deterministicResult.verdict,
    evidence: [deterministicResult.text],
  };
}

// ---------------------------------------------------------------------------
// Observation peer review (deterministic + LLM)
// ---------------------------------------------------------------------------

async function peerReviewObservation(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { surreal, workspaceRecord, entityId: observationId, entityBody: body, observerModel } = input;
  const observationRecord = new RecordId("observation", observationId);

  const linkedEntities = await loadObservationLinkedEntities(surreal, observationId);
  const peerReviewSignals = gatherPeerReviewSignals(body, linkedEntities.length);
  const deterministicResult = compareObservationPeerReview(peerReviewSignals);

  // LLM peer review when model available and observation has linked entities
  if (observerModel) {
    if (linkedEntities.length > 0) {
      const llmVerdict = await generatePeerReviewVerdict(
        observerModel,
        peerReviewSignals.originalText,
        peerReviewSignals.originalSeverity,
        peerReviewSignals.sourceAgent,
        linkedEntities,
      );

      if (llmVerdict) {
        const severity = llmVerdict.verdict === "sound" ? "info" as const
          : "warning" as const;

        const reviewResult: VerificationResult = {
          verdict: llmVerdict.verdict === "sound" ? "match" : llmVerdict.verdict === "unsupported" ? "mismatch" : "inconclusive",
          severity,
          verified: llmVerdict.verdict === "sound",
          text: llmVerdict.reasoning,
          source: "llm",
          confidence: llmVerdict.confidence,
          observationType: "validation",
          reasoning: llmVerdict.reasoning,
        };

        await persistObservation(surreal, workspaceRecord, [observationRecord as ObserveTargetRecord], reviewResult, "llm");

        return {
          observations_created: 1,
          verdict: reviewResult.verdict,
          evidence: [reviewResult.text],
        };
      }

      log.info("observer.llm.fallback", "LLM peer review failed, using deterministic", { observationId });
    } else {
      log.info("observer.llm.skip", "LLM peer review skipped: no linked entities", { observationId });
    }
  }

  // Deterministic fallback
  await persistObservation(surreal, workspaceRecord, [observationRecord as ObserveTargetRecord], deterministicResult, "peer_review");

  return {
    observations_created: 1,
    verdict: deterministicResult.verdict,
    evidence: [deterministicResult.text],
  };
}

// ---------------------------------------------------------------------------
// Signal gathering
// ---------------------------------------------------------------------------

async function gatherIntentSignals(
  surreal: Surreal,
  intentId: string,
  body?: Record<string, unknown>,
): Promise<IntentSignals> {
  const status = (body?.status as string) ?? "unknown";
  const goal = (body?.goal as string) ?? "Unknown intent";

  const intentRecord = new RecordId("intent", intentId);
  const [traceRows] = await surreal.query<[Array<{ trace_id?: RecordId }>]>(
    `SELECT trace_id FROM $intent;`,
    { intent: intentRecord },
  );

  return { status, goal, hasTrace: !!traceRows?.[0]?.trace_id };
}

async function gatherDecisionSignals(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  body?: Record<string, unknown>,
): Promise<DecisionSignals> {
  const status = (body?.status as string) ?? "unknown";
  const summary = (body?.summary as string) ?? "Unknown decision";

  const [taskRows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM task WHERE workspace = $ws AND status IN ["completed", "done"] GROUP ALL;`,
    { ws: workspaceRecord },
  );

  return { status, summary, completedTaskCount: taskRows?.[0]?.count ?? 0 };
}

function gatherPeerReviewSignals(
  body?: Record<string, unknown>,
  linkedEntityCount = 0,
): ObservationPeerReviewSignals {
  const originalText = (body?.text as string) ?? "Unknown observation";
  const originalSeverity = ((body?.severity as string) ?? "info") as "info" | "warning" | "conflict";
  const sourceAgent = (body?.source_agent as string) ?? "unknown_agent";

  return {
    originalText,
    originalSeverity,
    sourceAgent,
    linkedEntityCount,
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function loadWorkspaceSkipSetting(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<boolean | undefined> {
  const [rows] = await surreal.query<[Array<{ settings?: { observer_skip_deterministic?: boolean } }>]>(
    `SELECT settings FROM $ws;`,
    { ws: workspaceRecord },
  );
  return rows?.[0]?.settings?.observer_skip_deterministic;
}

async function queryCompletedTasks(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<Array<{ id: RecordId<"task">; title: string; description?: string }>> {
  const [rows] = await surreal.query<[Array<{
    id: RecordId<"task">;
    title: string;
    description?: string;
  }>]>(
    `SELECT id, title, description, updated_at FROM task
     WHERE workspace = $ws AND status IN ["completed", "done"]
     ORDER BY updated_at DESC
     LIMIT 20;`,
    { ws: workspaceRecord },
  );
  return rows ?? [];
}

async function loadObservationLinkedEntities(
  surreal: Surreal,
  observationId: string,
): Promise<Array<{ table: string; id: string; title: string; description?: string }>> {
  const observationRecord = new RecordId("observation", observationId);

  const [rows] = await surreal.query<[Array<{ out: RecordId }>]>(
    `SELECT out FROM observes WHERE in = $obs;`,
    { obs: observationRecord },
  );

  if (!rows || rows.length === 0) return [];

  const targets = rows.map((r) => r.out);

  const [details] = await surreal.query<[Array<{
    id: RecordId;
    title?: string; summary?: string; text?: string; description?: string;
  }>]>(
    `SELECT id, title, summary, text, description FROM $records;`,
    { records: targets },
  );

  return (details ?? []).map((d) => ({
    table: d.id.table.name,
    id: d.id.id as string,
    title: d.title ?? d.summary ?? d.text ?? "Unknown",
    description: d.description,
  }));
}

// ---------------------------------------------------------------------------
// Observation persistence
// ---------------------------------------------------------------------------

function extractDecisionRecords(evidenceRefs?: string[]): ObserveTargetRecord[] {
  if (!evidenceRefs) return [];
  const records: ObserveTargetRecord[] = [];
  for (const ref of evidenceRefs) {
    const parsed = parseEntityRef(ref);
    if (parsed && parsed.table === "decision") {
      records.push(new RecordId("decision", parsed.id) as ObserveTargetRecord);
    }
  }
  return records;
}

async function persistObservation(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  relatedRecords: ObserveTargetRecord[],
  result: VerificationResult,
  defaultSource = "none",
): Promise<void> {
  const now = new Date();

  // Convert evidence_refs strings to RecordId objects
  const evidenceRefRecords: RecordId[] = [];
  for (const ref of result.evidenceRefs ?? []) {
    const parsed = parseEntityRef(ref);
    if (parsed) evidenceRefRecords.push(new RecordId(parsed.table, parsed.id));
  }

  await createObservation({
    surreal,
    workspaceRecord,
    text: result.text,
    severity: result.severity,
    sourceAgent: "observer_agent",
    observationType: result.observationType ?? "validation",
    now,
    relatedRecords,
    confidence: result.confidence,
    evidenceRefs: evidenceRefRecords.length > 0 ? evidenceRefRecords : undefined,
    verified: result.verified,
    source: result.source ?? defaultSource,
    reasoning: result.reasoning,
  });
}

// ---------------------------------------------------------------------------
// Event-driven escalation: entity observation threshold -> diagnostic pipeline
// ---------------------------------------------------------------------------

const ESCALATION_THRESHOLD = 3;

/**
 * Counts open observer observations linked to a specific entity.
 * Uses two-step approach: graph traversal then filter.
 */
async function countEntityObserverObservations(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
): Promise<number> {
  const entityRecord = new RecordId(entityTable, entityId);

  const [obsIds] = await surreal.query<[Array<{ obs_id: RecordId }>]>(
    `SELECT in AS obs_id FROM observes WHERE out = $entity;`,
    { entity: entityRecord },
  );

  if (!obsIds || obsIds.length === 0) return 0;

  const obsRecords = obsIds.map((r) => r.obs_id);
  const [countRows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM $records
     WHERE source_agent = "observer_agent"
       AND status = "open"
     GROUP ALL;`,
    { records: obsRecords },
  );

  return countRows?.[0]?.count ?? 0;
}

/**
 * Event-driven escalation: after persisting an observation, checks if the
 * entity now has 3+ open observer observations. If so, runs the diagnostic
 * pipeline on workspace observations (entity-scoped cluster will emerge
 * naturally from the clustering algorithm).
 *
 * Deduplicates against pending learnings from observer in last 24h.
 */
export async function checkAndEscalate(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  entityTable: string,
  entityId: string,
  observerModel: LanguageModel,
  embeddingModel: EmbeddingModel,
  embeddingDimension: number,
): Promise<void> {
  try {
    // Count observer observations for this entity
    const observationCount = await countEntityObserverObservations(
      surreal, entityTable, entityId,
    );

    if (observationCount < ESCALATION_THRESHOLD) {
      return;
    }

    log.info("observer.escalation.threshold_met", "Entity observation threshold met, triggering diagnostic pipeline", {
      entityTable,
      entityId,
      observationCount,
    });

    // Dedup: skip if observer already has a pending learning proposal from last 24h.
    // Graph scan may have already proposed a learning for this pattern.
    const [recentPending] = await surreal.query<[Array<{ id: RecordId }>]>(
      `SELECT id FROM learning
       WHERE workspace = $ws
         AND source = "agent"
         AND suggested_by = "observer"
         AND status = "pending_approval"
         AND created_at > time::now() - 1d
       LIMIT 1;`,
      { ws: workspaceRecord },
    );

    if (recentPending && recentPending.length > 0) {
      log.info("observer.escalation.dedup_skip", "Skipping escalation — pending observer learning exists from last 24h", {
        entityTable,
        entityId,
        pendingLearningId: recentPending[0].id.id,
      });
      return;
    }

    // Run diagnostic pipeline -- clustering will naturally group
    // the entity's observations into a cluster
    await runDiagnosticClustering(
      surreal,
      workspaceRecord,
      observerModel,
      embeddingModel,
      embeddingDimension,
    );

    log.info("observer.escalation.completed", "Event-driven diagnostic pipeline completed", {
      entityTable,
      entityId,
    });
  } catch (error) {
    // Graceful failure -- escalation is best-effort, never crashes the agent
    log.error("observer.escalation.error", "Event-driven escalation failed gracefully", {
      entityTable,
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
