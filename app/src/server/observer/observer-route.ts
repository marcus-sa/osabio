/**
 * Observer HTTP route: POST /api/observe/:table/:id
 *
 * Effect shell that wires the verification pipeline to SurrealDB.
 * Called by SurrealDB EVENTs when entity state transitions occur.
 *
 * Pipeline: receiveEvent -> gatherSignals -> compareClaimVsReality -> persistObservation
 */

import { RecordId } from "surrealdb";
import { jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { createObservation } from "../observation/queries";
import { gatherTaskSignals } from "./external-signals";
import { compareTaskCompletion } from "./verification-pipeline";
import type { ServerDependencies } from "../runtime/types";

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
        case "git_commit":
        case "decision":
        case "observation":
          // Placeholder: future milestones will implement these
          logInfo("observer.event.skipped", "Observer event type not yet implemented", {
            table: supportedTable,
            id,
          });
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
  const taskRecord = new RecordId("task", taskId);

  // Pipeline: gather signals -> compare -> persist
  const signalsResult = await gatherTaskSignals(surreal, taskId);
  const verificationResult = compareTaskCompletion(signalsResult);

  const now = new Date();

  const observationRecord = await createObservation({
    surreal,
    workspaceRecord,
    text: verificationResult.text,
    severity: verificationResult.severity,
    sourceAgent: "observer_agent",
    observationType: "validation",
    now,
    relatedRecord: taskRecord,
  });

  // Set verified and source fields (not supported by createObservation directly)
  await surreal.query(
    `UPDATE $obs SET verified = $verified, source = $source;`,
    {
      obs: observationRecord,
      verified: verificationResult.verified,
      source: verificationResult.source ?? "none",
    },
  );

  logInfo("observer.task.verified", "Task verification complete", {
    taskId,
    verdict: verificationResult.verdict,
    severity: verificationResult.severity,
    verified: verificationResult.verified,
  });
}

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

async function resolveWorkspaceId(
  surreal: import("surrealdb").Surreal,
  table: string,
  id: string,
  body?: Record<string, unknown>,
): Promise<string | undefined> {
  // Try body first (SurrealDB EVENT passes the full record)
  if (body?.workspace) {
    const ws = body.workspace;
    // Could be a RecordId-like object or a string
    if (typeof ws === "string") {
      // Handle "workspace:uuid" format
      return ws.includes(":") ? ws.split(":")[1] : ws;
    }
    if (typeof ws === "object" && ws !== null) {
      const wsObj = ws as { id?: string | { String?: string } };
      if (typeof wsObj.id === "string") return wsObj.id;
      if (wsObj.id && typeof (wsObj.id as { String?: string }).String === "string") {
        return (wsObj.id as { String: string }).String;
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
