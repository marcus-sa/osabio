/**
 * Tool Executor -- Effect Boundary
 *
 * Executes Brain-native tool calls via graph queries. This is the adapter/effect
 * boundary -- it performs IO (SurrealDB queries) to fulfill tool calls that the
 * pure tool-router classified as "brain-native".
 *
 * Each Brain-native tool handler is a function: (input, deps) -> ToolExecutionResult.
 * Unknown tool names produce an error result (not an exception).
 *
 * Step 8.5 in the proxy pipeline.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { ClassifiedToolCall } from "./tool-router";
import { log } from "../telemetry/logger";
import { captureToolTrace } from "./tool-trace-writer";
import {
  resolveCredentialsForTool,
  type CredentialResolverDeps,
} from "./credential-resolver";
import {
  fetchGovernancePolicies,
  countTodayToolExecutions,
  fetchCanUseRateLimit,
  countHourlyToolExecutions,
  type GovernsPolicyRow,
} from "../tool-registry/queries";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of executing a single Brain-native tool call. */
export type ToolExecutionResult = {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
};

/** Dependencies injected into tool executors. */
export type ToolExecutorDeps = {
  readonly surreal: Surreal;
  readonly workspaceId: string;
  readonly identityId?: string;
};

/** Dependencies for integration tool execution (extends base with credential resolver). */
export type IntegrationExecutorDeps = ToolExecutorDeps & {
  readonly toolEncryptionKey: string;
};

/** Anthropic tool_result content block for follow-up requests. */
export type ToolResultMessage = {
  role: "user";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }>;
};

// ---------------------------------------------------------------------------
// Governance Types (Pure)
// ---------------------------------------------------------------------------

/** Result of evaluating governance policies for a tool call. */
export type GovernanceVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly outcome: "denied" | "rate_limited" };

/**
 * Evaluate governance policies (pure function).
 *
 * Rules:
 *   - "requires_human_approval" condition -> denied
 *   - max_per_day exceeded -> denied
 *   - Multiple policies: most restrictive wins (any denial = denied)
 */
export function evaluateGovernancePolicies(
  policies: GovernsPolicyRow[],
  todayExecutionCount: number,
): GovernanceVerdict {
  for (const policy of policies) {
    // Check requires_human_approval condition
    if (policy.conditions === "requires_human_approval") {
      return {
        allowed: false,
        reason: `Tool call denied by policy "${policy.policyTitle}": requires human approval`,
        outcome: "denied",
      };
    }

    // Check max_per_day limit
    if (policy.max_per_day !== undefined && todayExecutionCount >= policy.max_per_day) {
      return {
        allowed: false,
        reason: `Tool call denied by policy "${policy.policyTitle}": daily limit of ${policy.max_per_day} exceeded (${todayExecutionCount} calls today)`,
        outcome: "denied",
      };
    }
  }

  return { allowed: true };
}

/**
 * Evaluate can_use rate limit (pure function).
 */
