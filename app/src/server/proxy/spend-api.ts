/**
 * Spend Monitoring Dashboard API
 *
 * REST endpoints for workspace spend overview and session breakdown.
 * Includes anomaly detection (sessions exceeding 2x average call rate)
 * and budget threshold alerts (default 80%).
 *
 * Ports:
 *   GET /api/workspaces/:wsId/proxy/spend   -> SpendOverview
 *   GET /api/workspaces/:wsId/proxy/sessions -> SessionBreakdown
 *
 * Pure core: aggregation transforms, anomaly detection, budget checking
 * Effect boundary: SurrealDB queries, observation writes
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import { jsonResponse } from "../http/response";
import { logInfo, logError, logWarn } from "../http/observability";
import type { ServerDependencies } from "../runtime/types";

// ---------------------------------------------------------------------------
// Retry with Exponential Backoff (for SurrealDB transaction conflicts)
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        logWarn("proxy.spend.retry", `Retry ${attempt + 1}/${MAX_RETRIES} for ${label}`, {
          attempt: attempt + 1,
          delay_ms: delayMs,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectSpendRow = {
  readonly project_id: string;
  readonly project_name: string;
  readonly today_spend: number;
  readonly mtd_spend: number;
  readonly call_count: number;
};

type SpendOverview = {
  readonly total_spend: number;
  readonly daily_budget?: number;
  readonly budget_progress_pct?: number;
  readonly projects: ProjectSpendRow[];
};

type SessionRow = {
  readonly session_id: string;
  readonly total_cost: number;
  readonly primary_model: string;
  readonly call_count: number;
  readonly duration_ms: number;
};

type SessionBreakdown = {
  readonly sessions: SessionRow[];
};

// ---------------------------------------------------------------------------
// Spend Cache (per-instance, injected)
// ---------------------------------------------------------------------------

type SpendCacheEntry = {
  readonly data: SpendOverview;
  readonly fetchedAt: number;
};

type SpendApiCache = Map<string, SpendCacheEntry>;

const SPEND_CACHE_TTL_MS = 10_000; // 10 seconds

// ---------------------------------------------------------------------------
// Pure: Anomaly Detection
// ---------------------------------------------------------------------------

type SessionCallCount = {
  readonly sessionId: string;
  readonly callCount: number;
};

function detectAnomalySessions(
  sessionCounts: readonly SessionCallCount[],
): readonly SessionCallCount[] {
  if (sessionCounts.length < 2) return [];

  const totalCalls = sessionCounts.reduce((sum, s) => sum + s.callCount, 0);
  const averageCalls = totalCalls / sessionCounts.length;
  const threshold = averageCalls * 2;

  return sessionCounts.filter(s => s.callCount > threshold);
}

// ---------------------------------------------------------------------------
// Pure: Budget Threshold Check
// ---------------------------------------------------------------------------

const DEFAULT_ALERT_THRESHOLD = 0.80;

type BudgetCheckResult =
  | { readonly exceeded: false }
  | { readonly exceeded: true; readonly currentSpend: number; readonly budget: number; readonly pct: number };

function checkBudgetThreshold(
  totalSpend: number,
  dailyBudget: number | undefined,
): BudgetCheckResult {
  if (dailyBudget === undefined || dailyBudget <= 0) {
    return { exceeded: false };
  }

  const pct = totalSpend / dailyBudget;
  if (pct >= DEFAULT_ALERT_THRESHOLD) {
    return { exceeded: true, currentSpend: totalSpend, budget: dailyBudget, pct };
  }

  return { exceeded: false };
}

// ---------------------------------------------------------------------------
// Query: Workspace Total Spend (today)
// ---------------------------------------------------------------------------

async function queryTodayTotalSpend(
  surreal: Surreal,
  workspaceId: string,
): Promise<number> {
  const ws = new RecordId("workspace", workspaceId);
  const results = await surreal.query<[Array<{ cost_usd: number }>]>(
    `SELECT cost_usd FROM trace WHERE workspace = $ws AND created_at >= time::floor(time::now(), 1d);`,
    { ws },
  );
  const rows = results[0] ?? [];
  return rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Query: Daily Budget
// ---------------------------------------------------------------------------

async function queryDailyBudget(
  surreal: Surreal,
  workspaceId: string,
): Promise<number | undefined> {
  const ws = new RecordId("workspace", workspaceId);
  const results = await surreal.query<[Array<{ daily_budget_usd?: number }>]>(
    `SELECT daily_budget_usd FROM $ws;`,
    { ws },
  );
  return results[0]?.[0]?.daily_budget_usd;
}

// ---------------------------------------------------------------------------
// Query: Per-Project Breakdown
// ---------------------------------------------------------------------------

async function queryProjectBreakdown(
  surreal: Surreal,
  workspaceId: string,
): Promise<ProjectSpendRow[]> {
  const ws = new RecordId("workspace", workspaceId);

  // Get all traces for workspace today, with their task->project attribution
  const results = await surreal.query<[Array<{
    cost_usd: number;
    task_projects: RecordId[];
    created_at: string;
  }>]>(
    `SELECT cost_usd, ->attributed_to->task->belongs_to->project AS task_projects, created_at
     FROM trace
     WHERE workspace = $ws AND created_at >= time::floor(time::now(), 30d)
     ORDER BY created_at DESC;`,
    { ws },
  );

  const traces = results[0] ?? [];
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // Aggregate by project
  const projectMap = new Map<string, {
    name: string;
    todaySpend: number;
    mtdSpend: number;
    callCount: number;
  }>();

  // Track unattributed
  let unattributedTodaySpend = 0;
  let unattributedMtdSpend = 0;
  let unattributedCallCount = 0;

  for (const trace of traces) {
    const traceDate = new Date(trace.created_at);
    const isToday = traceDate >= todayStart;
    const isMtd = traceDate >= monthStart;
    const projects = trace.task_projects ?? [];

    if (projects.length === 0) {
      // Unattributed
      if (isToday) {
        unattributedTodaySpend += trace.cost_usd;
        unattributedCallCount++;
      }
      if (isMtd) {
        unattributedMtdSpend += trace.cost_usd;
      }
    } else {
      for (const projectRecord of projects) {
        const projectId = projectRecord.id as string;
        const existing = projectMap.get(projectId) ?? {
          name: projectId,
          todaySpend: 0,
          mtdSpend: 0,
          callCount: 0,
        };

        if (isToday) {
          existing.todaySpend += trace.cost_usd;
          existing.callCount++;
        }
        if (isMtd) {
          existing.mtdSpend += trace.cost_usd;
        }

        projectMap.set(projectId, existing);
      }
    }
  }

  // Fetch project names
  const projectRows: ProjectSpendRow[] = [];
  for (const [projectId, data] of projectMap) {
    try {
      const projectRecord = new RecordId("project", projectId);
      const nameResults = await surreal.query<[Array<{ name: string }>]>(
        `SELECT name FROM $project;`,
        { project: projectRecord },
      );
      const name = nameResults[0]?.[0]?.name ?? projectId;
      projectRows.push({
        project_id: projectId,
        project_name: name,
        today_spend: data.todaySpend,
        mtd_spend: data.mtdSpend,
        call_count: data.callCount,
      });
    } catch {
      projectRows.push({
        project_id: projectId,
        project_name: projectId,
        today_spend: data.todaySpend,
        mtd_spend: data.mtdSpend,
        call_count: data.callCount,
      });
    }
  }

  // Add unattributed if any
  if (unattributedCallCount > 0 || unattributedMtdSpend > 0) {
    projectRows.push({
      project_id: "unattributed",
      project_name: "Unattributed",
      today_spend: unattributedTodaySpend,
      mtd_spend: unattributedMtdSpend,
      call_count: unattributedCallCount,
    });
  }

  // Sort by today_spend DESC
  projectRows.sort((a, b) => b.today_spend - a.today_spend);

  return projectRows;
}

// ---------------------------------------------------------------------------
// Query: Per-Session Breakdown
// ---------------------------------------------------------------------------

async function querySessionBreakdown(
  surreal: Surreal,
  workspaceId: string,
): Promise<SessionRow[]> {
  const ws = new RecordId("workspace", workspaceId);

  // Get all traces with session field for this workspace
  const results = await surreal.query<[Array<{
    cost_usd: number;
    model: string;
    latency_ms: number;
    session: RecordId | undefined;
    created_at: string;
  }>]>(
    `SELECT cost_usd, model, latency_ms, session, created_at
     FROM trace
     WHERE workspace = $ws AND session IS NOT NONE
     ORDER BY created_at DESC;`,
    { ws },
  );

  const traces = results[0] ?? [];

  // Aggregate by session
  const sessionMap = new Map<string, {
    totalCost: number;
    models: Map<string, number>;
    callCount: number;
    minCreatedAt: number;
    maxCreatedAt: number;
  }>();

  for (const trace of traces) {
    if (!trace.session) continue;
    const sessionId = trace.session.id as string;
    const existing = sessionMap.get(sessionId) ?? {
      totalCost: 0,
      models: new Map(),
      callCount: 0,
      minCreatedAt: Infinity,
      maxCreatedAt: 0,
    };

    existing.totalCost += trace.cost_usd;
    existing.callCount++;
    existing.models.set(
      trace.model,
      (existing.models.get(trace.model) ?? 0) + 1,
    );

    const traceTime = new Date(trace.created_at).getTime();
    existing.minCreatedAt = Math.min(existing.minCreatedAt, traceTime);
    existing.maxCreatedAt = Math.max(existing.maxCreatedAt, traceTime);

    sessionMap.set(sessionId, existing);
  }

  // Convert to rows
  const sessionRows: SessionRow[] = [];
  for (const [sessionId, data] of sessionMap) {
    // Primary model = most used model
    let primaryModel = "unknown";
    let maxCount = 0;
    for (const [model, count] of data.models) {
      if (count > maxCount) {
        maxCount = count;
        primaryModel = model;
      }
    }

    const durationMs = data.maxCreatedAt > data.minCreatedAt
      ? data.maxCreatedAt - data.minCreatedAt
      : 0;

    sessionRows.push({
      session_id: sessionId,
      total_cost: data.totalCost,
      primary_model: primaryModel,
      call_count: data.callCount,
      duration_ms: durationMs,
    });
  }

  // Sort by cost DESC
  sessionRows.sort((a, b) => b.total_cost - a.total_cost);

  return sessionRows;
}

// ---------------------------------------------------------------------------
// Query: Session Call Counts (for anomaly detection)
// ---------------------------------------------------------------------------

async function querySessionCallCounts(
  surreal: Surreal,
  workspaceId: string,
): Promise<SessionCallCount[]> {
  const ws = new RecordId("workspace", workspaceId);

  // Get traces with session field for today
  const results = await surreal.query<[Array<{
    session: RecordId | undefined;
  }>]>(
    `SELECT session
     FROM trace
     WHERE workspace = $ws AND session IS NOT NONE AND created_at >= time::floor(time::now(), 1d);`,
    { ws },
  );

  const traces = results[0] ?? [];
  const sessionCounts = new Map<string, number>();

  for (const trace of traces) {
    if (!trace.session) continue;
    const sessionId = trace.session.id as string;
    sessionCounts.set(sessionId, (sessionCounts.get(sessionId) ?? 0) + 1);
  }

  return Array.from(sessionCounts.entries()).map(([sessionId, callCount]) => ({
    sessionId,
    callCount,
  }));
}

// ---------------------------------------------------------------------------
// Observation Writers (async, fire-and-forget)
// ---------------------------------------------------------------------------

async function createAnomalyObservation(
  surreal: Surreal,
  workspaceId: string,
  session: SessionCallCount,
  averageCalls: number,
): Promise<void> {
  const observationId = `obs-${crypto.randomUUID()}`;
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await withRetry(() =>
    surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: observationRecord,
      content: {
        text: `Session ${session.sessionId} has ${session.callCount} LLM calls today, which is ${(session.callCount / averageCalls).toFixed(1)}x the average of ${averageCalls.toFixed(0)} calls per session. This may indicate runaway agent behavior or an infinite loop.`,
        severity: "warning",
        status: "open",
        observation_type: "anomaly",
        source_agent: "llm-proxy",
        workspace: workspaceRecord,
        data: { subtype: "proxy_anomaly_call_rate" },
        created_at: new Date(),
      },
    }),
    "anomaly_observation_create",
  );
}

async function createBudgetThresholdObservation(
  surreal: Surreal,
  workspaceId: string,
  currentSpend: number,
  budget: number,
  pct: number,
): Promise<void> {
  const observationId = `obs-${crypto.randomUUID()}`;
  const observationRecord = new RecordId("observation", observationId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await withRetry(() =>
    surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: observationRecord,
      content: {
        text: `Daily spend has reached $${currentSpend.toFixed(2)} (${(pct * 100).toFixed(0)}% of $${budget.toFixed(2)} budget). Consider reviewing active agent sessions or adjusting the daily budget limit.`,
        severity: "warning",
        status: "open",
        observation_type: "anomaly",
        source_agent: "llm-proxy",
        workspace: workspaceRecord,
        data: { subtype: "proxy_budget_threshold" },
        created_at: new Date(),
      },
    }),
    "budget_threshold_observation_create",
  );
}

// ---------------------------------------------------------------------------
// Check if observation already exists today (dedup)
// ---------------------------------------------------------------------------

async function hasObservationToday(
  surreal: Surreal,
  workspaceId: string,
  subtype: string,
): Promise<boolean> {
  const ws = new RecordId("workspace", workspaceId);
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM observation WHERE workspace = $ws AND source_agent = 'llm-proxy' AND data.subtype = $subtype AND created_at >= time::floor(time::now(), 1d) LIMIT 1;`,
    { ws, subtype },
  );
  return (results[0]?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Spend Handler (composing queries + anomaly + budget checks)
// ---------------------------------------------------------------------------

async function buildSpendOverview(
  surreal: Surreal,
  workspaceId: string,
): Promise<SpendOverview> {
  const [totalSpend, dailyBudget, projects] = await Promise.all([
    queryTodayTotalSpend(surreal, workspaceId),
    queryDailyBudget(surreal, workspaceId),
    queryProjectBreakdown(surreal, workspaceId),
  ]);

  const budgetProgressPct = dailyBudget && dailyBudget > 0
    ? (totalSpend / dailyBudget) * 100
    : undefined;

  return {
    total_spend: totalSpend,
    daily_budget: dailyBudget,
    budget_progress_pct: budgetProgressPct,
    projects,
  };
}

// ---------------------------------------------------------------------------
// Route Handler Factory
// ---------------------------------------------------------------------------

export type SpendApiHandlers = {
  readonly handleSpend: (workspaceId: string) => Promise<Response>;
  readonly handleSessions: (workspaceId: string) => Promise<Response>;
};

export function createSpendApiHandlers(deps: ServerDependencies): SpendApiHandlers {
  const spendCache: SpendApiCache = new Map();

  const handleSpend = async (workspaceId: string): Promise<Response> => {
    try {
      // Check cache
      const now = Date.now();
      const cached = spendCache.get(workspaceId);
      let overview: SpendOverview;

      if (cached && now - cached.fetchedAt < SPEND_CACHE_TTL_MS) {
        overview = cached.data;
      } else {
        overview = await buildSpendOverview(deps.surreal, workspaceId);
        spendCache.set(workspaceId, { data: overview, fetchedAt: Date.now() });
      }

      // Async: anomaly detection
      deps.inflight.track(
        runAnomalyDetection(deps.surreal, workspaceId).catch((err) => {
          logError("proxy.spend.anomaly_detection_failed", "Anomaly detection failed", err);
        }),
      );

      // Async: budget threshold check
      if (overview.daily_budget !== undefined) {
        const budgetCheck = checkBudgetThreshold(overview.total_spend, overview.daily_budget);
        if (budgetCheck.exceeded) {
          deps.inflight.track(
            createBudgetThresholdObservationIfNew(
              deps.surreal,
              workspaceId,
              budgetCheck.currentSpend,
              budgetCheck.budget,
              budgetCheck.pct,
            ).catch((err) => {
              logError("proxy.spend.budget_alert_failed", "Budget alert creation failed", err);
            }),
          );
        }
      }

      return jsonResponse(overview, 200);
    } catch (error) {
      logError("proxy.spend.query_failed", "Failed to build spend overview", error);
      return jsonResponse({ error: "spend_query_failed" }, 500);
    }
  };

  const handleSessions = async (workspaceId: string): Promise<Response> => {
    try {
      const sessions = await querySessionBreakdown(deps.surreal, workspaceId);
      const breakdown: SessionBreakdown = { sessions };
      return jsonResponse(breakdown, 200);
    } catch (error) {
      logError("proxy.sessions.query_failed", "Failed to build session breakdown", error);
      return jsonResponse({ error: "session_query_failed" }, 500);
    }
  };

  return { handleSpend, handleSessions };
}

// ---------------------------------------------------------------------------
// Async: Anomaly Detection Runner
// ---------------------------------------------------------------------------

async function runAnomalyDetection(
  surreal: Surreal,
  workspaceId: string,
): Promise<void> {
  const sessionCounts = await querySessionCallCounts(surreal, workspaceId);
  const anomalies = detectAnomalySessions(sessionCounts);

  if (anomalies.length === 0) return;

  // Check if we already created an anomaly observation today
  const alreadyAlerted = await hasObservationToday(surreal, workspaceId, "proxy_anomaly_call_rate");
  if (alreadyAlerted) return;

  const totalCalls = sessionCounts.reduce((sum, s) => sum + s.callCount, 0);
  const averageCalls = totalCalls / sessionCounts.length;

  for (const anomaly of anomalies) {
    await createAnomalyObservation(surreal, workspaceId, anomaly, averageCalls)
      .catch((err) => {
        logError("proxy.spend.anomaly_observation_failed", "Failed to create anomaly observation", err);
      });
  }

  logInfo("proxy.spend.anomaly_detected", "Anomalous sessions detected", {
    workspace_id: workspaceId,
    anomaly_count: anomalies.length,
  });
}

// ---------------------------------------------------------------------------
// Async: Budget Threshold Observer (deduped)
// ---------------------------------------------------------------------------

async function createBudgetThresholdObservationIfNew(
  surreal: Surreal,
  workspaceId: string,
  currentSpend: number,
  budget: number,
  pct: number,
): Promise<void> {
  const alreadyAlerted = await hasObservationToday(surreal, workspaceId, "proxy_budget_threshold");
  if (alreadyAlerted) return;

  await createBudgetThresholdObservation(surreal, workspaceId, currentSpend, budget, pct);

  logInfo("proxy.spend.budget_threshold_alert", "Budget threshold alert created", {
    workspace_id: workspaceId,
    current_spend_usd: currentSpend,
    daily_budget_usd: budget,
    pct: pct * 100,
  });
}

// ---------------------------------------------------------------------------
// Cache Invalidation (called from trace writer callback)
// ---------------------------------------------------------------------------

/**
 * Invalidate the spend cache for a workspace.
 * Called on every trace creation to ensure fresh dashboard reads.
 */
export function createSpendCacheInvalidator(
  cache: SpendApiCache,
): (workspaceId: string) => void {
  return (workspaceId: string) => {
    cache.delete(workspaceId);
  };
}
