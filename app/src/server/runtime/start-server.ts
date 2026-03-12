import appHtml from "../../client/index.html";
import { withRequestLogging } from "../http/request-logging";
import { jsonResponse } from "../http/response";
import { logError, logInfo } from "../http/observability";
import { createSseRegistry } from "../streaming/sse-registry";
import { createRuntimeDependencies } from "./dependencies";
import { loadServerConfig } from "./config";
import { createInflightTracker } from "./types";
import type { ServerDependencies } from "./types";
import { ensureDefaultWorkspaceProjectScope } from "../workspace/workspace-scope";
import { createWorkspaceRouteHandlers } from "../workspace/workspace-routes";
import { createChatIngressHandlers } from "../chat/chat-ingress";
import { createEntitySearchHandler } from "../entities/entity-search-route";
import { createGraphRouteHandler } from "../graph/graph-route";
import { createEntityDetailHandler } from "../entities/entity-detail-route";
import { createEntityActionsHandler } from "../entities/entity-actions-route";
import { createWorkItemAcceptHandler } from "../entities/work-item-accept-route";
import { createBranchConversationHandler } from "../chat/branch-conversation";
import { createGitHubWebhookHandler } from "../webhook/github-webhook-route";
import { createFeedRouteHandler } from "../feed/feed-route";
import { createChatRouteHandler } from "../chat/chat-route";
import { createMcpRouteHandlers } from "../mcp/mcp-route";
import { createIntentRouteHandlers } from "../intent/intent-routes";
import { wireOrchestratorRoutes } from "../orchestrator/routes";
import type { ShellExec } from "../orchestrator/worktree-manager";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { BRAIN_SCOPES } from "../auth/scopes";
import { createClientInfoHandler } from "../auth/client-info-route";
import { createVetoManager } from "../intent/veto-manager";
import { updateIntentStatus, queryExpiredVetoIntents } from "../intent/intent-queries";
import { buildJwksResponse } from "../oauth/as-key-management";
import { createIntentSubmissionHandler } from "../oauth/intent-submission";
import { createTokenEndpointHandler } from "../oauth/token-endpoint";
import { createNonceCache } from "../oauth/nonce-cache";
import { createBridgeExchangeHandler } from "../oauth/bridge";
import { RecordId } from "surrealdb";
import { createObserverRouteHandler, createGraphScanRouteHandler } from "../observer/observer-route";