export function evaluateRateLimit(
  maxCallsPerHour: number | undefined,
  hourlyExecutionCount: number,
): GovernanceVerdict {
  if (maxCallsPerHour !== undefined && hourlyExecutionCount >= maxCallsPerHour) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${hourlyExecutionCount}/${maxCallsPerHour} calls per hour`,
      outcome: "rate_limited",
    };
  }

  return { allowed: true };
}

/** Handler for a single Brain-native tool. */
type BrainToolHandler = (
  input: Record<string, unknown>,
  deps: ToolExecutorDeps,
) => Promise<ToolExecutionResult>;

// ---------------------------------------------------------------------------
// Brain-Native Tool Handlers
// ---------------------------------------------------------------------------

const searchEntitiesHandler: BrainToolHandler = async (input, deps) => {
  const query = typeof input.query === "string" ? input.query : "";

  if (!query.trim()) {
    return {
      toolUseId: "", // filled by caller
      content: JSON.stringify({ results: [], message: "Empty search query" }),
      isError: false,
    };
  }

  const workspaceRecord = new RecordId("workspace", deps.workspaceId);

  // Simple keyword search across tasks, decisions, and features
  // Uses basic string matching (CONTAINS) for the walking skeleton.
  // Future: BM25 fulltext search.
  type EntityRow = {
    id: RecordId;
    table: string;
    title?: string;
    summary?: string;
    text?: string;
    status?: string;
  };

  const results = await deps.surreal.query<[EntityRow[], EntityRow[], EntityRow[]]>(
    `SELECT id, 'task' AS table, title, status FROM task WHERE workspace = $ws AND (title CONTAINS $q) LIMIT 10;
     SELECT id, 'decision' AS table, summary, status FROM decision WHERE workspace = $ws AND (summary CONTAINS $q) LIMIT 10;
     SELECT id, 'feature' AS table, title, status FROM feature WHERE workspace = $ws AND (title CONTAINS $q) LIMIT 10;`,
    { ws: workspaceRecord, q: query },
  );

  const entities = [
    ...(results[0] ?? []).map((row) => ({
      id: (row.id as RecordId).id as string,
      type: "task",
      title: row.title ?? "",
      status: row.status ?? "",
    })),
    ...(results[1] ?? []).map((row) => ({
      id: (row.id as RecordId).id as string,
      type: "decision",
      title: row.summary ?? "",
      status: row.status ?? "",
    })),
    ...(results[2] ?? []).map((row) => ({
      id: (row.id as RecordId).id as string,
      type: "feature",
      title: row.title ?? "",
      status: row.status ?? "",
    })),
  ];

  return {
    toolUseId: "", // filled by caller
    content: JSON.stringify({ results: entities, count: entities.length }),
    isError: false,
  };
};

/** Registry of Brain-native tool handlers, keyed by tool name. */
const brainToolHandlers: ReadonlyMap<string, BrainToolHandler> = new Map([
  ["search_entities", searchEntitiesHandler],
]);

// ---------------------------------------------------------------------------
// Effect Boundary: executeBrainNativeTools
// ---------------------------------------------------------------------------

/**
 * Execute all brain-native tool calls and return tool_result messages.
 *
 * - Each classified brain-native call is dispatched to its handler.
 * - Unknown handlers produce an error result (graceful, not HTTP 500).
 * - All errors are caught and returned as is_error tool_results.
 */
export async function executeBrainNativeTools(
  classifiedCalls: ClassifiedToolCall[],
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult[]> {
  const brainNativeCalls = classifiedCalls.filter(
    (c): c is Extract<ClassifiedToolCall, { classification: "brain-native" }> =>
      c.classification === "brain-native",
  );

  const results: ToolExecutionResult[] = [];

  for (const call of brainNativeCalls) {
    const handler = brainToolHandlers.get(call.toolUse.name);

    if (!handler) {
      results.push({
        toolUseId: call.toolUse.id,
        content: JSON.stringify({
          error: `No handler registered for brain-native tool: ${call.toolUse.name}`,
        }),
        isError: true,
      });
      continue;
    }

    const startMs = performance.now();
    try {
      const result = await handler(call.toolUse.input, deps);
      const durationMs = performance.now() - startMs;
      results.push({
        ...result,
        toolUseId: call.toolUse.id,
      });

      // Fire-and-forget trace capture (do not block tool result delivery)
      captureToolTrace(
        {
          toolName: call.toolUse.name,
          workspaceId: deps.workspaceId,
          identityId: deps.identityId,
          outcome: "success",
          durationMs,
          input: call.toolUse.input as Record<string, unknown>,
          output: { content: result.content },
        },
        { surreal: deps.surreal },
      ).catch((traceError) => {
        log.warn("proxy.tool_executor.trace_failed", "Tool trace capture failed", {
          tool_name: call.toolUse.name,
          error: String(traceError),
        });
      });
    } catch (error) {
      const durationMs = performance.now() - startMs;
      log.warn("proxy.tool_executor.handler_error", "Brain-native tool execution failed", {
        tool_name: call.toolUse.name,
        tool_use_id: call.toolUse.id,
        error: String(error),
      });
      results.push({
        toolUseId: call.toolUse.id,
        content: JSON.stringify({
          error: `Tool execution failed: ${String(error)}`,
        }),
        isError: true,
      });

      // Trace error outcome too
      captureToolTrace(
        {
          toolName: call.toolUse.name,
          workspaceId: deps.workspaceId,
          identityId: deps.identityId,
          outcome: "error",
          durationMs,
        },
        { surreal: deps.surreal },
      ).catch((traceError) => {
        log.warn("proxy.tool_executor.trace_failed", "Tool trace capture failed", {
          tool_name: call.toolUse.name,
          error: String(traceError),
        });
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helper: buildToolResultMessages
// ---------------------------------------------------------------------------

/**
 * Build an Anthropic tool_result message from execution results.
 * Used to construct the follow-up request in the tool use loop.
 */
export function buildToolResultMessage(
  results: ToolExecutionResult[],
): ToolResultMessage {
  return {
    role: "user",
    content: results.map((result) => ({
      type: "tool_result" as const,
      tool_use_id: result.toolUseId,
      content: result.content,
      ...(result.isError ? { is_error: true } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Response Sanitization (Pure Functions)
// ---------------------------------------------------------------------------

/** Headers that must be stripped from integration HTTP responses. */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "set-cookie",
  "x-api-key",
  "www-authenticate",
]);

/** JSON field names (lowercase) that must be recursively stripped from response bodies. */
const SENSITIVE_FIELDS: ReadonlySet<string> = new Set([
  "access_token",
  "refresh_token",
  "api_key",
  "password",
  "client_secret",
  "bearer_token",
]);

/** Maximum response body size in bytes before truncation. */
const MAX_RESPONSE_BYTES = 100 * 1024; // 100KB

/**
 * Strip sensitive headers from an HTTP response headers map.
 * Pure function: returns a new record with sensitive headers removed.
 */
export function sanitizeResponseHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Recursively strip sensitive fields from a JSON value.
 * Pure function: returns a new value with credential fields removed.
 */
export function sanitizeResponseBody(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(sanitizeResponseBody);
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
      if (!SENSITIVE_FIELDS.has(key.toLowerCase())) {
        sanitized[key] = sanitizeResponseBody(fieldValue);
      }
    }
    return sanitized;
  }

  return value;
}

/**
 * Truncate a string to the maximum allowed byte size.
 * Pure function: appends a truncation marker if the content exceeds the limit.
 */
export function truncateResponse(content: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  if (bytes.length <= MAX_RESPONSE_BYTES) return content;

  const truncated = new TextDecoder().decode(bytes.slice(0, MAX_RESPONSE_BYTES));
  return `${truncated}\n\n[Response truncated: ${bytes.length} bytes exceeds ${MAX_RESPONSE_BYTES} byte limit]`;
}

/**
 * Full sanitization pipeline for integration tool responses.
 * Pure function: sanitize body -> truncate -> return content string.
 */
export function sanitizeIntegrationResponse(
  responseBody: string,
  responseHeaders: Record<string, string>,
): { content: string; sanitizedHeaders: Record<string, string> } {
  const sanitizedHeaders = sanitizeResponseHeaders(responseHeaders);

  // Try to parse and sanitize JSON body
  let sanitizedContent: string;
  try {
    const parsed = JSON.parse(responseBody);
    const sanitized = sanitizeResponseBody(parsed);
    sanitizedContent = JSON.stringify(sanitized);
  } catch {
    // Not JSON -- use raw body
    sanitizedContent = responseBody;
  }

  const truncatedContent = truncateResponse(sanitizedContent);

  return { content: truncatedContent, sanitizedHeaders };
}

// ---------------------------------------------------------------------------
// Effect Boundary: executeIntegrationTools
// ---------------------------------------------------------------------------

/**
 * Execute all integration tool calls via HTTP with brokered credentials.
 *
 * For each integration tool call:
 *   1. Resolve credentials via credential-resolver
 *   2. Execute HTTP call to integration API
 *   3. Sanitize response (strip auth headers + credential fields)
 *   4. Truncate to 100KB
 *   5. Return as tool_result
 *   6. Write trace record
 *
 * Errors are returned as is_error tool_results, never thrown as exceptions.
 */
export async function executeIntegrationTools(
  classifiedCalls: ClassifiedToolCall[],
  deps: IntegrationExecutorDeps,
): Promise<ToolExecutionResult[]> {
  const integrationCalls = classifiedCalls.filter(
    (c): c is Extract<ClassifiedToolCall, { classification: "integration" }> =>
      c.classification === "integration",
  );

  const results: ToolExecutionResult[] = [];

  for (const call of integrationCalls) {
    const startMs = performance.now();
    const providerRef = call.resolvedTool.toolkit;

    try {
      // Step 0: Governance check (BEFORE credential resolution)
      const governancePolicies = await fetchGovernancePolicies(
        deps.surreal,
        call.toolUse.name,
      );

      if (governancePolicies.length > 0) {
        const todayCount = await countTodayToolExecutions(
          deps.surreal,
          call.toolUse.name,
          deps.workspaceId,
        );

        const governanceVerdict = evaluateGovernancePolicies(governancePolicies, todayCount);

        if (!governanceVerdict.allowed) {
          const durationMs = performance.now() - startMs;
          results.push({
            toolUseId: call.toolUse.id,
            content: JSON.stringify({ error: governanceVerdict.reason }),
            isError: true,
          });

          captureToolTrace(
            {
              toolName: call.toolUse.name,
              workspaceId: deps.workspaceId,
              identityId: deps.identityId,
              outcome: governanceVerdict.outcome,
              durationMs,
              input: { tool_kind: "integration", governance_denial: governanceVerdict.reason },
            },
            { surreal: deps.surreal },
          ).catch((traceError) => {
            log.warn("proxy.governance.trace_failed", "Governance trace capture failed", {
              tool_name: call.toolUse.name,
              error: String(traceError),
            });
          });
          continue;
        }
      }

      // Step 0.5: Rate limit check on can_use edge
      if (deps.identityId) {
        const { maxCallsPerHour } = await fetchCanUseRateLimit(
          deps.surreal,
          deps.identityId,
          call.toolUse.name,
        );

        if (maxCallsPerHour !== undefined) {
          const hourlyCount = await countHourlyToolExecutions(
            deps.surreal,
            call.toolUse.name,
            deps.workspaceId,
            deps.identityId,
          );

          const rateLimitVerdict = evaluateRateLimit(maxCallsPerHour, hourlyCount);

          if (!rateLimitVerdict.allowed) {
            const durationMs = performance.now() - startMs;
            results.push({
              toolUseId: call.toolUse.id,
              content: JSON.stringify({ error: rateLimitVerdict.reason }),
              isError: true,
            });

            captureToolTrace(
              {
                toolName: call.toolUse.name,
                workspaceId: deps.workspaceId,
                identityId: deps.identityId,
                outcome: rateLimitVerdict.outcome,
                durationMs,
                input: { tool_kind: "integration", rate_limit_denial: rateLimitVerdict.reason },
              },
              { surreal: deps.surreal },
            ).catch((traceError) => {
              log.warn("proxy.rate_limit.trace_failed", "Rate limit trace capture failed", {
                tool_name: call.toolUse.name,
                error: String(traceError),
              });
            });
            continue;
          }
        }
      }

      // Step 1: Resolve credentials
      if (!deps.identityId) {
        results.push({
          toolUseId: call.toolUse.id,
          content: JSON.stringify({ error: "Identity required for integration tool calls" }),
          isError: true,
        });
        continue;
      }

      const credentialResolverDeps: CredentialResolverDeps = {
        surreal: deps.surreal,
        toolEncryptionKey: deps.toolEncryptionKey,
      };

      const credResult = await resolveCredentialsForTool(
        call.toolUse.name,
        deps.identityId,
        credentialResolverDeps,
      );

      if (!credResult.ok) {
        const durationMs = performance.now() - startMs;
        results.push({
          toolUseId: call.toolUse.id,
          content: JSON.stringify({ error: `Credential resolution failed: ${credResult.error}` }),
          isError: true,
        });

        captureToolTrace(
          {
            toolName: call.toolUse.name,
            workspaceId: deps.workspaceId,
            identityId: deps.identityId,
            outcome: "error",
            durationMs,
            input: { tool_kind: "integration", credential_provider: providerRef },
          },
          { surreal: deps.surreal },
        ).catch((traceError) => {
          log.warn("proxy.integration_executor.trace_failed", "Integration trace capture failed", {
            tool_name: call.toolUse.name,
            error: String(traceError),
          });
        });
        continue;
      }

      // Step 2: Build and execute HTTP request
      // The tool input should contain the endpoint URL or we derive it from provider config
      const endpointUrl = typeof call.toolUse.input.endpoint_url === "string"
        ? call.toolUse.input.endpoint_url
        : typeof call.toolUse.input.url === "string"
          ? call.toolUse.input.url
          : undefined;

      if (!endpointUrl) {
        const durationMs = performance.now() - startMs;
        results.push({
          toolUseId: call.toolUse.id,
          content: JSON.stringify({ error: "Integration tool call missing endpoint_url or url in input" }),
          isError: true,
        });

        captureToolTrace(
          {
            toolName: call.toolUse.name,
            workspaceId: deps.workspaceId,
            identityId: deps.identityId,
            outcome: "error",
            durationMs,
            input: { tool_kind: "integration", credential_provider: providerRef },
          },
          { surreal: deps.surreal },
        ).catch((traceError) => {
          log.warn("proxy.integration_executor.trace_failed", "Integration trace capture failed", {
            tool_name: call.toolUse.name,
            error: String(traceError),
          });
        });
        continue;
      }

      const httpMethod = typeof call.toolUse.input.method === "string"
        ? call.toolUse.input.method.toUpperCase()
        : "POST";

      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...credResult.headers,
      };

      // Build request body from tool input (excluding meta fields)
      const { endpoint_url: _eu, url: _u, method: _m, ...bodyInput } = call.toolUse.input;
      const hasBody = httpMethod !== "GET" && httpMethod !== "HEAD" && Object.keys(bodyInput).length > 0;

      const fetchOptions: RequestInit = {
        method: httpMethod,
        headers: requestHeaders,
        ...(hasBody ? { body: JSON.stringify(bodyInput) } : {}),
      };

      const httpResponse = await fetch(endpointUrl, fetchOptions);
      const responseBody = await httpResponse.text();
      const durationMs = performance.now() - startMs;

      // Step 3-4: Sanitize and truncate
      const responseHeaders: Record<string, string> = {};
      httpResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const { content } = sanitizeIntegrationResponse(responseBody, responseHeaders);

      // Step 5: Return as tool_result
      const isError = httpResponse.status >= 400;
      const resultContent = isError
        ? JSON.stringify({
            error: `Integration API returned ${httpResponse.status}`,
            status: httpResponse.status,
            body: content,
          })
        : content;

      results.push({
        toolUseId: call.toolUse.id,
        content: resultContent,
        isError,
      });

      // Step 6: Write trace record
      captureToolTrace(
        {
          toolName: call.toolUse.name,
          workspaceId: deps.workspaceId,
          identityId: deps.identityId,
          outcome: isError ? "error" : "success",
          durationMs,
          input: { tool_kind: "integration", credential_provider: providerRef },
          output: { status: httpResponse.status, content_length: content.length },
        },
        { surreal: deps.surreal },
      ).catch((traceError) => {
        log.warn("proxy.integration_executor.trace_failed", "Integration trace capture failed", {
          tool_name: call.toolUse.name,
          error: String(traceError),
        });
      });
    } catch (error) {
      const durationMs = performance.now() - startMs;

      // Integration errors are tool_result errors, not HTTP 500s
      log.warn("proxy.integration_executor.error", "Integration tool execution failed", {
        tool_name: call.toolUse.name,
        tool_use_id: call.toolUse.id,
        error: String(error),
      });

      results.push({
        toolUseId: call.toolUse.id,
        content: JSON.stringify({
          error: `Integration tool execution failed: ${String(error)}`,
        }),
        isError: true,
      });

      captureToolTrace(
        {
          toolName: call.toolUse.name,
          workspaceId: deps.workspaceId,
          identityId: deps.identityId,
          outcome: "error",
          durationMs,
          input: { tool_kind: "integration", credential_provider: providerRef },
        },
        { surreal: deps.surreal },
      ).catch((traceError) => {
        log.warn("proxy.integration_executor.trace_failed", "Integration trace capture failed", {
          tool_name: call.toolUse.name,
          error: String(traceError),
        });
      });
    }
  }

  return results;
}
