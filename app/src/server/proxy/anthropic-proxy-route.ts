/**
 * Anthropic LLM Proxy Route
 *
 * Transparent proxy that forwards requests to Anthropic's Messages API
 * with identity resolution, session tracking, and workspace validation.
 *
 * Pipeline execution order:
 * 1. Identity resolution (from metadata + headers)
 * 2. Session ID resolution (header priority over metadata)
 * 3. Conversation hash (03-01) — deterministic UUIDv5 from content
 * 4. Policy evaluation [future 02-01]
 * 5. Context injection [future 03-02]
 * 6. Request forwarding
 * 7. Async trace capture (01-03) + conversation upsert
 */
import { logInfo, logError, logWarn, elapsedMs } from "../http/observability";
import { jsonResponse } from "../http/response";
import { resolveIdentity } from "./identity-resolver";
import { resolveSessionId } from "./session-id-resolver";
import { captureTrace, type TraceData } from "./trace-writer";
import {
  resolveConversationHash,
  type ConversationHashInput,
} from "./conversation-hash-resolver";
import { upsertConversation } from "./conversation-upserter";
import {
  evaluateProxyPolicy,
  type ProxyPolicyDependencies,
  type ProxyPolicyResult,
  type PolicyDecisionLog,
  type SpendCache,
} from "./policy-evaluator";
import {
  createRateLimiterState,
  type RateLimiterState,
} from "./rate-limiter";
import type { ServerDependencies } from "../runtime/types";
import { RecordId } from "surrealdb";

const ANTHROPIC_API_URL = "https://api.anthropic.com";

const FORWARDED_HEADERS = [
  "anthropic-version",
  "anthropic-beta",
  "content-type",
] as const;

// ---------------------------------------------------------------------------
// Workspace Validation (cached)
// ---------------------------------------------------------------------------

type WorkspaceCache = Map<string, { valid: boolean; checkedAt: number }>;

const WORKSPACE_CACHE_TTL_MS = 60_000; // 1 minute

