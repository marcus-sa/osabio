/**
 * Orchestrator HTTP route handlers.
 *
 * Pure request->response mappings that delegate to session-lifecycle functions
 * injected via OrchestratorRouteDeps. No direct DB or IO access.
 */
import { jsonError, jsonResponse } from "../http/response";
import { withTracing, type RouteHandler } from "../http/instrumentation";
import { RecordId } from "surrealdb";
import { generateKeyPair } from "../../../shared/dpop";
import { submitIntentForAuthorization } from "../oauth/intent-submission";
import { exchangeIntentForToken } from "../oauth/token-endpoint";
import { evaluatePendingIntent } from "../intent/intent-evaluation";
import { log } from "../telemetry/logger";
import {
  computeExpiresAt,
  generateProxyToken,
  hashProxyToken,
  readProxyTokenTtlDays,
} from "../proxy/proxy-token-core";
import type {
  OrchestratorSessionResult,
  SessionStatusResult,
  AbortSessionResult,
  AcceptSessionResult,
  ReviewResult,
  RejectSessionResult,
  PromptSessionResult,
} from "./session-lifecycle";
import { pickDefined } from "./session-lifecycle";
import type { SseRegistry } from "../streaming/sse-registry";
import { HttpError } from "../http/errors";

type BrainAction = {
  type: "brain_action";
  action: string;
  resource: string;
};

const CLI_AUTHORIZATION_DETAILS: BrainAction[] = [
  { type: "brain_action", action: "read", resource: "workspace" },
  { type: "brain_action", action: "read", resource: "project" },
  { type: "brain_action", action: "read", resource: "task" },
  { type: "brain_action", action: "read", resource: "decision" },
  { type: "brain_action", action: "read", resource: "constraint" },
  { type: "brain_action", action: "read", resource: "change_log" },
  { type: "brain_action", action: "read", resource: "entity" },
  { type: "brain_action", action: "read", resource: "suggestion" },
  { type: "brain_action", action: "read", resource: "intent" },
  { type: "brain_action", action: "reason", resource: "decision" },
  { type: "brain_action", action: "reason", resource: "constraint" },
  { type: "brain_action", action: "reason", resource: "commit" },
  { type: "brain_action", action: "create", resource: "decision" },
  { type: "brain_action", action: "create", resource: "question" },
  { type: "brain_action", action: "create", resource: "task" },
  { type: "brain_action", action: "create", resource: "note" },
  { type: "brain_action", action: "create", resource: "observation" },
  { type: "brain_action", action: "create", resource: "suggestion" },
  { type: "brain_action", action: "create", resource: "session" },
  { type: "brain_action", action: "create", resource: "commit" },
  { type: "brain_action", action: "create", resource: "intent" },
  { type: "brain_action", action: "update", resource: "task" },
  { type: "brain_action", action: "update", resource: "session" },
  { type: "brain_action", action: "update", resource: "suggestion" },
  { type: "brain_action", action: "submit", resource: "intent" },
];

// ---------------------------------------------------------------------------
// Port: Dependencies as function signatures
// ---------------------------------------------------------------------------

export type OrchestratorRouteDeps = {
  createSession: (
    workspaceId: string,
    taskId: string,
    authToken: string,
    agentName?: string,
  ) => Promise<OrchestratorSessionResult>;
  getSessionStatus: (sessionId: string) => Promise<SessionStatusResult>;
  abortSession: (sessionId: string) => Promise<AbortSessionResult>;
  acceptSession: (
    sessionId: string,
    summary: string,
  ) => Promise<AcceptSessionResult>;
  getReview: (sessionId: string) => Promise<ReviewResult>;
  rejectSession: (
    sessionId: string,
    feedback: string,
  ) => Promise<RejectSessionResult>;
  sendPrompt: (
    sessionId: string,
    text: string,
  ) => Promise<PromptSessionResult>;
};

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

type AssignBody = { taskId?: string; agentId?: string };
type AcceptBody = { summary?: string };
type RejectBody = { feedback?: string };
type PromptBody = { text?: string };

async function parseJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
}

function extractAuthToken(request: Request): string {
  return request.headers.get("Cookie") ?? "";
}

// ---------------------------------------------------------------------------
// Response builders (pure)
// ---------------------------------------------------------------------------

