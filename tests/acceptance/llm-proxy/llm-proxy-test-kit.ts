/**
 * LLM Proxy Acceptance Test Kit
 *
 * Domain-specific helpers for LLM proxy acceptance tests.
 * Extends the shared acceptance-test-kit with proxy-specific
 * workspace setup, request builders, and graph query helpers.
 *
 * Driving ports: HTTP endpoints at /proxy/llm/anthropic/v1/messages
 * and /api/workspaces/:workspaceId/proxy/spend
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";

// Re-export shared helpers
export {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
};

// ---------------------------------------------------------------------------
// Proxy Request Builders
// ---------------------------------------------------------------------------

export type ProxyRequestOptions = {
  model: string;
  stream?: boolean;
  maxTokens?: number;
  messages?: Array<{ role: string; content: string }>;
  metadata?: { user_id?: string };
  apiKey?: string;
  workspaceHeader?: string;
  taskHeader?: string;
  agentTypeHeader?: string;
};

/**
 * Build a proxy request body matching the Anthropic Messages API format.
 */
export function buildProxyRequestBody(options: ProxyRequestOptions): string {
  return JSON.stringify({
    model: options.model,
    max_tokens: options.maxTokens ?? 100,
    stream: options.stream ?? false,
    messages: options.messages ?? [
      { role: "user", content: "Say hello in one word." },
    ],
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });
}

/**
 * Build headers for a proxy request, including identity headers.
 */
export function buildProxyHeaders(options: ProxyRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  if (options.apiKey) {
    headers["x-api-key"] = options.apiKey;
  }
  if (options.workspaceHeader) {
    headers["X-Brain-Workspace"] = options.workspaceHeader;
  }
  if (options.taskHeader) {
    headers["X-Brain-Task"] = options.taskHeader;
  }
  if (options.agentTypeHeader) {
    headers["X-Brain-Agent-Type"] = options.agentTypeHeader;
  }

  return headers;
}

/**
 * Send a request through the LLM proxy endpoint.
 * Returns the raw Response for flexible assertion.
 */