async function validateWorkspace(
  surreal: ServerDependencies["surreal"],
  workspaceId: string,
  cache: WorkspaceCache,
): Promise<boolean> {
  const cached = cache.get(workspaceId);
  if (cached && Date.now() - cached.checkedAt < WORKSPACE_CACHE_TTL_MS) {
    return cached.valid;
  }

  try {
    const results = await surreal.query<[Array<{ id: RecordId }>]>(
      `SELECT id FROM $ws;`,
      { ws: new RecordId("workspace", workspaceId) },
    );
    const valid = (results[0]?.length ?? 0) > 0;
    cache.set(workspaceId, { valid, checkedAt: Date.now() });
    return valid;
  } catch {
    cache.set(workspaceId, { valid: false, checkedAt: Date.now() });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Header Forwarding
// ---------------------------------------------------------------------------

function buildUpstreamHeaders(request: Request): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const xApiKey = request.headers.get("x-api-key");
  const authHeader = request.headers.get("authorization");
  if (xApiKey) headers.set("x-api-key", xApiKey);
  if (authHeader) headers.set("authorization", authHeader);

  return headers;
}

// ---------------------------------------------------------------------------
// Request Body Parsing
// ---------------------------------------------------------------------------

type ParsedBody = {
  model?: string;
  stream?: boolean;
  max_tokens?: number;
  metadata?: { user_id?: string };
  system?: string | Array<{ type: string; text: string }>;
  messages?: Array<{ role: string; content: string }>;
};

function tryParseRequestBody(body: string): ParsedBody | undefined {
  try {
    return JSON.parse(body) as ParsedBody;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Path Detection
// ---------------------------------------------------------------------------

function isCountTokensRequest(pathname: string): boolean {
  return pathname.endsWith("/count_tokens");
}

// ---------------------------------------------------------------------------
// SSE Usage Extraction
// ---------------------------------------------------------------------------

type StreamContext = {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  stopReason?: string;
};

function extractSSEUsage(buffer: string, ctx: StreamContext): string {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data === "[DONE]") continue;

    try {
      const event = JSON.parse(data);

      if (event.type === "message_start" && event.message?.usage) {
        ctx.inputTokens = event.message.usage.input_tokens ?? 0;
        ctx.cacheCreationTokens = event.message.usage.cache_creation_input_tokens ?? 0;
        ctx.cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
        ctx.model = event.message.model ?? ctx.model;
      }

      if (event.type === "message_delta") {
        if (event.usage?.output_tokens) {
          ctx.outputTokens = event.usage.output_tokens;
        }
        if (event.delta?.stop_reason) {
          ctx.stopReason = event.delta.stop_reason;
        }
      }
    } catch {
      // partial JSON or non-JSON data line — skip
    }
  }

  return remainder;
}

// ---------------------------------------------------------------------------
// Non-Streaming Usage Extraction
// ---------------------------------------------------------------------------

type NonStreamingResponse = {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  stop_reason?: string;
};

function extractNonStreamingUsage(
  responseBody: string,
  requestModel: string | undefined,
  latencyMs: number,
  identity: { workspaceId?: string; taskId?: string },
  sessionId?: string,
  policyDecision?: PolicyDecisionLog,
  conversationId?: string,
): TraceData | undefined {
  try {
    const parsed = JSON.parse(responseBody) as NonStreamingResponse;
    if (!parsed.usage) return undefined;

    return {
      model: parsed.model ?? requestModel ?? "unknown",
      inputTokens: parsed.usage.input_tokens ?? 0,
      outputTokens: parsed.usage.output_tokens ?? 0,
      cacheCreationTokens: parsed.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: parsed.usage.cache_read_input_tokens ?? 0,
      stopReason: parsed.stop_reason,
      latencyMs,
      workspaceId: identity.workspaceId,
      sessionId,
      taskId: identity.taskId,
      policyDecision,
      conversationId,
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Handler Factory
// ---------------------------------------------------------------------------

export function createAnthropicProxyHandler(
  deps: ServerDependencies,
): (request: Request) => Promise<Response> {
  const workspaceCache: WorkspaceCache = new Map();
  const rateLimiterState: RateLimiterState = createRateLimiterState();
  const spendCache: SpendCache = new Map();

  return async (request: Request): Promise<Response> => {
    const startedAt = performance.now();
    const url = new URL(request.url);
    const upstreamPath = url.pathname.replace(/^\/proxy\/llm\/anthropic/, "");
    const upstreamUrl = `${ANTHROPIC_API_URL}${upstreamPath}`;
    const isCountTokens = isCountTokensRequest(url.pathname);

    // --- Step 1: Parse request body (malformed body forwarded as-is) ---
    const body = await request.text();
    const parsed = tryParseRequestBody(body);
    const isStreaming = parsed?.stream === true;

    // --- Step 2: Identity resolution ---
    const identitySignals = resolveIdentity({
      metadataUserId: parsed?.metadata?.user_id,
      workspaceHeader: request.headers.get("X-Brain-Workspace") ?? undefined,
      taskHeader: request.headers.get("X-Brain-Task") ?? undefined,
      agentTypeHeader: request.headers.get("X-Brain-Agent-Type") ?? undefined,
      sessionHeader: request.headers.get("X-Brain-Session") ?? undefined,
    });

    // --- Step 3: Session ID resolution ---
    const effectiveSessionId = resolveSessionId(identitySignals);

    // --- Step 3.5: Conversation hash resolution (pure) ---
    const conversationHashInput: ConversationHashInput = {
      systemPrompt: typeof parsed?.system === "string" ? parsed.system : undefined,
      systemPromptBlocks: Array.isArray(parsed?.system) ? parsed.system : undefined,
      messages: parsed?.messages ?? [],
    };
    const conversationHash = resolveConversationHash(conversationHashInput);

    // --- Conversation upsert (async, non-blocking) ---
    let conversationId: string | undefined;
    if (conversationHash && identitySignals.workspaceId) {
      try {
        const conversationRecord = await upsertConversation(
          {
            conversationId: conversationHash.conversationId,
            workspaceId: identitySignals.workspaceId,
            title: conversationHash.title,
          },
          { surreal: deps.surreal },
        );
        if (conversationRecord) {
          conversationId = conversationHash.conversationId;
        }
      } catch (error) {
        logWarn("proxy.anthropic.conversation_upsert_failed", "Conversation upsert failed — continuing without conversation link", {
          error: String(error),
        });
      }
    }

    // --- Workspace validation (non-blocking) ---
    if (identitySignals.workspaceId) {
      const isValid = await validateWorkspace(
        deps.surreal,
        identitySignals.workspaceId,
        workspaceCache,
      );
      if (!isValid) {
        logWarn("proxy.anthropic.invalid_workspace", "Workspace not found in database", {
          workspaceId: identitySignals.workspaceId,
        });
      }
    }

    // --- Step 4: Policy evaluation ---
    let policyResult: ProxyPolicyResult | undefined;
    if (parsed?.model && !isCountTokens) {
      const policyDeps: ProxyPolicyDependencies = {
        surreal: deps.surreal,
        inflight: deps.inflight,
        rateLimiterState,
        spendCache,
      };

      policyResult = await evaluateProxyPolicy(
        {
          workspaceId: identitySignals.workspaceId ?? "",
          agentType: identitySignals.agentType,
          model: parsed.model,
        },
        policyDeps,
      );

      if (policyResult.decision === "deny_model") {
        return jsonResponse(policyResult.body, policyResult.status);
      }
      if (policyResult.decision === "deny_budget") {
        return jsonResponse(policyResult.body, policyResult.status);
      }
      if (policyResult.decision === "deny_rate_limit") {
        return new Response(JSON.stringify(policyResult.body), {
          status: policyResult.status,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(policyResult.retryAfterSeconds),
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // --- Build identity context for logging ---
    const identityContext = {
      user_hash: identitySignals.userHash,
      account_id: identitySignals.accountId,
      session_id: effectiveSessionId,
      workspace_id: identitySignals.workspaceId,
      task_id: identitySignals.taskId,
      agent_type: identitySignals.agentType,
      is_count_tokens: isCountTokens || undefined,
    };

    logInfo("proxy.anthropic.request", "Forwarding to Anthropic", {
      method: request.method,
      url: upstreamUrl,
      ...identityContext,
    });

    // --- Build policy decision for audit trail ---
    const policyDecision: PolicyDecisionLog | undefined = policyResult
      ? {
          decision: "pass",
          policy_refs: policyResult.decision === "allow" ? policyResult.policyIds : [],
          timestamp: new Date().toISOString(),
        }
      : undefined;

    // --- Step 6: Request forwarding ---
    const upstreamHeaders = buildUpstreamHeaders(request);

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body: request.method !== "GET" ? body : undefined,
      });
    } catch (error) {
      logError("proxy.anthropic.upstream_error", "Failed to reach Anthropic API", error);
      return jsonResponse({ error: "upstream_unreachable", source: "proxy" }, 502);
    }

    // --- Non-streaming response ---
    if (!isStreaming) {
      const responseBody = await upstream.text();
      const latencyMs = elapsedMs(startedAt);

      logInfo("proxy.anthropic.response", "Anthropic response", {
        status: upstream.status,
        latency_ms: latencyMs,
        ...identityContext,
      });

      // Async trace capture for non-streaming (skip count_tokens)
      if (!isCountTokens && upstream.status >= 200 && upstream.status < 300) {
        const traceData = extractNonStreamingUsage(responseBody, parsed?.model, latencyMs, identitySignals, effectiveSessionId, policyDecision, conversationId);
        if (traceData) {
          deps.inflight.track(
            captureTrace(traceData, { surreal: deps.surreal }).catch(() => undefined),
          );
        }
      }

      return new Response(responseBody, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // --- Streaming: pipe SSE events through ---
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();

    const streamContext: StreamContext = {
      model: parsed?.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      stopReason: undefined,
    };

    (async () => {
      try {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          await writer.write(value);

          buffer += decoder.decode(value, { stream: true });
          buffer = extractSSEUsage(buffer, streamContext);
        }
      } catch (error) {
        logError("proxy.anthropic.stream_error", "SSE relay error", error);
      } finally {
        await writer.close();

        const latencyMs = elapsedMs(startedAt);

        logInfo("proxy.anthropic.response", "Anthropic stream complete", {
          model: streamContext.model,
          input_tokens: streamContext.inputTokens,
          output_tokens: streamContext.outputTokens,
          cache_creation_tokens: streamContext.cacheCreationTokens,
          cache_read_tokens: streamContext.cacheReadTokens,
          stop_reason: streamContext.stopReason,
          latency_ms: latencyMs,
          ...identityContext,
        });

        // Async trace capture for streaming (skip count_tokens)
        if (!isCountTokens && streamContext.model) {
          const traceData: TraceData = {
            model: streamContext.model,
            inputTokens: streamContext.inputTokens,
            outputTokens: streamContext.outputTokens,
            cacheCreationTokens: streamContext.cacheCreationTokens,
            cacheReadTokens: streamContext.cacheReadTokens,
            stopReason: streamContext.stopReason,
            latencyMs,
            workspaceId: identitySignals.workspaceId,
            sessionId: effectiveSessionId,
            taskId: identitySignals.taskId,
            policyDecision,
            conversationId,
          };
          deps.inflight.track(
            captureTrace(traceData, { surreal: deps.surreal }).catch(() => undefined),
          );
        }
      }
    })();

    return new Response(readable, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      },
    });
  };
}