export function createBrainServer(deps: ServerDependencies): ReturnType<typeof Bun.serve> {
  const config = deps.config;

  // Shell execution — shared by workspace and orchestrator routes
  const shellExec: ShellExec = async (command, args, cwd) => {
    const proc = Bun.spawn([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  };

  const workspaceHandlers = createWorkspaceRouteHandlers(deps, shellExec);
  const chatHandlers = createChatIngressHandlers(deps);
  const entitySearchHandler = createEntitySearchHandler(deps);
  const graphHandler = createGraphRouteHandler(deps);
  const entityDetailHandler = createEntityDetailHandler(deps);
  const entityActionsHandler = createEntityActionsHandler(deps);
  const workItemAcceptHandler = createWorkItemAcceptHandler(deps);
  const branchConversationHandler = createBranchConversationHandler(deps);
  const githubWebhookHandler = createGitHubWebhookHandler(deps);
  const feedHandler = createFeedRouteHandler(deps);
  const chatRouteHandler = createChatRouteHandler(deps);
  const mcpHandlers = createMcpRouteHandlers(deps);
  const intentHandlers = createIntentRouteHandlers(deps);
  const intentSubmissionHandler = createIntentSubmissionHandler(deps);
  const tokenEndpointHandler = createTokenEndpointHandler(deps);
  const bridgeExchangeHandler = createBridgeExchangeHandler(deps);
  const observerHandler = createObserverRouteHandler(deps);
  const graphScanHandler = createGraphScanRouteHandler(deps);

  // Orchestrator wiring
  const orchestratorHandlers = wireOrchestratorRoutes({
    surreal: deps.surreal,
    shellExec,
    brainBaseUrl: `http://127.0.0.1:${config.port}`,
    sseRegistry: deps.sse,
    queryFn: query,
    auth: deps.auth,
  });

  return Bun.serve({
    port: config.port,
    idleTimeout: 0,
    routes: {
      "/healthz": {
        GET: withRequestLogging("GET /healthz", "GET", async () => jsonResponse({ status: "ok" }, 200)),
      },
      "/api/workspaces": {
        POST: withRequestLogging("POST /api/workspaces", "POST", (request) => workspaceHandlers.handleCreateWorkspace(request)),
      },
      "/api/workspaces/:workspaceId/bootstrap": {
        GET: withRequestLogging(
          "GET /api/workspaces/:workspaceId/bootstrap",
          "GET",
          (request) => workspaceHandlers.handleWorkspaceBootstrap(request.params.workspaceId),
        ),
      },
      "/api/workspaces/:workspaceId/sidebar": {
        GET: withRequestLogging(
          "GET /api/workspaces/:workspaceId/sidebar",
          "GET",
          (request) => workspaceHandlers.handleWorkspaceSidebar(request.params.workspaceId),
        ),
      },
      "/api/workspaces/:workspaceId/repo-path": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/repo-path",
          "POST",
          (request) => workspaceHandlers.handleUpdateRepoPath(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/conversations/:conversationId": {
        GET: withRequestLogging(
          "GET /api/workspaces/:workspaceId/conversations/:conversationId",
          "GET",
          (request) =>
            workspaceHandlers.handleWorkspaceConversation(
              request.params.workspaceId,
              request.params.conversationId,
            ),
        ),
      },
      "/api/chat": {
        POST: withRequestLogging("POST /api/chat", "POST", (request) => chatRouteHandler(request)),
      },
      "/api/chat/messages": {
        POST: withRequestLogging("POST /api/chat/messages", "POST", (request) => chatHandlers.handlePostChatMessage(request)),
      },
      "/api/chat/stream/:messageId": {
        GET: withRequestLogging("GET /api/chat/stream/:messageId", "GET", (request) =>
          chatHandlers.handleChatStream(request.params.messageId),
        ),
      },
      "/api/entities/search": {
        GET: withRequestLogging("GET /api/entities/search", "GET", (request) => entitySearchHandler(new URL(request.url))),
      },
      "/api/graph/:workspaceId": {
        GET: withRequestLogging("GET /api/graph/:workspaceId", "GET", (request) =>
          graphHandler(request.params.workspaceId, new URL(request.url)),
        ),
      },
      "/api/entities/:entityId": {
        GET: withRequestLogging("GET /api/entities/:entityId", "GET", (request) =>
          entityDetailHandler(request.params.entityId, new URL(request.url)),
        ),
      },
      "/api/entities/:entityId/actions": {
        POST: withRequestLogging("POST /api/entities/:entityId/actions", "POST", (request) =>
          entityActionsHandler(request.params.entityId, request),
        ),
      },
      "/api/workspaces/:workspaceId/conversations/:parentId/branch": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/conversations/:parentId/branch",
          "POST",
          (request) =>
            branchConversationHandler(
              request.params.workspaceId,
              request.params.parentId,
              request,
            ),
        ),
      },
      "/api/workspaces/:workspaceId/work-items/accept": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/work-items/accept",
          "POST",
          (request) => workItemAcceptHandler(request.params.workspaceId, request),
        ),
      },
      "/api/workspaces/:workspaceId/feed": {
        GET: withRequestLogging(
          "GET /api/workspaces/:workspaceId/feed",
          "GET",
          (request) => feedHandler(request.params.workspaceId),
        ),
      },
      "/api/workspaces/:workspaceId/webhooks/github": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/webhooks/github",
          "POST",
          (request) => githubWebhookHandler(request.params.workspaceId, request),
        ),
      },
      // Orchestrator — coding agent session management
      "/api/orchestrator/:workspaceId/assign": {
        POST: orchestratorHandlers.assign,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId": {
        GET: orchestratorHandlers.status,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/accept": {
        POST: orchestratorHandlers.accept,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/abort": {
        POST: orchestratorHandlers.abort,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/review": {
        GET: orchestratorHandlers.review,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/reject": {
        POST: orchestratorHandlers.reject,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/prompt": {
        POST: orchestratorHandlers.prompt,
      },
      "/api/orchestrator/:workspaceId/sessions/:sessionId/stream": {
        GET: orchestratorHandlers.stream!,
      },
      // MCP — Setup
      "/api/mcp/:workspaceId/projects": {
        GET: withRequestLogging("GET /api/mcp/:workspaceId/projects", "GET", (request) =>
          mcpHandlers.handleListProjects(request.params.workspaceId),
        ),
      },
      // MCP — Intent-based context
      "/api/mcp/:workspaceId/context": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/context", "POST", (request) =>
          mcpHandlers.handleIntentContext(request.params.workspaceId, request),
        ),
      },
      // MCP — Tier 1 Read
      "/api/mcp/:workspaceId/workspace-context": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/workspace-context", "POST", (request) =>
          mcpHandlers.handleWorkspaceContext(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/project-context": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/project-context", "POST", (request) =>
          mcpHandlers.handleProjectContext(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/task-context": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/task-context", "POST", (request) =>
          mcpHandlers.handleTaskContext(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/decisions": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/decisions", "POST", (request) =>
          mcpHandlers.handleGetDecisions(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/tasks/dependencies": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/tasks/dependencies", "POST", (request) =>
          mcpHandlers.handleGetTaskDependencies(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/constraints": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/constraints", "POST", (request) =>
          mcpHandlers.handleGetConstraints(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/changes": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/changes", "POST", (request) =>
          mcpHandlers.handleGetChanges(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/entities/:entityId": {
        GET: withRequestLogging("GET /api/mcp/:workspaceId/entities/:entityId", "GET", (request) =>
          mcpHandlers.handleGetEntityDetail(request.params.workspaceId, request.params.entityId, request),
        ),
      },
      // MCP — Tier 2 Reason
      "/api/mcp/:workspaceId/decisions/resolve": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/decisions/resolve", "POST", (request) =>
          mcpHandlers.handleResolveDecision(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/constraints/check": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/constraints/check", "POST", (request) =>
          mcpHandlers.handleCheckConstraints(request.params.workspaceId, request),
        ),
      },
      // MCP — Tier 3 Write
      "/api/mcp/:workspaceId/decisions/provisional": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/decisions/provisional", "POST", (request) =>
          mcpHandlers.handleCreateProvisionalDecision(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/questions": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/questions", "POST", (request) =>
          mcpHandlers.handleAskQuestion(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/tasks/status": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/tasks/status", "POST", (request) =>
          mcpHandlers.handleUpdateTaskStatus(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/tasks/subtask": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/tasks/subtask", "POST", (request) =>
          mcpHandlers.handleCreateSubtask(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/notes": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/notes", "POST", (request) =>
          mcpHandlers.handleLogNote(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/observations": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/observations", "POST", (request) =>
          mcpHandlers.handleLogObservation(request.params.workspaceId, request),
        ),
      },
      // MCP — Suggestions
      "/api/mcp/:workspaceId/suggestions": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/suggestions", "POST", (request) =>
          mcpHandlers.handleListSuggestions(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/suggestions/create": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/suggestions/create", "POST", (request) =>
          mcpHandlers.handleCreateSuggestion(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/suggestions/action": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/suggestions/action", "POST", (request) =>
          mcpHandlers.handleSuggestionAction(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/suggestions/convert": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/suggestions/convert", "POST", (request) =>
          mcpHandlers.handleConvertSuggestion(request.params.workspaceId, request),
        ),
      },
      // MCP — Lifecycle
      "/api/mcp/:workspaceId/sessions/start": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/sessions/start", "POST", (request) =>
          mcpHandlers.handleSessionStart(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/sessions/end": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/sessions/end", "POST", (request) =>
          mcpHandlers.handleSessionEnd(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/commits": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/commits", "POST", (request) =>
          mcpHandlers.handleLogCommit(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/commits/pre-check": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/commits/pre-check", "POST", (request) =>
          mcpHandlers.handlePreCheck(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/commits/post-check": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/commits/post-check", "POST", (request) =>
          mcpHandlers.handlePostCheck(request.params.workspaceId, request),
        ),
      },
      // MCP — Intent tools
      "/api/mcp/:workspaceId/intents/create": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/intents/create", "POST", (request) =>
          mcpHandlers.handleCreateIntent(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/intents/submit": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/intents/submit", "POST", (request) =>
          mcpHandlers.handleSubmitIntent(request.params.workspaceId, request),
        ),
      },
      "/api/mcp/:workspaceId/intents/status": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/intents/status", "POST", (request) =>
          mcpHandlers.handleGetIntentStatus(request.params.workspaceId, request),
        ),
      },
      // Observer — periodic graph scan
      "/api/observe/scan/:workspaceId": {
        POST: withRequestLogging("POST /api/observe/scan/:workspaceId", "POST", (request) =>
          graphScanHandler(request.params.workspaceId, request),
        ),
      },
      // Observer — verification pipeline (called by SurrealQL EVENT via http::post)
      "/api/observe/:table/:id": {
        POST: withRequestLogging("POST /api/observe/:table/:id", "POST", (request) =>
          observerHandler(request.params.table, request.params.id, request),
        ),
      },
      // Intent — evaluate (called by SurrealQL EVENT via http::post)
      "/api/intents/:intentId/evaluate": {
        POST: withRequestLogging("POST /api/intents/:intentId/evaluate", "POST", (request) =>
          intentHandlers.handleEvaluate(request.params.intentId, request),
        ),
      },
      // Intent — consent display
      "/api/workspaces/:workspaceId/intents/:intentId/consent": {
        GET: withRequestLogging(
          "GET /api/workspaces/:workspaceId/intents/:intentId/consent",
          "GET",
          (request) =>
            intentHandlers.handleConsent(request.params.workspaceId, request.params.intentId),
        ),
      },
      // Intent — approve from consent
      "/api/workspaces/:workspaceId/intents/:intentId/approve": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/intents/:intentId/approve",
          "POST",
          (request) =>
            intentHandlers.handleApprove(request.params.workspaceId, request.params.intentId),
        ),
      },
      // Intent — constrain from consent
      "/api/workspaces/:workspaceId/intents/:intentId/constrain": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/intents/:intentId/constrain",
          "POST",
          (request) =>
            intentHandlers.handleConstrain(request.params.workspaceId, request.params.intentId, request),
        ),
      },
      // Intent — veto
      "/api/workspaces/:workspaceId/intents/:intentId/veto": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/intents/:intentId/veto",
          "POST",
          (request) =>
            intentHandlers.handleVeto(request.params.workspaceId, request.params.intentId, request),
        ),
      },
      // Intent — list pending for governance feed
      "/api/workspaces/:workspaceId/intents/pending": {
        GET: withRequestLogging(
          "GET /api/workspaces/:workspaceId/intents/pending",
          "GET",
          (request) => intentHandlers.handleListPending(request.params.workspaceId),
        ),
      },
      // Identity discovery — returns owner identity for CLI DPoP token acquisition
      "/api/auth/identity/:workspaceId": {
        GET: withRequestLogging("GET /api/auth/identity/:workspaceId", "GET", async (request) => {
          const wsId = request.params.workspaceId;
          const rows = await deps.surreal.query<[Array<{ identityId: string }>]>(
            `SELECT meta::id(id) AS identityId FROM identity WHERE workspace = $ws AND type = "owner" LIMIT 1;`,
            { ws: new RecordId("workspace", wsId) },
          );
          const row = rows[0]?.[0];
          if (!row) return jsonResponse({ error: "workspace_not_found" }, 404);
          return jsonResponse({ identity_id: row.identityId }, 200);
        }),
      },
      // OAuth 2.1 RAR+DPoP — Intent submission with DPoP thumbprint binding
      "/api/auth/intents": {
        POST: withRequestLogging("POST /api/auth/intents", "POST", (request) =>
          intentSubmissionHandler(request),
        ),
      },
      // OAuth 2.1 RAR+DPoP — Token endpoint
      "/api/auth/token": {
        POST: withRequestLogging("POST /api/auth/token", "POST", (request) =>
          tokenEndpointHandler(request),
        ),
      },
      // OAuth 2.1 RAR+DPoP — Bridge session-to-token exchange
      "/api/auth/bridge/exchange": {
        POST: withRequestLogging("POST /api/auth/bridge/exchange", "POST", (request) =>
          bridgeExchangeHandler(request),
        ),
      },
      // AS JWKS endpoint — public keys for token verification
      "/api/auth/brain/.well-known/jwks": {
        GET: withRequestLogging("GET /api/auth/brain/.well-known/jwks", "GET", async () =>
          jsonResponse(buildJwksResponse(deps.asSigningKey), 200),
        ),
      },
      // OAuth 2.1 discovery — proxy root-level .well-known to better-auth handler
      "/.well-known/oauth-authorization-server/*": {
        GET: async (request) => deps.auth.handler(request),
      },
      "/.well-known/oauth-protected-resource": {
        GET: () => jsonResponse({
          resource: config.betterAuthUrl,
          authorization_servers: [config.betterAuthUrl],
          scopes_supported: Object.keys(BRAIN_SCOPES),
          bearer_methods_supported: ["header"],
        }, 200),
      },
      "/api/auth/oauth-client/:clientId": {
        GET: withRequestLogging(
          "GET /api/auth/oauth-client/:clientId",
          "GET",
          createClientInfoHandler(deps.surreal),
        ),
      },
      "/api/auth/*": async (request) => deps.auth.handler(request),
      "/": appHtml,
      "/*": appHtml,
    },
  });
}

