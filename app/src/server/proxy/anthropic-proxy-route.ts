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
 * 7. Async trace capture (01-03)
 */
import { elapsedMs } from "../http/observability";
import { jsonResponse } from "../http/response";
import { resolveIdentity, resolveAgentName } from "./identity-resolver";
import { resolveSessionId, resolveAgentSessionId } from "./session-id-resolver";
import { captureTrace, type TraceData } from "./trace-writer";
import {
  resolveSessionHash,
  type SessionHashInput,
} from "./session-hash-resolver";
import { upsertProxySession } from "./session-upserter";
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
  selectWithinBudget,
  rankByBm25WithRecency,
  buildBrainContextXml,
  injectBrainContext,
  injectRecentChanges,
  classifyByAge,
  buildRecentChangesXml,
  buildTimeWindowCutoff,
  createFetchRecentChangesByTime,
  createSearchContextByBm25,
  type ContextCandidate,
  type InjectionResult,
  type FetchRecentChangesByTime,
  type SearchContextByBm25,
} from "./context-injector";
import {
  resolveProxyAuth,
  createLookupProxyToken,
  createTokenCache,
  ProxyAuthError,
  type ProxyAuthResult,
  type LookupProxyToken,
  type TokenCache,
} from "./proxy-auth";
import type { ServerDependencies } from "../runtime/types";
import { RecordId } from "surrealdb";
import { trace } from "@opentelemetry/api";
import { log } from "../telemetry/logger";

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
// Auth Mode (dual-mode: Brain auth vs direct auth)
// ---------------------------------------------------------------------------

export type AuthMode =
  | { mode: "direct" }
  | { mode: "brain"; serverApiKey?: string };

// ---------------------------------------------------------------------------
// Header Forwarding
// ---------------------------------------------------------------------------

export function buildUpstreamHeaders(request: Request, authMode: AuthMode): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (authMode.mode === "brain" && authMode.serverApiKey) {
    // Brain auth with server-held API key: inject it, do not forward client auth
    headers.set("x-api-key", authMode.serverApiKey);
  } else {
    // Direct auth: forward client's auth headers as-is
    const xApiKey = request.headers.get("x-api-key");
    const authHeader = request.headers.get("authorization");
    if (xApiKey) headers.set("x-api-key", xApiKey);
    if (authHeader) headers.set("authorization", authHeader);
  }

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

type ProxyStage =
  | "parse_request"
  | "resolve_auth"
  | "resolve_identity"
  | "resolve_session"
  | "validate_workspace"
  | "evaluate_policy"
  | "inject_context"
  | "validate_api_key"
  | "forward_upstream"
  | "read_non_streaming_response"
  | "relay_stream"
  | "complete";

const ERROR_PREVIEW_MAX_CHARS = 240;

