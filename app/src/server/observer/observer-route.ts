/**
 * Observer HTTP route: POST /api/observe/:table/:id
 *
 * Effect shell that wires the verification pipeline to SurrealDB.
 * Called by SurrealDB EVENTs when entity state transitions occur.
 *
 * Pipeline: receiveEvent -> gatherSignals -> compareClaimVsReality -> persistObservation
 */

import { RecordId, type Surreal } from "surrealdb";
import { jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { createObservation } from "../observation/queries";
import { checkCiStatus } from "./external-signals";
import { compareIntentCompletion, compareCommitStatus, compareDecisionConfirmation, compareObservationPeerReview } from "./verification-pipeline";
import type { IntentSignals, DecisionSignals, ObservationPeerReviewSignals, VerificationResult } from "./verification-pipeline";
import type { ServerDependencies } from "../runtime/types";
import { runObserverAgent } from "../agents/observer/agent";
import { runGraphScan } from "./graph-scan";

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
): Promise<void> {
  const now = new Date();

  const observationRecord = await createObservation({
    surreal,
    workspaceRecord,
    text: verificationResult.text,
    severity: verificationResult.severity,
    sourceAgent: "observer_agent",
    observationType: "validation",
    now,
    relatedRecord: relatedRecord as RecordId<"project" | "feature" | "task" | "decision" | "question", string>,
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

  // Delegate to observer agent
  const agentOutput = await runObserverAgent({
    surreal,
    workspaceRecord,
    entityTable: "task",
    entityId: taskId,
    entityBody: body,
  });

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
  // CREATE events have no updated_at field; UPDATE always sets updated_at via time::now().
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
  const verificationResult = compareDecisionConfirmation(decisionSignals);

  await persistVerificationObservation(surreal, workspaceRecord, decisionRecord, verificationResult);

  logInfo("observer.decision.verified", "Decision verification complete", {
    decisionId,
    verdict: verificationResult.verdict,
    severity: verificationResult.severity,
    verified: verificationResult.verified,
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
  const verificationResult = compareObservationPeerReview(peerReviewSignals);

  await persistVerificationObservation(surreal, workspaceRecord, originalObservationRecord, verificationResult, "peer_review");

  logInfo("observer.observation.peer_reviewed", "Observation peer review complete", {
    observationId,
    verdict: verificationResult.verdict,
    severity: verificationResult.severity,
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
      const result = await runGraphScan(deps.surreal, workspaceRecord);

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

async function resolveWorkspaceId(
  surreal: Surreal,
  table: string,
  id: string,
  body?: Record<string, unknown>,
): Promise<string | undefined> {
  // Try body first (SurrealDB EVENT passes the full record)
  if (body?.workspace) {
    const ws = body.workspace;
    // Could be a RecordId-like object or a string
    if (typeof ws === "string") {
      // Handle "workspace:uuid" format and strip backticks
      const cleaned = ws.replace(/`/g, "");
      return cleaned.includes(":") ? cleaned.split(":")[1] : cleaned;
    }
    if (typeof ws === "object" && ws !== null) {
      const wsObj = ws as { id?: string | { String?: string } };
      if (typeof wsObj.id === "string") return wsObj.id.replace(/`/g, "");
      if (wsObj.id && typeof (wsObj.id as { String?: string }).String === "string") {
        return (wsObj.id as { String: string }).String.replace(/`/g, "");
      }
    }
  }

  // Fallback: query the DB
  const record = new RecordId(table, id);
  const [rows] = await surreal.query<
    [Array<{ workspace: RecordId<"workspace", string> }>]
  >(
    `SELECT workspace FROM $record;`,
    { record },
  );

  const wsRecord = rows?.[0]?.workspace;
  return wsRecord ? (wsRecord.id as string) : undefined;
}
