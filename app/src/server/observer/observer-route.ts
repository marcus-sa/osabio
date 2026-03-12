/**
 * Observer HTTP route: POST /api/observe/:table/:id
 *
 * Effect shell that wires the verification pipeline to SurrealDB.
 * Called by SurrealDB EVENTs when entity state transitions occur.
 *
 * Pipeline: receiveEvent -> gatherSignals -> compareClaimVsReality -> persistObservation
 */

import { RecordId, type Surreal } from "surrealdb";
import type { LanguageModel } from "ai";
import { jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { createObservation, type ObserveTargetRecord } from "../observation/queries";
import { checkCiStatus } from "./external-signals";
import { compareIntentCompletion, compareCommitStatus, compareDecisionConfirmation, compareObservationPeerReview, shouldSkipLlm, applyLlmVerdict } from "./verification-pipeline";
import type { IntentSignals, DecisionSignals, ObservationPeerReviewSignals, VerificationResult } from "./verification-pipeline";
import type { ServerDependencies } from "../runtime/types";
import { runObserverAgent } from "../agents/observer/agent";
import { runGraphScan } from "./graph-scan";
import { buildEntityContext } from "./context-loader";
import { generateVerificationVerdict, generatePeerReviewVerdict } from "./llm-reasoning";
import { parseEntityRef } from "./evidence-validator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SupportedTable = "task" | "intent" | "git_commit" | "decision" | "observation";

const SUPPORTED_TABLES = new Set<string>([
  "task",
  "intent",
  "git_commit",
  "decision",
  "observation",
]);

// ---------------------------------------------------------------------------
// Shared observation persistence
// ---------------------------------------------------------------------------

async function persistVerificationObservation(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  relatedRecord: RecordId,
  verificationResult: VerificationResult,
  defaultSource = "none",
  additionalRelatedRecords?: ObserveTargetRecord[],
): Promise<void> {
  const now = new Date();

  // Convert evidence_refs strings to RecordId objects
  const evidenceRefRecords: RecordId[] = [];
  for (const ref of verificationResult.evidenceRefs ?? []) {
    const parsed = parseEntityRef(ref);
    if (parsed) evidenceRefRecords.push(new RecordId(parsed.table, parsed.id));
  }

  const observationRecord = await createObservation({
    surreal,
    workspaceRecord,
    text: verificationResult.text,
    severity: verificationResult.severity,
    sourceAgent: "observer_agent",
    observationType: verificationResult.observationType ?? "validation",
    now,
    relatedRecord: relatedRecord as ObserveTargetRecord,
    relatedRecords: additionalRelatedRecords,
    confidence: verificationResult.confidence,
    evidenceRefs: evidenceRefRecords.length > 0 ? evidenceRefRecords : undefined,
  });

  await surreal.query(
    `UPDATE $obs SET verified = $verified, source = $source;`,
    {
      obs: observationRecord,
      verified: verificationResult.verified,
      source: verificationResult.source ?? defaultSource,
    },
  );
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createObserverRouteHandler(deps: ServerDependencies) {
  return async (table: string, id: string, request: Request): Promise<Response> => {
    if (!SUPPORTED_TABLES.has(table)) {
      return jsonResponse({ error: "unsupported_table", table }, 400);
    }

    const supportedTable = table as SupportedTable;

    try {
      // Parse the EVENT body (the record itself, posted by SurrealDB EVENT)
      const body = await request.json().catch(() => undefined);

      logInfo("observer.event.received", "Observer event received", {
        table: supportedTable,
        id,
      });

      // Dispatch to the appropriate verification pipeline
      switch (supportedTable) {
        case "task":
          await handleTaskVerification(deps, id, body);
          break;

        case "intent":
          await handleIntentVerification(deps, id, body);
          break;

        case "git_commit":
          await handleCommitVerification(deps, id, body);
          break;

        case "decision":
          await handleDecisionVerification(deps, id, body);
          break;

        case "observation":
          await handleObservationPeerReview(deps, id, body);
          break;
      }

      return jsonResponse({ status: "ok" }, 200);
    } catch (error) {
      logError("observer.event.error", "Observer event processing failed", error);
      // Return 200 to prevent SurrealDB EVENT retries for non-transient errors
      return jsonResponse({ status: "error", message: "processing failed" }, 200);
    }
  };
}

// ---------------------------------------------------------------------------
// Task verification pipeline (effect shell)
// ---------------------------------------------------------------------------

async function handleTaskVerification(
  deps: ServerDependencies,
  taskId: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const { surreal } = deps;

  // Resolve workspace from the task record body or by querying
  const workspaceId = await resolveWorkspaceId(surreal, "task", taskId, body);
  if (!workspaceId) {
    logError("observer.task.no_workspace", "Cannot determine workspace for task", { taskId });
    return;
  }

  const workspaceRecord = new RecordId("workspace", workspaceId);

  // Run deterministic verification via observer agent
  const agentOutput = await runObserverAgent({
    surreal,
    workspaceRecord,
    entityTable: "task",
    entityId: taskId,
    entityBody: body,
  });

  // LLM reasoning path (when observer model is configured)
  if (deps.observerModel) {
    const taskRecord = new RecordId("task", taskId);

    // Load workspace settings for skip optimization
    const skipDeterministic = await loadWorkspaceSkipSetting(surreal, workspaceRecord);

    // Build deterministic result from agent output for skip check
    const deterministicResult: VerificationResult = {
      verdict: agentOutput.verdict,
      severity: agentOutput.verdict === "mismatch" ? "conflict" : "info",
      verified: agentOutput.verdict === "match",
      text: agentOutput.evidence.join("; ") || "Deterministic verification complete",
    };

    if (shouldSkipLlm(deterministicResult, skipDeterministic)) {
      logInfo("observer.llm.skip", "LLM skipped: deterministic match + CI passing", { taskId });
    } else {
      const context = await buildEntityContext(surreal, workspaceRecord, "task", taskId, body);
      const llmVerdict = await generateVerificationVerdict(
        deps.observerModel as LanguageModel,
        context,
        deterministicResult,
      );

      const finalVerdict = applyLlmVerdict(deterministicResult, llmVerdict);

      // Build related records: task + any contradicted decisions
      const additionalRecords: ObserveTargetRecord[] = [];
      if (llmVerdict?.verdict === "mismatch" && llmVerdict.evidence_refs) {
        for (const ref of llmVerdict.evidence_refs) {
          const parsed = parseEntityRef(ref);
          if (parsed && parsed.table === "decision") {
            additionalRecords.push(new RecordId("decision", parsed.id) as ObserveTargetRecord);
          }
        }
      }

      await persistVerificationObservation(
        surreal, workspaceRecord, taskRecord, finalVerdict, "none", additionalRecords,
      );
    }
  }

  logInfo("observer.task.verified", "Task verification complete", {
    taskId,
    verdict: agentOutput.verdict,
    observationsCreated: agentOutput.observations_created,
    evidence: agentOutput.evidence,
  });
}

// ---------------------------------------------------------------------------
// Intent verification pipeline (effect shell)
// ---------------------------------------------------------------------------

async function handleIntentVerification(
  deps: ServerDependencies,
  intentId: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const { surreal } = deps;

  const workspaceId = await resolveWorkspaceId(surreal, "intent", intentId, body);
  if (!workspaceId) {
    logError("observer.intent.no_workspace", "Cannot determine workspace for intent", { intentId });
    return;
  }

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const intentRecord = new RecordId("intent", intentId);

  // Gather intent signals: status and trace presence
  const intentSignals = await gatherIntentSignals(surreal, intentId, body);
  const verificationResult = compareIntentCompletion(intentSignals);

  await persistVerificationObservation(surreal, workspaceRecord, intentRecord, verificationResult);

  logInfo("observer.intent.verified", "Intent verification complete", {
    intentId,
    verdict: verificationResult.verdict,
    severity: verificationResult.severity,
    verified: verificationResult.verified,
  });
}

async function gatherIntentSignals(
  surreal: Surreal,
  intentId: string,
  body?: Record<string, unknown>,
): Promise<IntentSignals> {
  // Prefer body (from EVENT payload) for status and goal
  const status = (body?.status as string) ?? "unknown";
  const goal = (body?.goal as string) ?? "Unknown intent";

  // Check if a trace exists
  const intentRecord = new RecordId("intent", intentId);
  const [traceRows] = await surreal.query<[Array<{ trace_id?: RecordId }>]>(
    `SELECT trace_id FROM $intent;`,
    { intent: intentRecord },
  );

  const hasTrace = !!traceRows?.[0]?.trace_id;

  return { status, goal, hasTrace };
}

// ---------------------------------------------------------------------------
// Commit verification pipeline (effect shell)
// ---------------------------------------------------------------------------

async function handleCommitVerification(
  deps: ServerDependencies,
  commitId: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const { surreal } = deps;

  const workspaceId = await resolveWorkspaceId(surreal, "git_commit", commitId, body);
  if (!workspaceId) {
    logError("observer.commit.no_workspace", "Cannot determine workspace for commit", { commitId });
    return;
  }

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const commitRecord = new RecordId("git_commit", commitId);

  // Gather CI signals for this commit
  const sha = (body?.sha as string) ?? "";
  const repository = (body?.repository as string) ?? "";

  const signal = await checkCiStatus({
    id: commitRecord,
    sha,
    repository,
  });

  const signalsResult = {
    signals: [signal],
    hasCommits: true,
  };

  const verificationResult = compareCommitStatus(signalsResult);

  await persistVerificationObservation(surreal, workspaceRecord, commitRecord, verificationResult);

  logInfo("observer.commit.verified", "Commit verification complete", {
    commitId,
    verdict: verificationResult.verdict,
    severity: verificationResult.severity,
    verified: verificationResult.verified,
  });
}

// ---------------------------------------------------------------------------
// Decision verification pipeline (effect shell)
// ---------------------------------------------------------------------------

async function handleDecisionVerification(
  deps: ServerDependencies,
  decisionId: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const { surreal } = deps;

  // Skip initial CREATE events -- only verify actual status transitions (UPDATEs).
  if (!body?.updated_at) {
    logInfo("observer.decision.skipped_create", "Skipping decision CREATE event (not a status transition)", { decisionId });
    return;
  }

  const workspaceId = await resolveWorkspaceId(surreal, "decision", decisionId, body);
  if (!workspaceId) {
    logError("observer.decision.no_workspace", "Cannot determine workspace for decision", { decisionId });
    return;
  }

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const decisionRecord = new RecordId("decision", decisionId);

  // Gather decision signals: status, summary, and completed task count
  const decisionSignals = await gatherDecisionSignals(surreal, workspaceRecord, body);
  const deterministicResult = compareDecisionConfirmation(decisionSignals);

  await persistVerificationObservation(surreal, workspaceRecord, decisionRecord, deterministicResult);

  // LLM reasoning: when decision confirmed, check completed tasks against it
  if (deps.observerModel && body?.status === "confirmed" && decisionSignals.completedTaskCount > 0) {
    const completedTasks = await queryCompletedTasksForDecision(surreal, workspaceRecord);

    for (const task of completedTasks) {
      const taskId = task.id.id as string;
      const taskBody = { title: task.title, description: task.description, status: "completed" };
      const context = await buildEntityContext(surreal, workspaceRecord, "task", taskId, taskBody);
      const llmVerdict = await generateVerificationVerdict(
        deps.observerModel as LanguageModel,
        context,
        deterministicResult,
      );

      if (!llmVerdict || llmVerdict.verdict !== "mismatch") continue;

      const finalVerdict = applyLlmVerdict(deterministicResult, llmVerdict);
      const taskRecord = new RecordId("task", taskId) as ObserveTargetRecord;

      await persistVerificationObservation(
        surreal, workspaceRecord, decisionRecord, finalVerdict, "none", [taskRecord],
      );
    }
  }

  logInfo("observer.decision.verified", "Decision verification complete", {
    decisionId,
    verdict: deterministicResult.verdict,
    severity: deterministicResult.severity,
    verified: deterministicResult.verified,
  });
}

// ---------------------------------------------------------------------------
// Observation peer review pipeline (effect shell)
// ---------------------------------------------------------------------------

async function handleObservationPeerReview(
  deps: ServerDependencies,
  observationId: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const { surreal } = deps;

  const workspaceId = await resolveWorkspaceId(surreal, "observation", observationId, body);
  if (!workspaceId) {
    logError("observer.observation.no_workspace", "Cannot determine workspace for observation", { observationId });
    return;
  }

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const originalObservationRecord = new RecordId("observation", observationId);

  // Gather peer review signals from the original observation and workspace context
  const peerReviewSignals = await gatherObservationPeerReviewSignals(surreal, workspaceRecord, body);
  const deterministicResult = compareObservationPeerReview(peerReviewSignals);

  // LLM peer review: evaluate evidence quality when model configured and observation has linked entities
  if (deps.observerModel) {
    const linkedEntities = await loadObservationLinkedEntities(surreal, observationId);

    if (linkedEntities.length > 0) {
      const originalText = (body?.text as string) ?? "Unknown observation";
      const originalSeverity = (body?.severity as string) ?? "info";
      const sourceAgent = (body?.source_agent as string) ?? "unknown_agent";

      const llmVerdict = await generatePeerReviewVerdict(
        deps.observerModel as LanguageModel,
        originalText,
        originalSeverity,
        sourceAgent,
        linkedEntities,
      );

      if (llmVerdict) {
        // Map peer review verdict to verification result
        const severity = llmVerdict.verdict === "unsupported" ? "warning" as const
          : llmVerdict.verdict === "questionable" ? "info" as const
          : "info" as const;

        const reviewResult: VerificationResult = {
          verdict: llmVerdict.verdict === "sound" ? "match" : llmVerdict.verdict === "unsupported" ? "mismatch" : "inconclusive",
          severity,
          verified: llmVerdict.verdict === "sound",
          text: llmVerdict.reasoning,
          source: "llm",
          confidence: llmVerdict.confidence,
          observationType: "validation",
        };

        await persistVerificationObservation(
          surreal, workspaceRecord, originalObservationRecord, reviewResult, "llm",
        );

        logInfo("observer.observation.llm_peer_reviewed", "LLM peer review complete", {
          observationId,
          verdict: llmVerdict.verdict,
          confidence: llmVerdict.confidence,
        });
        return;
      }
      // LLM failed — fall through to deterministic
      logInfo("observer.llm.fallback", "LLM peer review failed, using deterministic", { observationId });
    } else {
      logInfo("observer.llm.skip", "LLM peer review skipped: no linked entities", { observationId });
    }
  }

  // Deterministic fallback
  await persistVerificationObservation(surreal, workspaceRecord, originalObservationRecord, deterministicResult, "peer_review");

  logInfo("observer.observation.peer_reviewed", "Observation peer review complete", {
    observationId,
    verdict: deterministicResult.verdict,
    severity: deterministicResult.severity,
  });
}

async function gatherObservationPeerReviewSignals(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  body?: Record<string, unknown>,
): Promise<ObservationPeerReviewSignals> {
  const originalText = (body?.text as string) ?? "Unknown observation";
  const originalSeverity = ((body?.severity as string) ?? "info") as "info" | "warning" | "conflict";
  const sourceAgent = (body?.source_agent as string) ?? "unknown_agent";

  // Count tasks and decisions in the workspace for cross-checking context
  const [taskRows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM task WHERE workspace = $ws GROUP ALL;`,
    { ws: workspaceRecord },
  );

  const [decisionRows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM decision WHERE workspace = $ws GROUP ALL;`,
    { ws: workspaceRecord },
  );

  return {
    originalText,
    originalSeverity,
    sourceAgent,
    relatedTaskCount: taskRows?.[0]?.count ?? 0,
    relatedDecisionCount: decisionRows?.[0]?.count ?? 0,
  };
}

async function gatherDecisionSignals(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  body?: Record<string, unknown>,
): Promise<DecisionSignals> {
  const status = (body?.status as string) ?? "unknown";
  const summary = (body?.summary as string) ?? "Unknown decision";

  // Count completed tasks in the workspace
  const [taskRows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM task WHERE workspace = $ws AND (status = "completed" OR status = "done") GROUP ALL;`,
    { ws: workspaceRecord },
  );

  const completedTaskCount = taskRows?.[0]?.count ?? 0;

  return { status, summary, completedTaskCount };
}

// ---------------------------------------------------------------------------
// Graph scan route handler factory
// ---------------------------------------------------------------------------

export function createGraphScanRouteHandler(deps: ServerDependencies) {
  return async (workspaceId: string, _request: Request): Promise<Response> => {
    try {
      logInfo("observer.scan.started", "Graph scan triggered", { workspaceId });

      const workspaceRecord = new RecordId("workspace", workspaceId);
      const result = await runGraphScan(deps.surreal, workspaceRecord, deps.observerModel as LanguageModel | undefined);

      return jsonResponse({
        status: "ok",
        ...result,
      }, 200);
    } catch (error) {
      logError("observer.scan.error", "Graph scan failed", error);
      return jsonResponse({ status: "error", message: "scan failed" }, 500);
    }
  };
}

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveWorkspaceId(
  surreal: Surreal,
  table: string,
  id: string,
  body?: Record<string, unknown>,
): Promise<string | undefined> {
  // Try body first (SurrealDB EVENT passes the full record)
  let wsId: string | undefined;

  if (body?.workspace) {
    const ws = body.workspace;
    // Could be a RecordId-like object or a string
    if (typeof ws === "string") {
      // Handle "workspace:uuid" format and strip backticks
      const cleaned = ws.replace(/`/g, "");
      wsId = cleaned.includes(":") ? cleaned.split(":")[1] : cleaned;
    } else if (typeof ws === "object" && ws !== null) {
      const wsObj = ws as { id?: string | { String?: string } };
      if (typeof wsObj.id === "string") wsId = wsObj.id.replace(/`/g, "");
      else if (wsObj.id && typeof (wsObj.id as { String?: string }).String === "string") {
        wsId = (wsObj.id as { String: string }).String.replace(/`/g, "");
      }
    }
  }

  // Fallback: query the DB
  if (!wsId) {
    const record = new RecordId(table, id);
    const [rows] = await surreal.query<
      [Array<{ workspace: RecordId<"workspace", string> }>]
    >(
      `SELECT workspace FROM $record;`,
      { record },
    );

    const wsRecord = rows?.[0]?.workspace;
    wsId = wsRecord ? (wsRecord.id as string) : undefined;
  }

  if (wsId && !UUID_PATTERN.test(wsId)) {
    throw new Error(`Invalid workspace ID format: ${wsId}`);
  }

  return wsId;
}

