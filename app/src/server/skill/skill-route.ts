/**
 * Skill Route Handlers
 *
 * Factory function returning route handlers for the skill catalog API.
 * Follows the handler factory pattern used by policy-route.ts.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/skills              (create)
 *   GET  /api/workspaces/:wsId/skills              (list with ?status filter)
 *   POST /api/workspaces/:wsId/skills/:id/activate (activate draft -> active)
 *   POST /api/workspaces/:wsId/skills/:id/deprecate (deprecate active -> deprecated)
 */
import { RecordId } from "surrealdb";
import { trace } from "@opentelemetry/api";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { createSkill, listSkills, activateSkill, deprecateSkill } from "./skill-queries";
import type { SkillSource, SkillStatus } from "./types";
import { log } from "../telemetry/logger";

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

const VALID_SKILL_STATUSES: ReadonlySet<string> = new Set(["draft", "active", "deprecated"]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type CreateSkillBody = {
  name: string;
  description: string;
  version: string;
  source: SkillSource;
  required_tool_ids?: string[];
};

function validateCreateSkillBody(body: unknown): { valid: true; parsed: CreateSkillBody } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "request body is required" };
  }

  const raw = body as Record<string, unknown>;

  if (!raw.name || typeof raw.name !== "string") {
    return { valid: false, error: "name is required" };
  }
  if (!raw.description || typeof raw.description !== "string") {
    return { valid: false, error: "description is required" };
  }
  if (!raw.version || typeof raw.version !== "string") {
    return { valid: false, error: "version is required" };
  }
  if (!raw.source || typeof raw.source !== "object") {
    return { valid: false, error: "source is required" };
  }

  return {
    valid: true,
    parsed: {
      name: raw.name as string,
      description: raw.description as string,
      version: raw.version as string,
      source: raw.source as SkillSource,
      required_tool_ids: Array.isArray(raw.required_tool_ids) ? raw.required_tool_ids as string[] : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createSkillRouteHandlers(deps: ServerDependencies) {
  return {
    handleCreate: (workspaceId: string, request: Request) =>
      handleCreateSkill(deps, workspaceId, request),
    handleList: (workspaceId: string, request: Request) =>
      handleListSkills(deps, workspaceId, request),
    handleActivate: (workspaceId: string, skillId: string, request: Request) =>
      handleActivateSkill(deps, workspaceId, skillId, request),
    handleDeprecate: (workspaceId: string, skillId: string, request: Request) =>
      handleDeprecateSkill(deps, workspaceId, skillId, request),
  };
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/skills
// ---------------------------------------------------------------------------

async function handleCreateSkill(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "skill.create.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const validation = validateCreateSkillBody(body);
  if (!validation.valid) {
    return jsonError(validation.error, 400);
  }

  try {
    const result = await createSkill(
      deps.surreal,
      workspaceId,
      validation.parsed,
      identityOrError.identityRecord.id as string,
    );

    trace.getActiveSpan()?.setAttribute("skill.create.skill_id", result.id);

    return jsonResponse({ skill: result }, 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    log.error("skill.create.failed", "Failed to create skill", error, { workspaceId });
    const message = error instanceof Error ? error.message : "failed to create skill";
    return jsonError(message, 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/skills
// ---------------------------------------------------------------------------

async function handleListSkills(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "skill.list.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  try {
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("status");
    const statusFilter = rawStatus && VALID_SKILL_STATUSES.has(rawStatus)
      ? (rawStatus as SkillStatus)
      : undefined;

    const skills = await listSkills(deps.surreal, workspaceId, statusFilter);

    trace.getActiveSpan()?.setAttribute("skill.list.count", skills.length);

    return jsonResponse({ skills }, 200);
  } catch (error) {
    log.error("skill.list.failed", "Failed to list skills", error, { workspaceId });
    return jsonError("failed to list skills", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/skills/:skillId/activate
// ---------------------------------------------------------------------------

async function handleActivateSkill(
  deps: ServerDependencies,
  workspaceId: string,
  skillId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "skill.activate.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  try {
    await activateSkill(deps.surreal, workspaceId, skillId);
    return jsonResponse({ status: "active" }, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    log.error("skill.activate.failed", "Failed to activate skill", error, { workspaceId, skillId });
    return jsonError("failed to activate skill", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/skills/:skillId/deprecate
// ---------------------------------------------------------------------------

async function handleDeprecateSkill(
  deps: ServerDependencies,
  workspaceId: string,
  skillId: string,
  request: Request,
): Promise<Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "skill.deprecate.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;

  try {
    await deprecateSkill(deps.surreal, workspaceId, skillId);
    return jsonResponse({ status: "deprecated" }, 200);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    log.error("skill.deprecate.failed", "Failed to deprecate skill", error, { workspaceId, skillId });
    return jsonError("failed to deprecate skill", 500);
  }
}
