/**
 * Audit Provenance Chain API
 *
 * REST endpoints for audit trail: trace detail with full provenance chain,
 * date-range queries by project, and authorization compliance checks.
 *
 * Ports:
 *   GET /api/workspaces/:wsId/proxy/traces/:traceId  -> TraceDetail
 *   GET /api/workspaces/:wsId/proxy/traces?project=X&start=Y&end=Z -> TraceList
 *   GET /api/workspaces/:wsId/proxy/compliance?start=X&end=Y -> ComplianceSummary
 *
 * Pure core: compliance classification
 * Effect boundary: SurrealDB queries, HTTP responses
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import { jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProvenanceChain = {
  readonly workspace?: { readonly id: string; readonly name: string };
  readonly task?: { readonly id: string; readonly title: string };
  readonly session?: { readonly id: string };
  readonly policy?: { readonly id: string; readonly title: string; readonly decision: string };
};

type TraceDetail = {
  readonly id: string;
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_tokens: number;
  readonly cache_creation_tokens: number;
  readonly cost_usd: number;
  readonly latency_ms: number;
  readonly stop_reason: string;
  readonly created_at: string;
  readonly provenance: ProvenanceChain;
};

type TraceListItem = {
  readonly id: string;
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost_usd: number;
  readonly latency_ms: number;
  readonly created_at: string;
};

type ComplianceSummary = {
  readonly period: { readonly start: string; readonly end: string };
  readonly authorized_count: number;
  readonly unverified_count: number;
  readonly unverified_traces: ReadonlyArray<{
    readonly id: string;
    readonly model: string;
    readonly created_at: string;
  }>;
};

// ---------------------------------------------------------------------------
// Query: Trace Detail with Provenance
// ---------------------------------------------------------------------------

async function queryTraceWithProvenance(
  surreal: Surreal,
  workspaceId: string,
  traceId: string,
): Promise<TraceDetail | undefined> {
  const traceRecord = new RecordId("trace", traceId);
  const wsRecord = new RecordId("workspace", workspaceId);

  // Fetch trace base data with workspace check
  const traceResults = await surreal.query<[Array<{
    id: RecordId;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    cost_usd: number;
    latency_ms: number;
    stop_reason: string;
    created_at: string;
    session?: RecordId;
    workspace: RecordId;
  }>]>(
    `SELECT id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms, stop_reason, created_at, session, workspace FROM $trace;`,
    { trace: traceRecord },
  );

  const trace = traceResults[0]?.[0];
  if (!trace) return undefined;

  // Verify workspace ownership
  const traceWsId = trace.workspace?.id as string | undefined;
  if (traceWsId !== workspaceId) return undefined;

  // Fetch provenance edges
  const edgeResults = await surreal.query<[
    Array<{ tasks: RecordId[]; policies: Array<{ id: RecordId; decision: string }> }>,
  ]>(
    `SELECT
       ->attributed_to->task AS tasks,
       ->governed_by AS policy_edges
     FROM $trace;`,
    { trace: traceRecord },
  );

  const edges = edgeResults[0]?.[0];

  // Build provenance chain -- gather all linked entities
  const wsNameResults = await surreal.query<[Array<{ name: string }>]>(
    `SELECT name FROM $ws;`,
    { ws: wsRecord },
  );
  const wsName = wsNameResults[0]?.[0]?.name;

  const taskIds = edges?.tasks ?? [];
  let taskProvenance: { id: string; title: string } | undefined;
  if (taskIds.length > 0) {
    const firstTask = taskIds[0];
    const taskResults = await surreal.query<[Array<{ title: string }>]>(
      `SELECT title FROM $task;`,
      { task: firstTask },
    );
    taskProvenance = {
      id: firstTask.id as string,
      title: taskResults[0]?.[0]?.title ?? "",
    };
  }

  const policyEdgeResults = await surreal.query<[Array<{
    out: RecordId;
    decision: string;
  }>]>(
    `SELECT out, decision FROM governed_by WHERE in = $trace;`,
    { trace: traceRecord },
  );
  const policyEdge = policyEdgeResults[0]?.[0];
  let policyProvenance: { id: string; title: string; decision: string } | undefined;
  if (policyEdge) {
    const policyResults = await surreal.query<[Array<{ title: string }>]>(
      `SELECT title FROM $policy;`,
      { policy: policyEdge.out },
    );
    policyProvenance = {
      id: policyEdge.out.id as string,
      title: policyResults[0]?.[0]?.title ?? "",
      decision: policyEdge.decision,
    };
  }

  const provenance: ProvenanceChain = {
    ...(wsName ? { workspace: { id: workspaceId, name: wsName } } : {}),
    ...(taskProvenance ? { task: taskProvenance } : {}),
    ...(trace.session ? { session: { id: trace.session.id as string } } : {}),
    ...(policyProvenance ? { policy: policyProvenance } : {}),
  };

  return {
    id: traceId,
    model: trace.model,
    input_tokens: trace.input_tokens,
    output_tokens: trace.output_tokens,
    cache_read_tokens: trace.cache_read_tokens ?? 0,
    cache_creation_tokens: trace.cache_creation_tokens ?? 0,
    cost_usd: trace.cost_usd,
    latency_ms: trace.latency_ms,
    stop_reason: trace.stop_reason ?? "end_turn",
    created_at: typeof trace.created_at === "string"
      ? trace.created_at
      : new Date(trace.created_at).toISOString(),
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Query: Traces by Project + Date Range
// ---------------------------------------------------------------------------

async function queryTracesByProjectAndDateRange(
  surreal: Surreal,
  workspaceId: string,
  projectId: string,
  startDate: string,
  endDate: string,
): Promise<TraceListItem[]> {
  const wsRecord = new RecordId("workspace", workspaceId);
  const projectRecord = new RecordId("project", projectId);

  // Find tasks belonging to project
  const taskResults = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM task WHERE ->belongs_to->project CONTAINS $project;`,
    { project: projectRecord },
  );
  const taskRecords = (taskResults[0] ?? []).map(r => r.id);

  if (taskRecords.length === 0) return [];

  // Query traces attributed to those tasks within date range
  const startIso = new Date(startDate).toISOString();
  const endIso = new Date(endDate + "T23:59:59.999Z").toISOString();

  const traceResults = await surreal.query<[Array<{
    id: RecordId;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
    created_at: string;
    tasks: RecordId[];
  }>]>(
    `SELECT id, model, input_tokens, output_tokens, cost_usd, latency_ms, created_at, ->attributed_to->task AS tasks
     FROM trace
     WHERE workspace = $ws
       AND created_at >= <datetime>$start
       AND created_at <= <datetime>$end
     ORDER BY created_at DESC;`,
    { ws: wsRecord, start: startIso, end: endIso },
  );

  const traces = traceResults[0] ?? [];
  const taskIdSet = new Set(taskRecords.map(r => r.id as string));

  // Filter traces that are attributed to project tasks
  return traces
    .filter(t => {
      const traceTaskIds = (t.tasks ?? []).map(r => r.id as string);
      return traceTaskIds.some(id => taskIdSet.has(id));
    })
    .map(t => ({
      id: t.id.id as string,
      model: t.model,
      input_tokens: t.input_tokens,
      output_tokens: t.output_tokens,
      cost_usd: t.cost_usd,
      latency_ms: t.latency_ms,
      created_at: typeof t.created_at === "string"
        ? t.created_at
        : new Date(t.created_at).toISOString(),
    }));
}

// ---------------------------------------------------------------------------
// Query: Compliance Check
// ---------------------------------------------------------------------------

async function queryComplianceSummary(
  surreal: Surreal,
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<ComplianceSummary> {
  const wsRecord = new RecordId("workspace", workspaceId);
  const startIso = new Date(startDate).toISOString();
  const endIso = new Date(endDate + "T23:59:59.999Z").toISOString();

  // Get all traces in period
  const traceResults = await surreal.query<[Array<{
    id: RecordId;
    model: string;
    created_at: string;
  }>]>(
    `SELECT id, model, created_at
     FROM trace
     WHERE workspace = $ws
       AND created_at >= <datetime>$start
       AND created_at <= <datetime>$end
     ORDER BY created_at DESC;`,
    { ws: wsRecord, start: startIso, end: endIso },
  );

  const traces = traceResults[0] ?? [];

  // For each trace, check if governed_by edge exists
  const unverifiedTraces: Array<{ id: string; model: string; created_at: string }> = [];
  let authorizedCount = 0;

  for (const trace of traces) {
    const govResults = await surreal.query<[Array<{ id: RecordId }>]>(
      `SELECT id FROM governed_by WHERE in = $trace LIMIT 1;`,
      { trace: trace.id },
    );
    const hasPolicy = (govResults[0]?.length ?? 0) > 0;

    if (hasPolicy) {
      authorizedCount++;
    } else {
      unverifiedTraces.push({
        id: trace.id.id as string,
        model: trace.model,
        created_at: typeof trace.created_at === "string"
          ? trace.created_at
          : new Date(trace.created_at).toISOString(),
      });
    }
  }

  return {
    period: { start: startDate, end: endDate },
    authorized_count: authorizedCount,
    unverified_count: unverifiedTraces.length,
    unverified_traces: unverifiedTraces,
  };
}

// ---------------------------------------------------------------------------
// Route Handler Factory
// ---------------------------------------------------------------------------

export type AuditApiHandlers = {
  readonly handleTraceDetail: (workspaceId: string, traceId: string) => Promise<Response>;
  readonly handleTracesByProject: (workspaceId: string, url: URL) => Promise<Response>;
  readonly handleCompliance: (workspaceId: string, url: URL) => Promise<Response>;
};

export function createAuditApiHandlers(deps: ServerDependencies): AuditApiHandlers {
  const handleTraceDetail = async (workspaceId: string, traceId: string): Promise<Response> => {
    try {
      const detail = await queryTraceWithProvenance(deps.surreal, workspaceId, traceId);
      if (!detail) {
        return jsonResponse({ error: "trace_not_found" }, 404);
      }
      return jsonResponse(detail, 200);
    } catch (error) {
      log.error("proxy.audit.trace_detail_failed", "Failed to query trace detail", error);
      return jsonResponse({ error: "trace_detail_query_failed" }, 500);
    }
  };

  const handleTracesByProject = async (workspaceId: string, url: URL): Promise<Response> => {
    try {
      const projectId = url.searchParams.get("project");
      const startDate = url.searchParams.get("start");
      const endDate = url.searchParams.get("end");

      if (!projectId || !startDate || !endDate) {
        return jsonResponse(
          { error: "missing_params", message: "Required: project, start, end" },
          400,
        );
      }

      const traces = await queryTracesByProjectAndDateRange(
        deps.surreal,
        workspaceId,
        projectId,
        startDate,
        endDate,
      );

      return jsonResponse({ traces }, 200);
    } catch (error) {
      log.error("proxy.audit.traces_query_failed", "Failed to query traces by project", error);
      return jsonResponse({ error: "traces_query_failed" }, 500);
    }
  };

  const handleCompliance = async (workspaceId: string, url: URL): Promise<Response> => {
    try {
      const startDate = url.searchParams.get("start");
      const endDate = url.searchParams.get("end");

      if (!startDate || !endDate) {
        return jsonResponse(
          { error: "missing_params", message: "Required: start, end" },
          400,
        );
      }

      const summary = await queryComplianceSummary(
        deps.surreal,
        workspaceId,
        startDate,
        endDate,
      );

      return jsonResponse(summary, 200);
    } catch (error) {
      log.error("proxy.audit.compliance_check_failed", "Failed to run compliance check", error);
      return jsonResponse({ error: "compliance_check_failed" }, 500);
    }
  };

  return { handleTraceDetail, handleTracesByProject, handleCompliance };
}
