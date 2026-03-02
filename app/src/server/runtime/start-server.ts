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

export async function startServer(): Promise<void> {
  const config = loadServerConfig();
  const runtime = await createRuntimeDependencies(config);
  await ensureDefaultWorkspaceProjectScope(runtime.surreal);

  const deps: ServerDependencies = {
    config,
    surreal: runtime.surreal,
    assistantModel: runtime.assistantModel,
    extractionModel: runtime.extractionModel,
    pmModel: runtime.pmModel,
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
      "/api/workspaces/:workspaceId/webhooks/github": {
        POST: withRequestLogging(
          "POST /api/workspaces/:workspaceId/webhooks/github",
          "POST",
          (request) => githubWebhookHandler(request.params.workspaceId, request),
        ),
      },
      "/": appHtml,
      "/*": appHtml,
    },
  });

  logInfo("server.started", "Brain app server started", {
    port: server.port,
    host: "127.0.0.1",
    assistantModelId: config.assistantModelId,
    extractionModelId: config.extractionModelId,
    pmModelId: config.pmModelId,
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