// ---------------------------------------------------------------------------
// LLM helper: load workspace skip optimization setting
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

// ---------------------------------------------------------------------------
// LLM helper: load completed tasks for decision verification
// ---------------------------------------------------------------------------

async function queryCompletedTasksForDecision(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<Array<{ id: RecordId<"task">; title: string; description?: string }>> {
  const [rows] = await surreal.query<[Array<{
    id: RecordId<"task">;
    title: string;
    description?: string;
  }>]>(
    `SELECT id, title, description FROM task
     WHERE workspace = $ws AND status IN ["completed", "done"]
     ORDER BY updated_at DESC
     LIMIT 20;`,
    { ws: workspaceRecord },
  );
  return rows ?? [];
}

// ---------------------------------------------------------------------------
// LLM helper: load entities linked to an observation via observes edges
// ---------------------------------------------------------------------------

async function loadObservationLinkedEntities(
  surreal: Surreal,
  observationId: string,
): Promise<Array<{ table: string; id: string; title: string; description?: string }>> {
  const observationRecord = new RecordId("observation", observationId);

  const [rows] = await surreal.query<[Array<{
    out: RecordId;
  }>]>(
    `SELECT out FROM observes WHERE in = $obs;`,
    { obs: observationRecord },
  );

  if (!rows || rows.length === 0) return [];

  const entities: Array<{ table: string; id: string; title: string; description?: string }> = [];

  for (const row of rows) {
    const targetTable = row.out.table.name;
    const targetId = row.out.id as string;
    const targetRecord = new RecordId(targetTable, targetId);

    const [details] = await surreal.query<[Array<{
      title?: string;
      summary?: string;
      text?: string;
      description?: string;
    }>]>(
      `SELECT title, summary, text, description FROM $record;`,
      { record: targetRecord },
    );

    const detail = details?.[0];
    entities.push({
      table: targetTable,
      id: targetId,
      title: detail?.title ?? detail?.summary ?? detail?.text ?? "Unknown",
      description: detail?.description,
    });
  }

  return entities;
}
