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
import type { LanguageModel } from "ai";
import { createObservation, type ObserveTargetRecord } from "../../observation/queries";
import { queryExistingObserverObservationsForEntity } from "../../observer/graph-scan";
import { logInfo } from "../../http/observability";
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
  observerModel?: LanguageModel;
};

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

export async function runObserverAgent(input: ObserverAgentInput): Promise<ObserverAgentOutput> {
  const { entityTable } = input;

  switch (entityTable) {
    case "task":
      return verifyTask(input);
    case "intent":
      return verifyIntent(input);
    case "git_commit":
      return verifyCommit(input);
    case "decision":
      return verifyDecision(input);
    case "observation":
      return peerReviewObservation(input);
    default:
      return {
        observations_created: 0,
        verdict: "inconclusive",
        evidence: [`Entity type '${entityTable}' verification not yet implemented`],
      };
  }
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
      logInfo("observer.llm.skip", "LLM skipped: deterministic match + CI passing", { taskId });
    } else {
      const context = await buildEntityContext(surreal, workspaceRecord, "task", taskId, body);

      // Only invoke LLM when there are decisions to check against.
      // Without decisions, semantic verification has nothing to compare --
      // the deterministic CI-based verdict should stand.
      if (context.relatedDecisions.length === 0) {
        logInfo("observer.llm.skip", "LLM skipped: no related decisions to verify against", { taskId });
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
    logInfo("observer.decision.skipped_create", "Skipping decision CREATE event", { decisionId });
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
        logInfo("observer.llm.error", "LLM verification failed for task", {
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
        logInfo("observer.decision.dedup", "Skipping duplicate mismatch observation", {
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
        };

        await persistObservation(surreal, workspaceRecord, [observationRecord as ObserveTargetRecord], reviewResult, "llm");

        return {
          observations_created: 1,
          verdict: reviewResult.verdict,
          evidence: [reviewResult.text],
        };
      }

      logInfo("observer.llm.fallback", "LLM peer review failed, using deterministic", { observationId });
    } else {
      logInfo("observer.llm.skip", "LLM peer review skipped: no linked entities", { observationId });
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
  });
}
