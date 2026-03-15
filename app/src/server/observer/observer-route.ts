/**
 * Observer HTTP route: POST /api/observe/:table/:id
 *
 * Thin HTTP adapter. Parses request, resolves workspace, delegates to
 * the observer agent for all verification logic (deterministic + LLM).
 */

import { RecordId, type Surreal } from "surrealdb";
import type { LanguageModel } from "ai";
import { jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import type { ServerDependencies } from "../runtime/types";
import { runObserverAgent } from "../agents/observer/agent";
import { runGraphScan } from "./graph-scan";
import { analyzeTraceResponse } from "./trace-response-analyzer";
import { analyzeSessionTraces } from "./session-trace-analyzer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SUPPORTED_TABLES = new Set<string>([
  "task",
  "intent",
  "git_commit",
  "decision",
  "observation",
  "trace",
  "agent_session",
]);

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createObserverRouteHandler(deps: ServerDependencies) {
  return async (table: string, id: string, request: Request): Promise<Response> => {
    if (!SUPPORTED_TABLES.has(table)) {
      return jsonResponse({ error: "unsupported_table", table }, 400);
    }

    try {
      const body = await request.json().catch(() => undefined);

      logInfo("observer.event.received", "Observer event received", { table, id });

      // Resolve workspace
      const workspaceId = await resolveWorkspaceId(deps.surreal, table, id, body);
      if (!workspaceId) {
        logError("observer.event.no_workspace", "Cannot determine workspace", { table, id });
        return jsonResponse({ status: "ok" }, 200);
      }

      const workspaceRecord = new RecordId("workspace", workspaceId);

      // Session-end analysis: cross-trace pattern detection
      if (table === "agent_session") {
        const sessionResult = await analyzeSessionTraces({
          surreal: deps.surreal,
          workspaceRecord,
          sessionId: id,
          observerModel: deps.observerModel as LanguageModel,
        });

        logInfo("observer.session.verified", "Session trace analysis complete", {
          sessionId: id,
          observationsCreated: sessionResult.observations_created,
          skipped: sessionResult.skipped,
          reason: sessionResult.reason,
          tracesAnalyzed: sessionResult.traces_analyzed,
        });

        return jsonResponse({ status: "ok" }, 200);
      }

      // Trace analysis uses a specialized pipeline (embedding + KNN + LLM verification)
      if (table === "trace") {
        const traceResult = await analyzeTraceResponse({
          surreal: deps.surreal,
          workspaceRecord,
          traceId: id,
          traceBody: body,
          observerModel: deps.observerModel as LanguageModel,
          embeddingModel: deps.embeddingModel,
          embeddingDimension: deps.config.embeddingDimension,
        });

        logInfo("observer.trace.verified", "Trace analysis complete", {
          traceId: id,
          observationsCreated: traceResult.observations_created,
          skipped: traceResult.skipped,
          reason: traceResult.reason,
        });

        return jsonResponse({ status: "ok" }, 200);
      }

      // Delegate to observer agent for all other entity types
      const agentOutput = await runObserverAgent({
        surreal: deps.surreal,
        workspaceRecord,
        entityTable: table,
        entityId: id,
        entityBody: body,
        observerModel: deps.observerModel as LanguageModel,
      });

      logInfo(`observer.${table}.verified`, `${table} verification complete`, {
        [`${table}Id`]: id,
        verdict: agentOutput.verdict,
        observationsCreated: agentOutput.observations_created,
        evidence: agentOutput.evidence,
      });

      return jsonResponse({ status: "ok" }, 200);
    } catch (error) {
      logError("observer.event.error", "Observer event processing failed", error);
      // Return 200 to prevent SurrealDB EVENT retries for non-transient errors
      return jsonResponse({ status: "error", message: "processing failed" }, 200);
    }
  };
}

// ---------------------------------------------------------------------------
// Graph scan route handler factory
// ---------------------------------------------------------------------------

export function createGraphScanRouteHandler(deps: ServerDependencies) {
  return async (workspaceId: string, _request: Request): Promise<Response> => {
    try {
      logInfo("observer.scan.started", "Graph scan triggered", { workspaceId });

      const workspaceRecord = new RecordId("workspace", workspaceId);
      const result = await runGraphScan(
        deps.surreal,
        workspaceRecord,
        deps.observerModel as LanguageModel,
        deps.embeddingModel,
        deps.config.embeddingDimension,
      );

      return jsonResponse({ status: "ok", ...result }, 200);
    } catch (error) {
      logError("observer.scan.error", "Graph scan failed", error);
      return jsonResponse({ status: "error", message: "scan failed" }, 500);
    }
  };
}

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

// Workspace IDs may be UUIDs or prefixed slugs (e.g. test workspaces).
// Validate they contain only safe characters.
const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

async function resolveWorkspaceId(
  surreal: Surreal,
  table: string,
  id: string,
  body?: Record<string, unknown>,
): Promise<string | undefined> {
  let wsId: string | undefined;

  if (body?.workspace) {
    const ws = body.workspace;
    if (typeof ws === "string") {
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
    wsId = rows?.[0]?.workspace ? (rows[0].workspace.id as string) : undefined;
  }

  if (wsId && !WORKSPACE_ID_PATTERN.test(wsId)) {
    throw new Error(`Invalid workspace ID format: ${wsId}`);
  }

  return wsId;
}