export async function startServer(): Promise<void> {
  const config = loadServerConfig();
  const runtime = await createRuntimeDependencies(config);
  await ensureDefaultWorkspaceProjectScope(runtime.surreal);

  const deps: ServerDependencies = {
    config,
    surreal: runtime.surreal,
    analyticsSurreal: runtime.analyticsSurreal,
    auth: runtime.auth,
    chatAgentModel: runtime.chatAgentModel,
    extractionModel: runtime.extractionModel,
    pmAgentModel: runtime.pmAgentModel,
    analyticsAgentModel: runtime.analyticsAgentModel,
    embeddingModel: runtime.embeddingModel,
    ...(runtime.observerModel ? { observerModel: runtime.observerModel } : {}),
    sse: createSseRegistry(),
    inflight: createInflightTracker(),
    asSigningKey: runtime.asSigningKey,
    nonceCache: createNonceCache(),
  };

  const server = createBrainServer(deps);

  // Recover intents stuck in pending_veto with expired windows (fire-and-forget)
  const vetoManager = createVetoManager();
  deps.inflight.track(
    vetoManager.recoverExpiredWindows({
      updateStatus: (intentId, status) => updateIntentStatus(deps.surreal, intentId, status),
      emitVetoEvent: (event) => logInfo("intent.veto.recovery", "Recovered expired veto window", { event }),
      queryExpiredVetoIntents: () => queryExpiredVetoIntents(deps.surreal),
    }).catch((err) => {
      logError("intent.veto.recovery", "Failed to recover expired veto windows", err);
    }),
  );

  logInfo("server.started", "Brain app server started", {
    port: server.port,
    host: "127.0.0.1",
    chatAgentModelId: config.chatAgentModelId,
    extractionModelId: config.extractionModelId,
    pmAgentModelId: config.pmAgentModelId,
    embeddingModelId: config.embeddingModelId,
    embeddingDimension: config.embeddingDimension,
    extractionStoreThreshold: config.extractionStoreThreshold,
    extractionDisplayThreshold: config.extractionDisplayThreshold,
    surrealTransport: config.surrealUrl.startsWith("wss://")
      ? "wss"
      : config.surrealUrl.startsWith("ws://")
        ? "ws"
        : config.surrealUrl.startsWith("https://")
          ? "https"
          : "http",
    surrealNamespace: config.surrealNamespace,
    surrealDatabase: config.surrealDatabase,
    openRouterReasoningEnabled: config.openRouterReasoning !== undefined,
  });
}
