import appHtml from "../../client/index.html";
import { withRequestLogging } from "../http/request-logging";
import { jsonResponse } from "../http/response";
import { logInfo } from "../http/observability";
import { createSseRegistry } from "../streaming/sse-registry";
import { createRuntimeDependencies } from "./dependencies";
import { loadServerConfig } from "./config";
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
import { BRAIN_SCOPES } from "../auth/scopes";
import { createClientInfoHandler } from "../auth/client-info-route";

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
    sse: createSseRegistry(),
  };

  const workspaceHandlers = createWorkspaceRouteHandlers(deps);
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

  const server = Bun.serve({
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
      "/api/mcp/:workspaceId/commits/check": {
        POST: withRequestLogging("POST /api/mcp/:workspaceId/commits/check", "POST", (request) =>
          mcpHandlers.handleCheckCommit(request.params.workspaceId, request),
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