function assignResponse(
  workspaceId: string,
  value: { agentSessionId: string; streamId: string; worktreeBranch: string },
): Response {
  return jsonResponse(
    {
      agentSessionId: value.agentSessionId,
      streamId: value.streamId,
      streamUrl: `/api/orchestrator/${workspaceId}/sessions/${value.agentSessionId}/stream`,
    },
    200,
  );
}

function statusResponse(
  sessionId: string,
  value: {
    orchestratorStatus: string;
    worktreeBranch?: string;
    worktreePath?: string;
    startedAt?: string;
    lastEventAt?: string;
    error?: string;
  },
): Response {
  return jsonResponse(
    {
      agentSessionId: sessionId,
      orchestratorStatus: value.orchestratorStatus,
      ...pickDefined({
        worktreeBranch: value.worktreeBranch,
        worktreePath: value.worktreePath,
        startedAt: value.startedAt,
        lastEventAt: value.lastEventAt,
        error: value.error,
      }),
    },
    200,
  );
}

function acceptResponse(): Response {
  return jsonResponse({ accepted: true, taskStatus: "done" }, 200);
}

function abortResponse(): Response {
  return jsonResponse({ aborted: true, taskStatus: "ready" }, 200);
}

function reviewResponse(value: {
  taskTitle: string;
  diff: unknown;
  session: unknown;
}): Response {
  return jsonResponse(value, 200);
}

function rejectResponse(): Response {
  return jsonResponse({ rejected: true, continuing: true }, 200);
}

function promptResponse(): Response {
  return jsonResponse({ delivered: true }, 202);
}

function sessionErrorResponse(error: {
  message: string;
  httpStatus: number;
}): Response {
  return jsonError(error.message, error.httpStatus);
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createOrchestratorRouteHandlers(deps: OrchestratorRouteDeps) {
  const assign: RouteHandler = async (request) => {
    const workspaceId = request.params.workspaceId;
    const body = await parseJsonBody<AssignBody>(request);

    if (!body?.taskId) {
      return jsonError("taskId is required", 400);
    }

    const authToken = extractAuthToken(request);
    const result = await deps.createSession(workspaceId, body.taskId, authToken, body.agentId);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return assignResponse(workspaceId, result.value);
  };

  const status: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const result = await deps.getSessionStatus(sessionId);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return statusResponse(sessionId, result.value);
  };

  const accept: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const body = await parseJsonBody<AcceptBody>(request);
    const summary = body?.summary ?? "";

    const result = await deps.acceptSession(sessionId, summary);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return acceptResponse();
  };

  const abort: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const result = await deps.abortSession(sessionId);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return abortResponse();
  };

  const review: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const result = await deps.getReview(sessionId);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return reviewResponse(result.value);
  };

  const reject: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const body = await parseJsonBody<RejectBody>(request);

    if (!body?.feedback || body.feedback.trim() === "") {
      return jsonError("feedback is required", 400);
    }

    const result = await deps.rejectSession(sessionId, body.feedback);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return rejectResponse();
  };

  const prompt: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;
    const body = await parseJsonBody<PromptBody>(request);

    if (!body?.text || body.text.trim() === "") {
      return jsonError("text is required", 400);
    }

    const result = await deps.sendPrompt(sessionId, body.text);

    if (!result.ok) {
      return sessionErrorResponse(result.error);
    }

    return promptResponse();
  };

  return { assign, status, accept, abort, review, reject, prompt };
}

// ---------------------------------------------------------------------------
// SSE stream route handler factory
// ---------------------------------------------------------------------------

export type StreamRouteDeps = {
  sseRegistry: SseRegistry;
};

export function createStreamRouteHandler(deps: StreamRouteDeps) {
  const stream: RouteHandler = async (request) => {
    const sessionId = request.params.sessionId;

    if (!sessionId) {
      return jsonError("sessionId is required", 400);
    }

    const streamId = `stream-${sessionId}`;
    return deps.sseRegistry.handleStreamRequest(streamId);
  };

  return { stream };
}

// ---------------------------------------------------------------------------
// Wiring factory: creates OrchestratorRouteDeps from server dependencies
// ---------------------------------------------------------------------------

