/**
 * Agent Route Handlers
 *
 * HTTP handler factory for the agent CRUD module. Each handler resolves
 * identity from Better Auth session, validates input, delegates to
 * query functions, and returns JSON responses.
 *
 * All handlers follow the wide-event observability pattern via
 * trace.getActiveSpan()?.setAttribute().
 */
import { RecordId } from "surrealdb";
import { trace } from "@opentelemetry/api";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { log } from "../telemetry/logger";
import {
  listAgents,
  createAgentTransaction,
  getAgentDetail,
  deleteAgentTransaction,
  checkAgentName,
} from "./agent-queries";
import type { CreateAgentInput } from "./types";

// ---------------------------------------------------------------------------
// Identity resolution (session -> person -> identity)
// ---------------------------------------------------------------------------

type IdentityInfo = {
  identityRecord: RecordId<"identity", string>;
};

async function resolveIdentityFromSession(
  deps: ServerDependencies,
  request: Request,
): Promise<IdentityInfo | Response> {
  const session = await deps.auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return jsonError("authentication required", 401);
  }

  const personRecord = new RecordId("person", session.user.id);

  const [identityRows] = await deps.surreal.query<[RecordId<"identity", string>[]]>(
    "SELECT VALUE in FROM identity_person WHERE out = $person LIMIT 1;",
    { person: personRecord },
  );
  const identityRecord = identityRows[0] as RecordId<"identity", string> | undefined;
  if (!identityRecord) {
    return jsonError("identity not found for user", 500);
  }

  return { identityRecord };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

async function resolveWorkspace(
  deps: ServerDependencies,
  workspaceId: string,
  logEvent: string,
): Promise<RecordId<"workspace", string> | Response> {
  try {
    return await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    log.error(logEvent, "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }
}

const VALID_RUNTIMES: ReadonlySet<string> = new Set(["sandbox", "external"]);

function isValidRuntime(runtime: unknown): runtime is "sandbox" | "external" {
  return typeof runtime === "string" && VALID_RUNTIMES.has(runtime);
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createAgentRouteHandlers(deps: ServerDependencies) {
  return {
    handleList: (workspaceId: string, request: Request) =>
      handleListAgents(deps, workspaceId, request),
    handleCreate: (workspaceId: string, request: Request) =>
      handleCreateAgent(deps, workspaceId, request),
    handleGetDetail: (workspaceId: string, agentId: string, request: Request) =>
      handleGetAgentDetail(deps, workspaceId, agentId, request),
    handleDelete: (workspaceId: string, agentId: string, request: Request) =>
      handleDeleteAgent(deps, workspaceId, agentId, request),
    handleCheckName: (workspaceId: string, request: Request) =>
      handleCheckAgentName(deps, workspaceId, request),
  };
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/agents
// ---------------------------------------------------------------------------

async function handleListAgents(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "agent.list.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  try {
    const agents = await listAgents(deps.surreal, workspaceId);
    trace.getActiveSpan()?.setAttribute("agent.list.count", agents.length);
    return jsonResponse({ agents }, 200);
  } catch (error) {
    log.error("agent.list.failed", "Failed to list agents", error, { workspaceId });
    return jsonError("failed to list agents", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/agents
// ---------------------------------------------------------------------------

async function handleCreateAgent(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "agent.create.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  // Validate name
  const name = body.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("name_required", 400);
  }

  // Validate runtime
  const runtime = body.runtime;
  if (!isValidRuntime(runtime)) {
    return jsonError("invalid_runtime", 400);
  }

  // Sandbox-specific validation
  if (runtime === "sandbox") {
    // Check workspace has sandbox_provider configured
    const [wsRows] = await deps.surreal.query<[Array<{ settings: { sandbox_provider?: string } }>]>(
      "SELECT settings FROM $ws;",
      { ws: new RecordId("workspace", workspaceId) },
    );
    const sandboxProvider = wsRows[0]?.settings?.sandbox_provider;
    if (!sandboxProvider) {
      return jsonError("sandbox_provider_not_configured", 400);
    }

    // Local provider cannot use image or snapshot
    if (sandboxProvider === "local") {
      const sandboxConfig = body.sandbox_config as { image?: string; snapshot?: string } | undefined;
      if (sandboxConfig?.image || sandboxConfig?.snapshot) {
        return jsonError("invalid_sandbox_config", 400);
      }
    }
  }

  const input: CreateAgentInput = {
    name: name.trim(),
    runtime,
    ...(body.description && typeof body.description === "string" ? { description: body.description } : {}),
    ...(body.model && typeof body.model === "string" ? { model: body.model } : {}),
    ...(body.sandbox_config ? { sandbox_config: body.sandbox_config as CreateAgentInput["sandbox_config"] } : {}),
    ...(body.authority_scopes ? { authority_scopes: body.authority_scopes as CreateAgentInput["authority_scopes"] } : {}),
  };

  try {
    const result = await createAgentTransaction(deps.surreal, workspaceId, input, new Date());
    trace.getActiveSpan()?.setAttribute("agent.create.agent_id", result.agent.id);
    trace.getActiveSpan()?.setAttribute("agent.create.runtime", runtime);
    return jsonResponse(
      {
        agent: result.agent,
        ...(result.proxy_token ? { proxy_token: result.proxy_token } : {}),
        workspace_id: workspaceId,
      },
      201,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(
        error.status === 409 ? "agent_name_not_unique" : error.message,
        error.status,
      );
    }
    log.error("agent.create.failed", "Failed to create agent", error, { workspaceId });
    return jsonError("failed to create agent", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/agents/:agentId
// ---------------------------------------------------------------------------

async function handleGetAgentDetail(
  deps: ServerDependencies,
  workspaceId: string,
  agentId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "agent.detail.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  try {
    const detail = await getAgentDetail(deps.surreal, workspaceId, agentId);
    if (!detail) {
      return jsonError("agent not found", 404);
    }

    trace.getActiveSpan()?.setAttribute("agent.detail.agent_id", agentId);
    trace.getActiveSpan()?.setAttribute("agent.detail.session_count", detail.sessions.length);
    return jsonResponse(detail, 200);
  } catch (error) {
    log.error("agent.detail.failed", "Failed to get agent detail", error, { workspaceId, agentId });
    return jsonError("failed to get agent detail", 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/workspaces/:workspaceId/agents/:agentId
// ---------------------------------------------------------------------------

async function handleDeleteAgent(
  deps: ServerDependencies,
  workspaceId: string,
  agentId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "agent.delete.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const confirmName = body.confirm_name;
  if (typeof confirmName !== "string" || confirmName.trim().length === 0) {
    return jsonError("confirm_name is required", 400);
  }

  try {
    const result = await deleteAgentTransaction(deps.surreal, workspaceId, agentId, confirmName);
    trace.getActiveSpan()?.setAttribute("agent.delete.agent_id", agentId);
    return jsonResponse(result, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    log.error("agent.delete.failed", "Failed to delete agent", error, { workspaceId, agentId });
    return jsonError("failed to delete agent", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/agents/check-name?name=...
// ---------------------------------------------------------------------------

async function handleCheckAgentName(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "agent.check_name.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  if (!name || name.trim().length === 0) {
    return jsonError("name query parameter is required", 400);
  }

  try {
    const available = await checkAgentName(deps.surreal, workspaceId, name.trim());
    trace.getActiveSpan()?.setAttribute("agent.check_name.available", available);
    return jsonResponse({ available }, 200);
  } catch (error) {
    log.error("agent.check_name.failed", "Failed to check agent name", error, { workspaceId });
    return jsonError("failed to check agent name", 500);
  }
}
