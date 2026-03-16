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
import { resolveSessionId, resolveAgentSessionId } from "./session-id-resolver";
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
  pruneStaleEntries,
  type RateLimiterState,
} from "./rate-limiter";
import {
  loadIntelligenceConfig,
  type IntelligenceConfig,
} from "./intelligence-config";
import {
  createContextCache,
  type ContextCache,
  type CachedCandidatePool,
  type CandidateItem,
} from "./context-cache";
import {
  rankCandidates,
  selectWithinBudget,
  buildBrainContextXml,
  injectBrainContext,
  type ContextCandidate,
  type InjectionResult,
} from "./context-injector";
import type { ServerDependencies } from "../runtime/types";
import { RecordId } from "surrealdb";

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
  injectionResult?: InjectionResult,
): TraceData | undefined {
  try {
    const parsed = JSON.parse(responseBody) as NonStreamingResponse;
    if (!parsed.usage) return undefined;

    const traceData: TraceData = {
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

    // Add intelligence metadata if injection occurred
    if (injectionResult) {
      (traceData as any).intelligenceMetadata = buildIntelligenceMetadata(injectionResult);
    }

    // Capture response content (opaque, per ADR-051)
    const responseContent = extractResponseContent(responseBody);
    if (responseContent) {
      (traceData as any).responseContent = responseContent;
    }

    return traceData;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Context Candidate Pool Loader (adapter boundary)
// ---------------------------------------------------------------------------

const DECISION_WEIGHT = 1.0;
const LEARNING_WEIGHT = 0.8;
const OBSERVATION_WEIGHT = 0.7;

async function loadCandidatePool(
  surreal: ServerDependencies["surreal"],
  workspaceId: string,
): Promise<CachedCandidatePool> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  type DecisionRow = { id: RecordId; summary: string; embedding?: number[] };
  type LearningRow = { id: RecordId; text: string; embedding?: number[] };
  type ObservationRow = { id: RecordId; text: string; embedding?: number[] };

  // Sequential queries to avoid SurrealDB SDK concurrency issues with
  // multiple parallel queries on a single WebSocket connection
  const decisionResults = await surreal.query<[DecisionRow[]]>(
    `SELECT id, summary, embedding FROM decision WHERE workspace = $ws AND status = 'confirmed' LIMIT 50;`,
    { ws: workspaceRecord },
  );
  const learningResults = await surreal.query<[LearningRow[]]>(
    `SELECT id, text, embedding FROM learning WHERE workspace = $ws AND status = 'active' LIMIT 30;`,
    { ws: workspaceRecord },
  );
  const observationResults = await surreal.query<[ObservationRow[]]>(
    `SELECT id, text, embedding FROM observation WHERE workspace = $ws AND status = 'open' AND severity IN ['conflict', 'warning'] AND observation_type NOT IN ['proxy_no_policy'] LIMIT 20;`,
    { ws: workspaceRecord },
  );

  function toCandidates<T extends { id: RecordId; embedding?: number[] }>(
    rows: T[],
    type: CandidateItem["type"],
    weight: number,
    textFn: (row: T) => string,
  ): CandidateItem[] {
    return rows.map((row) => ({
      id: (row.id as RecordId).id as string,
      type,
      text: textFn(row),
      weight,
      embedding: row.embedding,
    }));
  }

  const decisions = toCandidates(decisionResults[0] ?? [], "decision", DECISION_WEIGHT, (d) => d.summary);
  const learnings = toCandidates(learningResults[0] ?? [], "learning", LEARNING_WEIGHT, (l) => l.text);
  const observations = toCandidates(observationResults[0] ?? [], "observation", OBSERVATION_WEIGHT, (o) => o.text);

  return {
    decisions,
    learnings,
    observations,
    populatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Embedding Helper (adapter boundary)
// ---------------------------------------------------------------------------

async function embedUserMessage(
  embeddingModel: ServerDependencies["embeddingModel"],
  embeddingDimension: number,
  text: string,
): Promise<number[] | undefined> {
  try {
    const { embed } = await import("ai");
    const normalized = text.trim();
    if (normalized.length === 0) return undefined;

    const result = await embed({
      model: embeddingModel,
      value: normalized,
    });

    if (result.embedding.length !== embeddingDimension) return undefined;
    return result.embedding;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Context Injection Pipeline (orchestrator)
// ---------------------------------------------------------------------------

type ContextInjectionResult = {
  readonly body: string;
  readonly injectionResult?: InjectionResult;
};

async function runContextInjection(
  deps: ServerDependencies,
  workspaceId: string,
  parsedBody: ParsedBody,
  originalBody: string,
  contextCache: ContextCache,
  intelligenceConfig: IntelligenceConfig,
): Promise<ContextInjectionResult> {
  if (!intelligenceConfig.contextInjectionEnabled) {
    return { body: originalBody };
  }

  // 1. Get or populate candidate pool (with cache)
  let pool: CachedCandidatePool;
  let fromCache = false;
  if (contextCache.has(workspaceId)) {
    pool = contextCache.get(workspaceId)!;
    fromCache = true;
  } else {
    pool = await loadCandidatePool(deps.surreal, workspaceId);
    contextCache.set(workspaceId, pool);
  }

  // 2. Check if pool is empty
  const allCandidates: ContextCandidate[] = [
    ...pool.decisions,
    ...pool.learnings,
    ...pool.observations,
  ];
  if (allCandidates.length === 0) {
    return { body: originalBody };
  }

  logInfo("proxy.context_injection.pool_loaded", "Candidate pool loaded", {
    workspace_id: workspaceId,
    decisions: pool.decisions.length,
    learnings: pool.learnings.length,
    observations: pool.observations.length,
    total: allCandidates.length,
    cached: fromCache,
  });

  // 3. Extract last user message for embedding
  const lastUserMessage = [...(parsedBody.messages ?? [])].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return { body: originalBody };
  }

  // 4. Embed last user message
  const queryEmbedding = await embedUserMessage(
    deps.embeddingModel,
    deps.config.embeddingDimension,
    lastUserMessage.content,
  );

  let selectedCandidates;
  if (queryEmbedding) {
    // 5. Rank candidates by weighted cosine similarity
    const ranked = rankCandidates(allCandidates, queryEmbedding);
    // 6. Select within token budget
    selectedCandidates = selectWithinBudget(ranked, intelligenceConfig.contextInjectionTokenBudget);
  } else {
    // No embedding available -- fall back to all candidates within budget
    const ranked = allCandidates.map((c) => ({
      id: c.id,
      type: c.type,
      text: c.text,
      score: c.weight,
    }));
    selectedCandidates = selectWithinBudget(ranked, intelligenceConfig.contextInjectionTokenBudget);
  }

  if (selectedCandidates.length === 0) {
    return { body: originalBody };
  }

  // 7. Build XML block
  const brainContextXml = buildBrainContextXml(selectedCandidates);

  // 8. Inject into system prompt
  const injectionResult = injectBrainContext(parsedBody.system, brainContextXml);

  // 9. Build modified request body
  const modifiedBody = {
    ...parsedBody,
    system: injectionResult.system,
  };

  return {
    body: JSON.stringify(modifiedBody),
    injectionResult,
  };
}

// ---------------------------------------------------------------------------
// Intelligence Metadata Builder (pure)
// ---------------------------------------------------------------------------

function buildIntelligenceMetadata(injectionResult: InjectionResult) {
  return {
    brain_context_injected: injectionResult.injected,
    brain_context_decisions: injectionResult.decisionsCount,
    brain_context_learnings: injectionResult.learningsCount,
    brain_context_observations: injectionResult.observationsCount,
    brain_context_tokens_est: injectionResult.tokensEstimated,
  };
}

// ---------------------------------------------------------------------------
// Non-Streaming Response Content Extraction (for trace output)
// ---------------------------------------------------------------------------

type ResponseContent = {
  content_blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
  };
};

function extractResponseContent(responseBody: string): ResponseContent | undefined {
  try {
    const parsed = JSON.parse(responseBody);
    if (!parsed.content || !parsed.usage) return undefined;

    return {
      content_blocks: parsed.content,
      stop_reason: parsed.stop_reason ?? "end_turn",
      usage: {
        input_tokens: parsed.usage.input_tokens ?? 0,
        output_tokens: parsed.usage.output_tokens ?? 0,
        cache_creation_tokens: parsed.usage.cache_creation_input_tokens,
        cache_read_tokens: parsed.usage.cache_read_input_tokens,
      },
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Policy Denial Response Builder
// ---------------------------------------------------------------------------

function buildPolicyDenialResponse(
  result: Exclude<ProxyPolicyResult, { decision: "allow" }>,
): Response {
  if (result.decision === "deny_rate_limit") {
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSeconds),
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  return jsonResponse(result.body, result.status);
}

// ---------------------------------------------------------------------------
// Streaming Trace Builder
// ---------------------------------------------------------------------------

function buildStreamingTraceData(
  streamCtx: StreamContext,
  latencyMs: number,
  identitySignals: import("./identity-resolver").IdentitySignals,
  effectiveSessionId: string | undefined,
  policyDecision: PolicyDecisionLog | undefined,
  conversationId: string | undefined,
  injectionResult: InjectionResult | undefined,
): TraceData {
  return {
    model: streamCtx.model!,
    inputTokens: streamCtx.inputTokens,
    outputTokens: streamCtx.outputTokens,
    cacheCreationTokens: streamCtx.cacheCreationTokens,
    cacheReadTokens: streamCtx.cacheReadTokens,
    stopReason: streamCtx.stopReason,
    latencyMs,
    workspaceId: identitySignals.workspaceId,
    sessionId: effectiveSessionId,
    taskId: identitySignals.taskId,
    policyDecision,
    conversationId,
    ...(injectionResult ? {
      intelligenceMetadata: buildIntelligenceMetadata(injectionResult),
    } : {}),
  };
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
  const noPolicyWarnedWorkspaces = new Set<string>();
  const contextCache: ContextCache = createContextCache(300); // default TTL, overridden per-workspace

  // Periodic pruning of stale rate limiter entries to prevent unbounded Map growth.
  // unref() ensures this interval does not keep the process alive on shutdown.
  const pruneInterval = setInterval(
    () => pruneStaleEntries(rateLimiterState, Date.now()),
    5 * 60 * 1000,
  );
  pruneInterval.unref();

  const anthropicApiUrl = deps.config.anthropicApiUrl;

  return async (request: Request): Promise<Response> => {
    const startedAt = performance.now();
    const url = new URL(request.url);
    const upstreamPath = url.pathname.replace(/^\/proxy\/llm\/anthropic/, "");
    const upstreamUrl = `${anthropicApiUrl}${upstreamPath}`;
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
    // resolveSessionId returns either the header PK or the external Claude Code
    // session UUID. Resolve to the actual agent_session PK via DB lookup.
    const rawSessionId = resolveSessionId(identitySignals);
    const effectiveSessionId = rawSessionId
      ? await resolveAgentSessionId(deps.surreal, rawSessionId)
      : undefined;

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
        noPolicyWarnedWorkspaces,
      );

      if (policyResult.decision !== "allow") {
        return buildPolicyDenialResponse(policyResult);
      }
    }

    // --- Step 5: Context injection (fail-open) ---
    let effectiveBody = body;
    let injectionResult: InjectionResult | undefined;

    if (parsed && identitySignals.workspaceId && !isCountTokens) {
      try {
        const intelligenceConfig = await loadIntelligenceConfig(deps.surreal, identitySignals.workspaceId);
        const contextResult = await runContextInjection(
          deps,
          identitySignals.workspaceId,
          parsed,
          body,
          contextCache,
          intelligenceConfig,
        );
        effectiveBody = contextResult.body;
        injectionResult = contextResult.injectionResult;
        if (intelligenceConfig.contextInjectionEnabled) {
          logInfo("proxy.context_injection.result", "Context injection completed", {
            workspace_id: identitySignals.workspaceId,
            injected: injectionResult?.injected ?? false,
            decisions: injectionResult?.decisionsCount ?? 0,
            learnings: injectionResult?.learningsCount ?? 0,
            observations: injectionResult?.observationsCount ?? 0,
          });
        }
      } catch (error) {
        // Fail-open: log warning and continue with original body
        logWarn("proxy.context_injection.failed", "Context injection failed, forwarding original request", {
          workspace_id: identitySignals.workspaceId,
          error: String(error),
        });
      }
    }

    // --- API key validation ---
    const hasApiKey = request.headers.has("x-api-key");
    const hasAuthHeader = request.headers.has("authorization");
    if (!hasApiKey && !hasAuthHeader) {
      return jsonResponse(
        { error: "unauthorized", message: "Missing x-api-key or authorization header" },
        401,
      );
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
        body: request.method !== "GET" ? effectiveBody : undefined,
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
        const traceData = extractNonStreamingUsage(responseBody, parsed?.model, latencyMs, identitySignals, effectiveSessionId, policyDecision, conversationId, injectionResult);
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
          const traceData = buildStreamingTraceData(
            streamContext, latencyMs, identitySignals,
            effectiveSessionId, policyDecision, conversationId, injectionResult,
          );
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