export type OrchestratorWiringDeps = {
  surreal: import("surrealdb").Surreal;
  shellExec: import("./worktree-manager").ShellExec;
  brainBaseUrl: string;
  extractionModel: import("../runtime/types").ServerDependencies["extractionModel"];
  asSigningKey: import("../oauth/as-key-management").AsSigningKey;
  sseRegistry?: SseRegistry;
  auth: { api: { getSession: (opts: { headers: Headers }) => Promise<{ user?: { id?: string } } | null> } };
  mockAgent: boolean;
  sandboxAgentAdapter?: import("./sandbox-adapter").SandboxAgentAdapter;
  sandboxAgentType?: string;
  lookupAgentInWorkspace?: (
    surreal: import("surrealdb").Surreal,
    agentId: string,
    workspaceId: string,
  ) => Promise<{ name: string; runtime: string }>;
};

export function wireOrchestratorRoutes(
  wiringDeps: OrchestratorWiringDeps,
): {
  assign: RouteHandler;
  status: RouteHandler;
  accept: RouteHandler;
  abort: RouteHandler;
  review: RouteHandler;
  reject: RouteHandler;
  prompt: RouteHandler;
  stream?: RouteHandler;
} {
  const proxyTokenTtlDays = readProxyTokenTtlDays();

  const issueProxyTokenForWorkspace = async (
    workspaceId: string,
    authToken: string,
    opts?: { intentRecord?: RecordId<"intent", string>; sessionRecord?: RecordId<"agent_session", string> },
  ): Promise<{ proxyToken: string; identityId: string }> => {
    const sessionHeaders = new Headers(authToken ? { Cookie: authToken } : undefined);
    const session = await wiringDeps.auth.api.getSession({ headers: sessionHeaders });
    const personId = session?.user?.id;
    if (!personId) {
      throw new Error("Failed to issue proxy token: authentication required");
    }

    const personRecord = new RecordId("person", personId);
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const [identityRows] = await wiringDeps.surreal.query<[Array<RecordId<"identity", string>>]>(
      `SELECT VALUE in FROM member_of WHERE in IN (SELECT VALUE in FROM identity_person WHERE out = $person) AND out = $ws LIMIT 1;`,
      { person: personRecord, ws: workspaceRecord },
    );
    const identityRecord = identityRows[0];
    if (!identityRecord) {
      throw new Error(`Failed to issue proxy token: workspace membership required for ${workspaceId}`);
    }
    const identityId = identityRecord.id as string;

    const rawToken = generateProxyToken();
    const tokenHash = hashProxyToken(rawToken);
    const expiresAt = computeExpiresAt(proxyTokenTtlDays);

    const contentFields: Record<string, unknown> = {
      token_hash: tokenHash,
      workspace: workspaceRecord,
      identity: identityRecord,
      expires_at: expiresAt,
      created_at: new Date(),
      revoked: false,
    };
    if (opts?.intentRecord) {
      contentFields.intent = opts.intentRecord;
    }
    if (opts?.sessionRecord) {
      contentFields.session = opts.sessionRecord;
    }

    await wiringDeps.surreal.query(
      `BEGIN TRANSACTION;
       UPDATE proxy_token SET revoked = true WHERE identity = $identity AND workspace = $ws AND revoked = false;
       CREATE proxy_token CONTENT $content;
       COMMIT TRANSACTION;`,
      {
        identity: identityRecord,
        ws: workspaceRecord,
        content: contentFields,
      },
    );

    return { proxyToken: rawToken, identityId };
  };

  const issueBrainMcpAuthEnv = async (
    workspaceId: string,
    identityId: string,
    intentGoal: string,
    intentReasoning: string,
  ): Promise<{ env: Record<string, string>; intentId: string }> => {
    const dpopKeys = await generateKeyPair();
    const intentResult = await submitIntentForAuthorization(
      {
        workspace_id: workspaceId,
        identity_id: identityId,
        authorization_details: CLI_AUTHORIZATION_DETAILS,
        dpop_jwk_thumbprint: dpopKeys.thumbprint,
        goal: intentGoal,
        reasoning: intentReasoning,
      },
      {
        surreal: wiringDeps.surreal,
        extractionModel: wiringDeps.extractionModel,
      },
    );

    let intentStatus: string = intentResult.status;
    if (intentStatus === "pending_auth") {
      const evaluation = await evaluatePendingIntent(
        intentResult.intentId,
        {
          surreal: wiringDeps.surreal,
          extractionModel: wiringDeps.extractionModel,
          llmEvaluator: async () => ({
            decision: "APPROVE",
            risk_score: 0,
            reason: "Approved from explicit authenticated orchestrator task assignment",
            reasoning:
              "User explicitly assigned this task in the orchestrator UI. " +
              "Bootstrap MCP token is required to complete the assigned task.",
          }),
        },
      );
      if (!evaluation.ok) {
        throw new Error(
          `Failed to evaluate MCP auth intent: ${evaluation.httpStatus} ${evaluation.error}`,
        );
      }
      intentStatus = evaluation.value.status;
    }

    if (intentStatus !== "authorized") {
      throw new Error(`MCP auth intent is "${intentStatus}" (expected "authorized")`);
    }

    const tokenResult = await exchangeIntentForToken({
      surreal: wiringDeps.surreal,
      asSigningKey: wiringDeps.asSigningKey,
      intentId: intentResult.intentId,
      authorizationDetails: CLI_AUTHORIZATION_DETAILS,
      proofThumbprint: dpopKeys.thumbprint,
    });

    if (!tokenResult.ok) {
      throw new Error(
        `Failed to exchange MCP auth token: ${tokenResult.httpStatus} ${tokenResult.errorDescription}`,
      );
    }

    const dpopTokenExpiresAt = Math.floor(Date.now() / 1000) + tokenResult.value.expiresIn;

    return {
      env: {
        BRAIN_CLIENT_ID: "orchestrator-session",
        BRAIN_ACCESS_TOKEN: "orchestrator-session",
        BRAIN_REFRESH_TOKEN: "orchestrator-session",
        BRAIN_TOKEN_EXPIRES_AT: String(dpopTokenExpiresAt),
        BRAIN_DPOP_PRIVATE_JWK: JSON.stringify(dpopKeys.privateJwk),
        BRAIN_DPOP_PUBLIC_JWK: JSON.stringify(dpopKeys.publicJwk),
        BRAIN_DPOP_THUMBPRINT: dpopKeys.thumbprint,
        BRAIN_DPOP_ACCESS_TOKEN: tokenResult.value.accessToken,
        BRAIN_DPOP_TOKEN_EXPIRES_AT: String(dpopTokenExpiresAt),
      },
      intentId: intentResult.intentId,
    };
  };

  // Workspace access guard — resolves user from session cookie, checks membership
  const validateWorkspaceAccess = async (request: Request, workspaceId: string): Promise<Response | undefined> => {
    const session = await wiringDeps.auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) {
      return jsonError("authentication required", 401);
    }
    const { RecordId } = await import("surrealdb");
    const personRecord = new RecordId("person", session.user.id);
    const workspaceRecord = new RecordId("workspace", workspaceId);
    // member_of is identity->workspace; resolve person->identity via identity_person subquery
    const [memberRows] = await wiringDeps.surreal.query<[Array<{ role: string }>]>(
      `SELECT role FROM member_of WHERE in IN (SELECT VALUE in FROM identity_person WHERE out = $person) AND out = $ws LIMIT 1;`,
      { person: personRecord, ws: workspaceRecord },
    );
    if (!memberRows || memberRows.length === 0) {
      return jsonError("not a member of this workspace", 403);
    }
    return undefined;
  };

  // Lazy imports to keep module boundary clean
  const lifecycleImport = import("./session-lifecycle");
  const queriesImport = import("../mcp/mcp-queries");
  const guardImport = import("./assignment-guard");
  // Helper: resolve repo_path from workspace record
  const resolveRepoRoot = async (workspaceRecord: import("surrealdb").RecordId<"workspace", string>): Promise<string> => {
    const [rows] = await wiringDeps.surreal.query<[Array<{ repo_path?: string }>]>(
      `SELECT repo_path FROM $ws;`,
      { ws: workspaceRecord },
    );
    const repoPath = rows[0]?.repo_path;
    if (!repoPath) {
      throw new Error(`Workspace ${workspaceRecord.id} has no repo_path configured`);
    }
    return repoPath;
  };

  const buildTaskScopedIntentContext = async (
    taskId: string,
  ): Promise<{ goal: string; reasoning: string }> => {
    const taskRecord = new RecordId("task", taskId);
    const [taskRows] = await wiringDeps.surreal.query<[Array<{ title?: string; description?: string }>]>(
      `SELECT title, description FROM $task LIMIT 1;`,
      { task: taskRecord },
    );
    const taskTitle = taskRows[0]?.title?.trim();
    const taskDescription = taskRows[0]?.description?.trim();
    const taskLabel = taskTitle && taskTitle.length > 0 ? taskTitle : taskId;
    const descriptionSuffix = taskDescription && taskDescription.length > 0
      ? ` Task description: ${taskDescription}`
      : "";

    return {
      goal: `Complete task: ${taskLabel}`,
      reasoning: `Use Brain MCP tools required to complete task "${taskLabel}" in this workspace.${descriptionSuffix}`,
    };
  };

  // Resolve adapter: real SDK adapter from deps, or mock for tests.
  // Eagerly resolved when configured; lazy rejection to avoid unhandled promise
  // rejections in test suites that don't exercise orchestrator routes.
  const resolveAdapter = (): Promise<import("./sandbox-adapter").SandboxAgentAdapter> => {
    if (wiringDeps.sandboxAgentAdapter) return Promise.resolve(wiringDeps.sandboxAgentAdapter);
    if (wiringDeps.mockAgent) return import("./sandbox-adapter").then((mod) => mod.createMockAdapter());
    return Promise.reject(new Error("No sandbox adapter configured — set sandboxAgentAdapter or mockAgent"));
  };

  const routeDeps: OrchestratorRouteDeps = {
    createSession: async (workspaceId, taskId, authToken, agentId) => {
      // Resolve agent name from agentId (if provided)
      let agentName: string | undefined;
      if (agentId) {
        if (!wiringDeps.lookupAgentInWorkspace) {
          return {
            ok: false as const,
            error: { code: "SESSION_ERROR" as const, message: "Agent lookup not configured", httpStatus: 500 },
          };
        }
        try {
          const agentInfo = await wiringDeps.lookupAgentInWorkspace(wiringDeps.surreal, agentId, workspaceId);
          agentName = agentInfo.name;
        } catch (err) {
          if (err instanceof HttpError) {
            return {
              ok: false as const,
              error: { code: "SESSION_ERROR" as const, message: err.message, httpStatus: err.status },
            };
          }
          throw err;
        }
      }

      const [adapter, lifecycle, queries, guard] = await Promise.all([
        resolveAdapter(),
        lifecycleImport,
        queriesImport,
        guardImport,
      ]);

      // Build task-scoped intent context, issue MCP auth env with intent
      const { goal, reasoning } = await buildTaskScopedIntentContext(taskId);
      const { identityId } = await issueProxyTokenForWorkspace(workspaceId, authToken);
      const mcpAuth = await issueBrainMcpAuthEnv(workspaceId, identityId, goal, reasoning);
      const intentRecord = new RecordId("intent", mcpAuth.intentId);

      // Issue a governed proxy token (revoke the ungoverned one from issueProxyTokenForWorkspace)
      const workspaceRecord = new RecordId("workspace", workspaceId);
      const identityRecord = new RecordId("identity", identityId);
      const rawToken = generateProxyToken();
      const tokenHash = hashProxyToken(rawToken);
      const expiresAt = computeExpiresAt(proxyTokenTtlDays);

      // Build proxy env for the sandbox agent
      const proxyEnv: Record<string, string> = {
        ...mcpAuth.env,
        ANTHROPIC_BASE_URL: `${wiringDeps.brainBaseUrl}/proxy/llm/anthropic`,
        ANTHROPIC_CUSTOM_HEADERS: `X-Brain-Auth: ${rawToken}`,
      };

      const result = await lifecycle.createOrchestratorSession({
        surreal: wiringDeps.surreal,
        shellExec: wiringDeps.shellExec,
        brainBaseUrl: wiringDeps.brainBaseUrl,
        mcpAuthToken: rawToken,
        workspaceId,
        taskId,
        env: proxyEnv,
        validateAssignment: guard.validateAssignment,
        createAgentSession: queries.createAgentSession,
        adapter,
        sandboxAgentType: wiringDeps.sandboxAgentType,
        agentName,
      });

      // After session creation, create the governed proxy token with intent + session
      if (result.ok) {
        const sessionRecord = new RecordId("agent_session", result.value.agentSessionId);

        // Revoke the ungoverned token and create a governed one
        await wiringDeps.surreal.query(
          `UPDATE proxy_token SET revoked = true WHERE identity = $identity AND workspace = $ws AND revoked = false;`,
          { identity: identityRecord, ws: workspaceRecord },
        );

        const contentFields: Record<string, unknown> = {
          token_hash: tokenHash,
          workspace: workspaceRecord,
          identity: identityRecord,
          expires_at: expiresAt,
          created_at: new Date(),
          revoked: false,
          intent: intentRecord,
          session: sessionRecord,
        };

        await wiringDeps.surreal.query(
          `CREATE proxy_token CONTENT $content;`,
          { content: contentFields },
        );
      }

      // Wire SSE stream + bootstrap prompt on success
      if (!result.ok) {
        return result;
      }

      const { agentSessionId, streamId, sessionHandle } = result.value;
      const sessionRecord = new RecordId("agent_session", agentSessionId);
      const sseRegistry = wiringDeps.sseRegistry;
      let emittedActiveStatus = false;
      let observedAgentEvent = false;
      if (!sessionHandle) {
        const cleanup = await lifecycle.abortOrchestratorSession({
          surreal: wiringDeps.surreal,
          shellExec: wiringDeps.shellExec,
          resolveRepoRoot,
          sessionId: agentSessionId,
          adapter,
          endAgentSession: queries.endAgentSession,
        });
        if (!cleanup.ok) {
          log.warn("orchestrator.assign", "Failed to clean up session after missing session handle", {
            sessionId: agentSessionId,
            error: cleanup.error.message,
          });
        }
        return {
          ok: false,
          error: {
            code: "SESSION_ERROR",
            message: `Session ${agentSessionId} was created without a handle - bootstrap failed`,
            httpStatus: 500,
          },
        };
      }

      if (sseRegistry) {
        sseRegistry.registerMessage(streamId);

        const { createSandboxEventBridge } = await import("./sandbox-event-bridge");

        const bridge = createSandboxEventBridge(
          {
            emitEvent: sseRegistry.emitEvent,
            updateLastEventAt: async (sid) => {
              const rec = new RecordId("agent_session", sid);
              await wiringDeps.surreal.update(rec).merge({
                last_event_at: new Date(),
              });
            },
            updateSessionStatus: async (sid, status, error) => {
              const rec = new RecordId("agent_session", sid);
              await wiringDeps.surreal.update(rec).merge({
                orchestrator_status: status,
                last_event_at: new Date(),
                ...(error !== undefined ? { error_message: error } : {}),
              });
            },
            notifyStallDetector: () => {
              // Stall detector integration deferred to later step
            },
          },
          streamId,
          agentSessionId,
        );

        sessionHandle.onEvent((event) => {
          if (event.sender === "agent") {
            observedAgentEvent = true;
          }
          if (!emittedActiveStatus && event.sender === "agent") {
            emittedActiveStatus = true;
            sseRegistry.emitEvent(streamId, {
              type: "agent_status",
              sessionId: agentSessionId,
              status: "active",
            });
            wiringDeps.surreal.update(sessionRecord).merge({
              orchestrator_status: "active",
              last_event_at: new Date(),
            }).catch((err) => {
              log.warn("orchestrator.assign", "Failed to mark session active after first event", {
                sessionId: agentSessionId,
                error: String(err),
              });
            });
          }
          bridge.handleEvent(event as import("./sandbox-event-bridge").SandboxEvent);
        });
      }

      if (!emittedActiveStatus) {
        emittedActiveStatus = true;
        if (sseRegistry) {
          sseRegistry.emitEvent(streamId, {
            type: "agent_status",
            sessionId: agentSessionId,
            status: "active",
          });
        }
      }
      await wiringDeps.surreal.update(sessionRecord).merge({
        orchestrator_status: "active",
        last_event_at: new Date(),
      });

      const initialTaskPrompt = `/brain-start-task ${taskId}`;
      try {
        await sessionHandle.prompt([{ type: "text", text: initialTaskPrompt }]);
        if (!observedAgentEvent) {
          if (sseRegistry) {
            sseRegistry.emitEvent(streamId, {
              type: "agent_status",
              sessionId: agentSessionId,
              status: "idle",
            });
          }
          await wiringDeps.surreal.update(sessionRecord).merge({
            orchestrator_status: "idle",
            last_event_at: new Date(),
          });
        }
      } catch (err) {
        const cleanup = await lifecycle.abortOrchestratorSession({
          surreal: wiringDeps.surreal,
          shellExec: wiringDeps.shellExec,
          resolveRepoRoot,
          sessionId: agentSessionId,
          adapter,
          endAgentSession: queries.endAgentSession,
        });
        if (!cleanup.ok) {
          log.warn("orchestrator.assign", "Failed to clean up session after initial prompt failure", {
            sessionId: agentSessionId,
            error: cleanup.error.message,
          });
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: {
            code: "SESSION_ERROR",
            message: `Failed to start task session: ${errorMessage}`,
            httpStatus: 500,
          },
        };
      }

      return result;
    },

    getSessionStatus: async (sessionId) => {
      const lifecycle = await lifecycleImport;
      return lifecycle.getOrchestratorSessionStatus({
        surreal: wiringDeps.surreal,
        sessionId,
      });
    },

    abortSession: async (sessionId) => {
      const [adapter, lifecycle, queries] = await Promise.all([
        resolveAdapter().catch(() => undefined),
        lifecycleImport,
        queriesImport,
      ]);
      return lifecycle.abortOrchestratorSession({
        surreal: wiringDeps.surreal,
        shellExec: wiringDeps.shellExec,
        resolveRepoRoot,
        sessionId,
        adapter,
        endAgentSession: queries.endAgentSession,
      });
    },

    acceptSession: async (sessionId, summary) => {
      const [adapter, lifecycle, queries] = await Promise.all([
        resolveAdapter().catch(() => undefined),
        lifecycleImport,
        queriesImport,
      ]);
      return lifecycle.acceptOrchestratorSession({
        surreal: wiringDeps.surreal,
        shellExec: wiringDeps.shellExec,
        resolveRepoRoot,
        sessionId,
        summary,
        adapter,
        endAgentSession: queries.endAgentSession,
      });
    },

    getReview: async (sessionId) => {
      const [lifecycle, worktreeManager] = await Promise.all([
        lifecycleImport,
        import("./worktree-manager"),
      ]);
      return lifecycle.getOrchestratorReview({
        surreal: wiringDeps.surreal,
        sessionId,
        resolveRepoRoot,
        getDiff: (repoRoot: string, branchName: string) =>
          worktreeManager.getDiff(wiringDeps.shellExec, repoRoot, branchName),
        getTaskTitle: async (taskId: string) => {
          const { RecordId } = await import("surrealdb");
          const taskRecord = new RecordId("task", taskId);
          const rows = (await wiringDeps.surreal.query(
            `SELECT title FROM $task;`,
            { task: taskRecord },
          )) as Array<Array<{ title: string }>>;
          return rows[0]?.[0]?.title ?? "";
        },
      });
    },

    rejectSession: async (sessionId, feedback) => {
      const lifecycle = await lifecycleImport;
      return lifecycle.rejectOrchestratorSession({
        surreal: wiringDeps.surreal,
        sessionId,
        feedback,
      });
    },

    sendPrompt: async (sessionId, text) => {
      const [adapter, lifecycle] = await Promise.all([resolveAdapter(), lifecycleImport]);
      return lifecycle.sendSessionPrompt({
        surreal: wiringDeps.surreal,
        sessionId,
        text,
        adapter,
      });
    },
  };

  const handlers = createOrchestratorRouteHandlers(routeDeps);

  // Wrap handler with workspace access check
  const withWorkspaceAccess = (handler: RouteHandler): RouteHandler => async (request) => {
    const workspaceId = request.params.workspaceId;
    if (workspaceId) {
      const accessError = await validateWorkspaceAccess(request, workspaceId);
      if (accessError) return accessError;
    }
    return handler(request);
  };

  const streamHandler = wiringDeps.sseRegistry
    ? createStreamRouteHandler({ sseRegistry: wiringDeps.sseRegistry })
    : undefined;

  return {
    assign: withTracing("orchestrator.assign", "POST", withWorkspaceAccess(handlers.assign)),
    status: withTracing("orchestrator.status", "GET", withWorkspaceAccess(handlers.status)),
    accept: withTracing("orchestrator.accept", "POST", withWorkspaceAccess(handlers.accept)),
    abort: withTracing("orchestrator.abort", "POST", withWorkspaceAccess(handlers.abort)),
    review: withTracing("orchestrator.review", "GET", withWorkspaceAccess(handlers.review)),
    reject: withTracing("orchestrator.reject", "POST", withWorkspaceAccess(handlers.reject)),
    prompt: withTracing("orchestrator.prompt", "POST", withWorkspaceAccess(handlers.prompt)),
    ...(streamHandler
      ? { stream: withTracing("orchestrator.stream", "GET", withWorkspaceAccess(streamHandler.stream)) }
      : {}),
  };
}