export async function sendProxyRequest(
  baseUrl: string,
  options: ProxyRequestOptions,
): Promise<Response> {
  const body = buildProxyRequestBody(options);
  const headers = buildProxyHeaders(options);

  return fetch(`${baseUrl}/proxy/llm/anthropic/v1/messages`, {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Send a count_tokens request through the proxy.
 */
export async function sendCountTokensRequest(
  baseUrl: string,
  options: ProxyRequestOptions,
): Promise<Response> {
  const body = buildProxyRequestBody(options);
  const headers = buildProxyHeaders(options);

  return fetch(`${baseUrl}/proxy/llm/anthropic/v1/messages/count_tokens`, {
    method: "POST",
    headers,
    body,
  });
}

// ---------------------------------------------------------------------------
// SSE Stream Helpers
// ---------------------------------------------------------------------------

export type SSEEvent = {
  event?: string;
  data: string;
};

/**
 * Collect all SSE events from a streaming proxy response.
 */
export async function collectProxySSEEvents(response: Response): Promise<SSEEvent[]> {
  if (!response.body) {
    throw new Error("No response body for SSE collection");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: SSEEvent[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const lines = segment.split("\n");
        let eventType: string | undefined;
        let dataLine: string | undefined;

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          }
        }

        if (dataLine !== undefined) {
          events.push({ event: eventType, data: dataLine });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return events;
}

// ---------------------------------------------------------------------------
// Workspace and Identity Setup
// ---------------------------------------------------------------------------

/**
 * Create a workspace record in SurrealDB for proxy testing.
 */
export async function createProxyTestWorkspace(
  surreal: Surreal,
  workspaceId: string,
  options?: { dailyBudget?: number; alertThreshold?: number },
): Promise<string> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $workspace CONTENT $content;`, {
    workspace: workspaceRecord,
    content: {
      name: `Proxy Test Workspace ${workspaceId}`,
      status: "active",
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: new Date(),
      created_at: new Date(),
      proxy_settings: {
        daily_budget: options?.dailyBudget ?? 50.0,
        alert_threshold: options?.alertThreshold ?? 0.8,
        rate_limit_per_minute: 60,
      },
    },
  });

  return workspaceId;
}

/**
 * Create a project record linked to a workspace.
 */
export async function createProxyTestProject(
  surreal: Surreal,
  projectId: string,
  workspaceId: string,
): Promise<string> {
  const projectRecord = new RecordId("project", projectId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $project CONTENT $content;`, {
    project: projectRecord,
    content: {
      title: `Test Project ${projectId}`,
      status: "active",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return projectId;
}

/**
 * Create a task record linked to a project and workspace.
 */
export async function createProxyTestTask(
  surreal: Surreal,
  taskId: string,
  projectId: string,
  workspaceId: string,
): Promise<string> {
  const taskRecord = new RecordId("task", taskId);
  const projectRecord = new RecordId("project", projectId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $task CONTENT $content;`, {
    task: taskRecord,
    content: {
      title: `Test Task ${taskId}`,
      status: "open",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  // Link task to project
  await surreal.query(`RELATE $task->belongs_to->$project SET created_at = time::now();`, {
    task: taskRecord,
    project: projectRecord,
  });

  return taskId;
}

// ---------------------------------------------------------------------------
// Graph Query Helpers
// ---------------------------------------------------------------------------

export type LlmTraceRecord = {
  id: RecordId;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  cost_usd: number;
  latency_ms: number;
  stop_reason?: string;
  request_id?: string;
  created_at: Date;
};

/**
 * Query all LLM traces in a workspace.
 */
export async function getTracesForWorkspace(
  surreal: Surreal,
  workspaceId: string,
): Promise<LlmTraceRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT * FROM trace WHERE ->scoped_to->workspace CONTAINS $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  );

  return (results[0] ?? []) as LlmTraceRecord[];
}

/**
 * Query traces attributed to a specific task.
 */
export async function getTracesForTask(
  surreal: Surreal,
  taskId: string,
): Promise<LlmTraceRecord[]> {
  const taskRecord = new RecordId("task", taskId);

  const results = await surreal.query(
    `SELECT * FROM trace WHERE ->attributed_to->task CONTAINS $task ORDER BY created_at DESC;`,
    { task: taskRecord },
  );

  return (results[0] ?? []) as LlmTraceRecord[];
}

/**
 * Check whether a trace has the expected graph edges.
 */
export async function getTraceEdges(
  surreal: Surreal,
  traceId: string,
): Promise<{
  workspaces: RecordId[];
  tasks: RecordId[];
  sessions: RecordId[];
}> {
  const traceRecord = new RecordId("trace", traceId);

  const results = await surreal.query(
    `SELECT
       ->scoped_to->workspace AS workspaces,
       ->attributed_to->task AS tasks,
       <-invoked<-agent_session AS sessions
     FROM $trace;`,
    { trace: traceRecord },
  );

  const row = (results[0] as Array<{
    workspaces: RecordId[];
    tasks: RecordId[];
    sessions: RecordId[];
  }>)?.[0];

  return {
    workspaces: row?.workspaces ?? [],
    tasks: row?.tasks ?? [],
    sessions: row?.sessions ?? [],
  };
}

/**
 * Query the total spend for a workspace (sum of trace costs).
 */
export async function getWorkspaceSpend(
  surreal: Surreal,
  workspaceId: string,
): Promise<number> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT math::sum(cost_usd) AS total FROM trace WHERE ->scoped_to->workspace CONTAINS $ws;`,
    { ws: workspaceRecord },
  );

  const row = (results[0] as Array<{ total: number }>)?.[0];
  return row?.total ?? 0;
}

/**
 * Seed an LLM trace directly for testing dashboard/audit scenarios
 * that need pre-existing trace data.
 */
export async function seedLlmTrace(
  surreal: Surreal,
  traceId: string,
  options: {
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
    workspaceId: string;
    taskId?: string;
    sessionId?: string;
    stop_reason?: string;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    created_at?: Date;
  },
): Promise<string> {
  const traceRecord = new RecordId("trace", traceId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  await surreal.query(`CREATE $trace CONTENT $content;`, {
    trace: traceRecord,
    content: {
      model: options.model,
      input_tokens: options.input_tokens,
      output_tokens: options.output_tokens,
      cache_read_tokens: options.cache_read_tokens ?? 0,
      cache_creation_tokens: options.cache_creation_tokens ?? 0,
      cost_usd: options.cost_usd,
      latency_ms: options.latency_ms,
      stop_reason: options.stop_reason ?? "end_turn",
      created_at: options.created_at ?? new Date(),
    },
  });

  // Create workspace edge
  await surreal.query(
    `RELATE $trace->scoped_to->$workspace SET created_at = time::now();`,
    { trace: traceRecord, workspace: workspaceRecord },
  );

  // Create task edge if provided
  if (options.taskId) {
    const taskRecord = new RecordId("task", options.taskId);
    await surreal.query(
      `RELATE $trace->attributed_to->$task SET created_at = time::now();`,
      { trace: traceRecord, task: taskRecord },
    );
  }

  // Create session edge if provided
  if (options.sessionId) {
    const sessionRecord = new RecordId("agent_session", options.sessionId);
    await surreal.query(
      `RELATE $session->invoked->$trace SET created_at = time::now();`,
      { trace: traceRecord, session: sessionRecord },
    );
  }

  return traceId;
}

// ---------------------------------------------------------------------------
// Policy Setup Helpers
// ---------------------------------------------------------------------------

/**
 * Create a model access policy for the proxy.
 */
export async function createModelAccessPolicy(
  surreal: Surreal,
  workspaceId: string,
  options: {
    policyId: string;
    agentType: string;
    allowedModels: string[];
    status?: string;
  },
): Promise<string> {
  const policyRecord = new RecordId("policy", options.policyId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $policy CONTENT $content;`, {
    policy: policyRecord,
    content: {
      title: `Model Access: ${options.agentType}`,
      description: `Controls which models ${options.agentType} can use`,
      status: options.status ?? "active",
      version: 1,
      workspace: workspaceRecord,
      rules: [{
        id: "model_access",
        condition: { field: "agent_type", operator: "eq", value: options.agentType },
        effect: "allow",
        priority: 50,
        params: { allowed_models: options.allowedModels },
      }],
      created_at: new Date(),
    },
  });

  return options.policyId;
}

/**
 * Set the daily budget for a workspace (updates proxy settings).
 */
export async function setWorkspaceBudget(
  surreal: Surreal,
  workspaceId: string,
  dailyBudget: number,
): Promise<void> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(
    `UPDATE $workspace SET proxy_settings.daily_budget = $budget;`,
    { workspace: workspaceRecord, budget: dailyBudget },
  );
}

// ---------------------------------------------------------------------------
// Spend API Helpers
// ---------------------------------------------------------------------------

/**
 * Query the spend breakdown API endpoint.
 */
export async function querySpendBreakdown(
  baseUrl: string,
  workspaceId: string,
  period: string = "today",
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/spend?period=${period}`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// Audit API Helpers
// ---------------------------------------------------------------------------

/**
 * Query the audit trace detail endpoint.
 */
export async function queryTraceDetail(
  baseUrl: string,
  workspaceId: string,
  traceId: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/traces/${traceId}`,
    { method: "GET" },
  );
}

/**
 * Query traces for a project within a date range.
 */
export async function queryTracesByProject(
  baseUrl: string,
  workspaceId: string,
  projectId: string,
  startDate: string,
  endDate: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/traces?project=${projectId}&start=${startDate}&end=${endDate}`,
    { method: "GET" },
  );
}

/**
 * Run the compliance check for a workspace.
 */
export async function runComplianceCheck(
  baseUrl: string,
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/proxy/compliance?start=${startDate}&end=${endDate}`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// Claude Code metadata builder
// ---------------------------------------------------------------------------

/**
 * Build a Claude Code-style metadata.user_id string.
 */
export function buildClaudeCodeUserId(
  userHash: string,
  accountId: string,
  sessionId: string,
): string {
  return `user_${userHash}_account_${accountId}_session_${sessionId}`;
}