function toErrorPreview(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= ERROR_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, ERROR_PREVIEW_MAX_CHARS)}...`;
}

type ProxyErrorPayload = {
  error: {
    type: string;
    message: string;
  };
  stage?: string;
  trace_id?: string;
  upstream_status?: number;
};

export function buildProxyErrorPayload(
  type: string,
  message: string,
  options?: {
    stage?: string;
    traceId?: string;
    upstreamStatus?: number;
  },
): ProxyErrorPayload {
  return {
    error: { type, message },
    ...(options?.stage ? { stage: options.stage } : {}),
    ...(options?.traceId ? { trace_id: options.traceId } : {}),
    ...(options?.upstreamStatus !== undefined ? { upstream_status: options.upstreamStatus } : {}),
  };
}

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
  identity: { workspaceId?: string; taskId?: string; identityId?: string },
  sessionId?: string,
  policyDecision?: PolicyDecisionLog,
  injectionResult?: InjectionResult,
): TraceData | undefined {
  try {
    const parsed = JSON.parse(responseBody) as NonStreamingResponse;
    if (!parsed.usage) return undefined;

    const responseContent = extractResponseContent(responseBody);

    return {
      model: parsed.model ?? requestModel ?? "unknown",
      inputTokens: parsed.usage.input_tokens ?? 0,
      outputTokens: parsed.usage.output_tokens ?? 0,
      cacheCreationTokens: parsed.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: parsed.usage.cache_read_input_tokens ?? 0,
      stopReason: parsed.stop_reason,
      latencyMs,
      workspaceId: identity.workspaceId,
      identityId: identity.identityId,
      sessionId,
      taskId: identity.taskId,
      policyDecision,
      ...(injectionResult ? { intelligenceMetadata: buildIntelligenceMetadata(injectionResult) } : {}),
      ...(responseContent ? { responseContent } : {}),
    };
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

  type DecisionRow = { id: RecordId; summary: string };
  type LearningRow = { id: RecordId; text: string };
  type ObservationRow = { id: RecordId; text: string };

  // Single round-trip: no embedding fields fetched (02-01)
  const results = await surreal.query<[DecisionRow[], LearningRow[], ObservationRow[]]>(
    `SELECT id, summary FROM decision WHERE workspace = $ws AND status = 'confirmed' LIMIT 50;
     SELECT id, text FROM learning WHERE workspace = $ws AND status = 'active' LIMIT 30;
     SELECT id, text FROM observation WHERE workspace = $ws AND status = 'open' AND severity IN ['conflict', 'warning'] AND source_agent != 'llm-proxy' LIMIT 20;`,
    { ws: workspaceRecord },
  );

  function toCandidates<T extends { id: RecordId }>(
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
    }));
  }

  const decisions = toCandidates(results[0] ?? [], "decision", DECISION_WEIGHT, (d) => d.summary);
  const learnings = toCandidates(results[1] ?? [], "learning", LEARNING_WEIGHT, (l) => l.text);
  const observations = toCandidates(results[2] ?? [], "observation", OBSERVATION_WEIGHT, (o) => o.text);

  return {
    decisions,
    learnings,
    observations,
    populatedAt: Date.now(),
  };
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
  fetchRecentChanges?: FetchRecentChangesByTime,
  searchContextByBm25?: SearchContextByBm25,
): Promise<ContextInjectionResult> {
  if (!intelligenceConfig.contextInjectionEnabled) {
    return { body: originalBody };
  }

  // 1. Extract last user message text (for BM25 query)
  const messages = parsedBody.messages ?? [];
  let lastUserMessage: { role: string; content: string } | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserMessage = messages[i]; break; }
  }
  if (!lastUserMessage) {
    return { body: originalBody };
  }

  const queryText = lastUserMessage.content;
  const now = new Date();

  // 2. Search context candidates via BM25 fulltext (no embeddings)
  let selectedCandidates;
  if (searchContextByBm25) {
    // BM25 path: query-time search ranked by relevance + recency
    const bm25Candidates = await searchContextByBm25(queryText, workspaceId, 100);

    if (bm25Candidates.length === 0) {
      // Fallback: load cached pool without ranking (weight-based)
      const pool = await loadFallbackPool(deps, workspaceId, contextCache);
      if (!pool) return { body: originalBody };
      const allCandidates = [...pool.decisions, ...pool.learnings, ...pool.observations];
      const ranked = allCandidates.map((c) => ({ id: c.id, type: c.type, text: c.text, score: c.weight }));
      selectedCandidates = selectWithinBudget(ranked, intelligenceConfig.contextInjectionTokenBudget);
    } else {
      log.info("proxy.context_injection.bm25_search", "BM25 context search completed", {
        workspace_id: workspaceId,
        candidates: bm25Candidates.length,
      });
      const ranked = rankByBm25WithRecency(bm25Candidates, now);
      selectedCandidates = selectWithinBudget(ranked, intelligenceConfig.contextInjectionTokenBudget);
    }
  } else {
    // Legacy fallback: cached pool with weight-based ranking (no embeddings)
    const pool = await loadFallbackPool(deps, workspaceId, contextCache);
    if (!pool) return { body: originalBody };
    const allCandidates: ContextCandidate[] = [...pool.decisions, ...pool.learnings, ...pool.observations];
    const ranked = allCandidates.map((c) => ({ id: c.id, type: c.type, text: c.text, score: c.weight }));
    selectedCandidates = selectWithinBudget(ranked, intelligenceConfig.contextInjectionTokenBudget);
  }

  if (selectedCandidates.length === 0) {
    return { body: originalBody };
  }

  // 3. Build XML block
  const brainContextXml = buildBrainContextXml(selectedCandidates);

  // 4. Inject into system prompt
  const injectionResult = injectBrainContext(parsedBody.system, brainContextXml);

  // 5. Fetch and inject recent changes by time window (no embeddings, no BM25)
  let enrichedSystem = injectionResult.system;
  if (fetchRecentChanges) {
    try {
      const timeWindowMs = 24 * 60 * 60 * 1000; // 24-hour window
      const cutoff = buildTimeWindowCutoff(now, timeWindowMs);
      const recentCandidates = await fetchRecentChanges(workspaceId, cutoff, 20);
      const classified = classifyByAge(recentCandidates, now);
      const recentChangesXml = buildRecentChangesXml(classified);
      if (recentChangesXml) {
        enrichedSystem = injectRecentChanges(enrichedSystem, recentChangesXml);
      }
    } catch (error) {
      // Fail-open: log and continue without recent changes
      log.warn("proxy.context_injection.recent_changes_failed", "Recent changes fetch failed", {
        workspace_id: workspaceId,
        error: String(error),
      });
    }
  }

  // 6. Build modified request body
  const modifiedBody = {
    ...parsedBody,
    system: enrichedSystem,
  };

  return {
    body: JSON.stringify(modifiedBody),
    injectionResult,
  };
}

/** Load fallback candidate pool from cache or DB (legacy path). */
async function loadFallbackPool(
  deps: ServerDependencies,
  workspaceId: string,
  contextCache: ContextCache,
): Promise<CachedCandidatePool | undefined> {
  let fromCache = false;
  const pool = contextCache.has(workspaceId)
    ? (fromCache = true, contextCache.get(workspaceId)!)
    : await loadCandidatePool(deps.surreal, workspaceId);

  if (!fromCache) {
    contextCache.set(workspaceId, pool);
  }

  const total = pool.decisions.length + pool.learnings.length + pool.observations.length;
  if (total === 0) return undefined;

  log.info("proxy.context_injection.pool_loaded", "Candidate pool loaded", {
    workspace_id: workspaceId,
    decisions: pool.decisions.length,
    learnings: pool.learnings.length,
    observations: pool.observations.length,
    total,
    cached: fromCache,
  });

  return pool;
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
    identityId: identitySignals.proxyTokenIdentityId,
    sessionId: effectiveSessionId,
    taskId: identitySignals.taskId,
    policyDecision,
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

  // Proxy auth: per-handler cache + DB lookup function (not module-level singletons)
  const proxyTokenCache: TokenCache = createTokenCache();
  const lookupProxyToken: LookupProxyToken = createLookupProxyToken(deps.surreal);

  // Context search adapters (02-01: BM25 for context, 02-03: time-based for recent changes)
  const fetchRecentChanges: FetchRecentChangesByTime = createFetchRecentChangesByTime(deps.surreal);
  const searchContextByBm25: SearchContextByBm25 = createSearchContextByBm25(deps.surreal);

  // Periodic pruning of stale rate limiter entries to prevent unbounded Map growth.
  // unref() ensures this interval does not keep the process alive on shutdown.
  const pruneInterval = setInterval(
    () => {
      pruneStaleEntries(rateLimiterState, Date.now());
      const nowMs = Date.now();
      for (const [key, entry] of proxyTokenCache) {
        if (nowMs >= entry.expiresAt) proxyTokenCache.delete(key);
      }
    },
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
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;
    const requestMode = request.headers.get("X-Brain-Auth") ? "brain" : "direct";

    const setSpanAttributes = (attributes: Record<string, string | number | boolean | undefined>) => {
      if (!span) return;
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          span.setAttribute(key, value);
        }
      }
    };

    let currentStage: ProxyStage = "parse_request";
    const setStage = (stage: ProxyStage) => {
      currentStage = stage;
      setSpanAttributes({ "proxy.stage": stage });
    };
    setStage("parse_request");

    setSpanAttributes({
      "proxy.path": upstreamPath,
      "proxy.upstream_url": upstreamUrl,
      "proxy.is_count_tokens": isCountTokens,
      "proxy.request_mode": requestMode,
    });

    // --- Step 1: Parse request body (malformed body forwarded as-is) ---
    let body: string;
    let parsed: ParsedBody | undefined;
    let isStreaming = false;
    let identitySignals:
      | ReturnType<typeof resolveIdentity>
      | undefined;

    try {
      body = await request.text();
      parsed = tryParseRequestBody(body);
      isStreaming = parsed?.stream === true;
      setSpanAttributes({
        "proxy.request_body_parsed": parsed !== undefined,
        "proxy.request_body_bytes": body.length,
        "proxy.request_model": parsed?.model,
        "proxy.is_streaming": isStreaming,
      });

      // --- Step 1.5: Brain auth resolution (dual-mode) ---
      setStage("resolve_auth");
      let brainAuthResult: ProxyAuthResult | undefined;
      let authMode: AuthMode = { mode: "direct" };

      try {
        brainAuthResult = await resolveProxyAuth(
          request.headers,
          lookupProxyToken,
          proxyTokenCache,
        );
      } catch (error) {
        if (error instanceof ProxyAuthError) {
          setSpanAttributes({
            "proxy.error.type": "authentication_error",
            "proxy.error.stage": currentStage,
          });
          log.warn("proxy.anthropic.auth_failed", "Brain auth failed", {
            stage: currentStage,
            error: error.message,
          });
          return jsonResponse(
            buildProxyErrorPayload(
              "authentication_error",
              error.message,
              { stage: currentStage, traceId },
            ),
            401,
          );
        }
        throw error;
      }

      if (brainAuthResult) {
        // Brain auth mode: use server API key if available, otherwise forward client auth headers
        authMode = { mode: "brain", serverApiKey: deps.config.anthropicApiKey };
      }
      setSpanAttributes({ "proxy.auth_mode": authMode.mode });

      // --- Step 2: Identity resolution ---
      setStage("resolve_identity");
      // In Brain auth mode, workspace comes from the token (not from headers)
      identitySignals = resolveIdentity({
        metadataUserId: parsed?.metadata?.user_id,
        workspaceHeader: brainAuthResult?.workspaceId ?? (request.headers.get("X-Brain-Workspace") ?? undefined),
        taskHeader: request.headers.get("X-Brain-Task") ?? undefined,
        agentTypeHeader: request.headers.get("X-Brain-Agent-Type") ?? undefined,
        sessionHeader: request.headers.get("X-Brain-Session") ?? undefined,
        proxyTokenIdentityId: brainAuthResult?.identityId,
        userAgent: request.headers.get("User-Agent") ?? undefined,
      });
      setSpanAttributes({
        "proxy.workspace_id": identitySignals.workspaceId,
        "proxy.task_id": identitySignals.taskId,
        "proxy.agent_type": identitySignals.agentType,
        "proxy.session_header": identitySignals.sessionHeaderId,
      });

      // --- Step 3: Session ID resolution ---
      setStage("resolve_session");
      // resolveSessionId returns either the header PK or the external Claude Code
      // session UUID. Resolve to the actual agent_session PK via DB lookup.
      const rawSessionId = resolveSessionId(identitySignals);
      let effectiveSessionId = rawSessionId
        ? await resolveAgentSessionId(deps.surreal, rawSessionId)
        : undefined;
      setSpanAttributes({
        "proxy.session_id.raw": rawSessionId,
        "proxy.session_id.effective": effectiveSessionId,
      });

      // --- Step 3.5: Session hash fallback ---
      // When no explicit session signal exists, derive a deterministic session
      // identity from request content (system_prompt + first_user_message).
      if (!effectiveSessionId && identitySignals.workspaceId && parsed) {
        const sessionHashInput: SessionHashInput = {
          systemPrompt: typeof parsed.system === "string" ? parsed.system : undefined,
          systemPromptBlocks: Array.isArray(parsed.system) ? parsed.system : undefined,
          messages: parsed.messages ?? [],
        };
        const sessionHash = resolveSessionHash(sessionHashInput);

        if (sessionHash) {
          try {
            const upsertedSessionId = await upsertProxySession(
              {
                sessionId: sessionHash.sessionId,
                workspaceId: identitySignals.workspaceId,
                agent: resolveAgentName(identitySignals),
              },
              { surreal: deps.surreal },
            );
            if (upsertedSessionId) {
              effectiveSessionId = upsertedSessionId;
              setSpanAttributes({ "proxy.session_id.effective": effectiveSessionId });
            }
          } catch (error) {
            log.warn("proxy.anthropic.session_hash_upsert_failed", "Session hash upsert failed — continuing without session link", {
              error: String(error),
            });
          }
        }
      }

      // --- Workspace validation (non-blocking) ---
      setStage("validate_workspace");
      if (identitySignals.workspaceId) {
        const isValid = await validateWorkspace(
          deps.surreal,
          identitySignals.workspaceId,
          workspaceCache,
        );
        setSpanAttributes({ "proxy.workspace_valid": isValid });
        if (!isValid) {
          log.warn("proxy.anthropic.invalid_workspace", "Workspace not found in database", {
            workspaceId: identitySignals.workspaceId,
          });
        }
      }

      // --- Step 4: Policy evaluation ---
      setStage("evaluate_policy");
      let policyResult: ProxyPolicyResult | undefined;
      if (parsed?.model && !isCountTokens) {
        const policyDeps: ProxyPolicyDependencies = {
          surreal: deps.surreal,
          inflight: deps.inflight,
          rateLimiterState,
          spendCache,
          noPolicyWarnedWorkspaces,
        };

        policyResult = await evaluateProxyPolicy(
          {
            workspaceId: identitySignals.workspaceId ?? "",
            agentType: identitySignals.agentType,
            model: parsed.model,
          },
          policyDeps,
        );
        setSpanAttributes({
          "proxy.policy_decision": policyResult.decision,
          "proxy.policy_ids_count": policyResult.decision === "allow" ? policyResult.policyIds.length : undefined,
        });

        if (policyResult.decision !== "allow") {
          setSpanAttributes({
            "proxy.error.type": policyResult.decision,
            "proxy.error.stage": currentStage,
          });
          return buildPolicyDenialResponse(policyResult);
        }
      }

      // --- Step 5: Context injection (fail-open) ---
      setStage("inject_context");
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
            fetchRecentChanges,
            searchContextByBm25,
          );
          effectiveBody = contextResult.body;
          injectionResult = contextResult.injectionResult;
          if (intelligenceConfig.contextInjectionEnabled) {
            log.info("proxy.context_injection.result", "Context injection completed", {
              workspace_id: identitySignals.workspaceId,
              injected: injectionResult?.injected ?? false,
              decisions: injectionResult?.decisionsCount ?? 0,
              learnings: injectionResult?.learningsCount ?? 0,
              observations: injectionResult?.observationsCount ?? 0,
            });
            setSpanAttributes({
              "proxy.context_injected": injectionResult?.injected ?? false,
              "proxy.context_decision_count": injectionResult?.decisionsCount ?? 0,
              "proxy.context_learning_count": injectionResult?.learningsCount ?? 0,
              "proxy.context_observation_count": injectionResult?.observationsCount ?? 0,
            });
          }
        } catch (error) {
          // Fail-open: log warning and continue with original body
          setSpanAttributes({
            "proxy.context_injection_failed": true,
            "proxy.error.stage": currentStage,
          });
          log.warn("proxy.context_injection.failed", "Context injection failed, forwarding original request", {
            workspace_id: identitySignals.workspaceId,
            error: String(error),
          });
        }
      }

      // --- Step 5.5: Update agent_session.last_request_at (fire-and-forget) ---
      if (effectiveSessionId && !isCountTokens) {
        const sessionRecord = new RecordId("agent_session", effectiveSessionId);
        deps.inflight.track(
          deps.surreal.query(
            `UPDATE $sess SET last_request_at = time::now();`,
            { sess: sessionRecord },
          ).catch(() => undefined),
        );
      }

      // --- API key validation ---
      setStage("validate_api_key");
      const hasApiKey = request.headers.has("x-api-key");
      const hasAuthHeader = request.headers.has("authorization");
      const hasClientAuth = hasApiKey || hasAuthHeader;
      const hasServerAuth = authMode.mode === "brain" && authMode.serverApiKey !== undefined;

      if (hasServerAuth) {
        setSpanAttributes({ "proxy.upstream_auth_source": "server" });
      } else if (hasClientAuth) {
        setSpanAttributes({ "proxy.upstream_auth_source": "client" });
      } else if (authMode.mode === "brain") {
        // Brain auth succeeded but server has no ANTHROPIC_API_KEY configured —
        // this is a server misconfiguration, not a client auth error.
        setSpanAttributes({
          "proxy.upstream_auth_source": "missing",
          "proxy.error.type": "server_error",
          "proxy.error.stage": currentStage,
        });
        return jsonResponse(
          buildProxyErrorPayload(
            "server_error",
            "API key not configured: server ANTHROPIC_API_KEY is required for Brain-authenticated proxy requests",
            { stage: currentStage, traceId },
          ),
          500,
        );
      } else {
        setSpanAttributes({
          "proxy.upstream_auth_source": "missing",
          "proxy.error.type": "authentication_error",
          "proxy.error.stage": currentStage,
        });
        return jsonResponse(
          buildProxyErrorPayload(
            "authentication_error",
            "Missing x-api-key or authorization header",
            { stage: currentStage, traceId },
          ),
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
        identity_id: identitySignals.proxyTokenIdentityId,
        is_count_tokens: isCountTokens || undefined,
      };

      log.info("proxy.anthropic.request", "Forwarding to Anthropic", {
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
      setStage("forward_upstream");
      const upstreamHeaders = buildUpstreamHeaders(request, authMode);

      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, {
          method: request.method,
          headers: upstreamHeaders,
          body: request.method !== "GET" ? effectiveBody : undefined,
        });
      } catch (error) {
        setSpanAttributes({
          "proxy.error.type": "upstream_unreachable",
          "proxy.error.stage": currentStage,
        });
        log.error("proxy.anthropic.upstream_error", "Failed to reach Anthropic API", error, {
          stage: currentStage,
          ...identityContext,
        });
        return jsonResponse(
          buildProxyErrorPayload(
            "upstream_unreachable",
            "Failed to reach Anthropic API",
            { stage: currentStage, traceId },
          ),
          502,
        );
      }
      setSpanAttributes({ "proxy.upstream_status_code": upstream.status });

      // --- Non-streaming response ---
      if (!isStreaming) {
        setStage("read_non_streaming_response");
        const responseBody = await upstream.text();
        const latencyMs = elapsedMs(startedAt);

        log.info("proxy.anthropic.response", "Anthropic response", {
          status: upstream.status,
          latency_ms: latencyMs,
          ...identityContext,
        });

        if (upstream.status >= 400) {
          const errorPreview = toErrorPreview(responseBody);
          setSpanAttributes({
            "proxy.error.type": "upstream_error",
            "proxy.error.stage": currentStage,
            "proxy.upstream_error_status": upstream.status,
            "proxy.upstream_error_preview": errorPreview,
          });
          log.warn("proxy.anthropic.upstream_non_2xx", "Upstream returned non-2xx response", {
            upstream_status: upstream.status,
            stage: currentStage,
            upstream_error_preview: errorPreview,
            ...identityContext,
          });
        }

        // Async trace capture for non-streaming (skip count_tokens)
        if (!isCountTokens && upstream.status >= 200 && upstream.status < 300) {
          const traceData = extractNonStreamingUsage(responseBody, parsed?.model, latencyMs, { workspaceId: identitySignals.workspaceId, taskId: identitySignals.taskId, identityId: identitySignals.proxyTokenIdentityId }, effectiveSessionId, policyDecision, injectionResult);
          if (traceData) {
            deps.inflight.track(
              captureTrace(traceData, { surreal: deps.surreal }).catch(() => undefined),
            );
          }
        }

        setStage("complete");
        return new Response(responseBody, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("content-type") ?? "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // --- Streaming: pipe SSE events through ---
      setStage("relay_stream");
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
          setSpanAttributes({
            "proxy.error.type": "stream_error",
            "proxy.error.stage": currentStage,
          });
          log.error("proxy.anthropic.stream_error", "SSE relay error", error, {
            stage: currentStage,
            ...identityContext,
          });
        } finally {
          await writer.close();

          const latencyMs = elapsedMs(startedAt);

          log.info("proxy.anthropic.response", "Anthropic stream complete", {
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
              effectiveSessionId, policyDecision, injectionResult,
            );
            deps.inflight.track(
              captureTrace(traceData, { surreal: deps.surreal }).catch(() => undefined),
            );
          }

          setStage("complete");
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
    } catch (error) {
      setSpanAttributes({
        "proxy.error.type": "internal_error",
        "proxy.error.stage": currentStage,
      });
      log.error("proxy.anthropic.unhandled_error", "Unhandled proxy route error", error, {
        stage: currentStage,
        workspace_id: identitySignals?.workspaceId,
        task_id: identitySignals?.taskId,
      });
      return jsonResponse(
        buildProxyErrorPayload(
          "proxy_internal_error",
          "Internal proxy error",
          { stage: currentStage, traceId },
        ),
        500,
      );
    }
  };
}
