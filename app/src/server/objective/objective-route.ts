/**
 * Objective HTTP Route Handlers
 *
 * Thin composition layer: parses HTTP requests, delegates to query functions,
 * returns JSON responses. No domain logic lives here.
 */
import { logError } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import {
  createObjective,
  getObjective,
  getObjectiveProgress,
  listObjectives,
  updateObjectiveStatus,
  type ObjectiveStatus,
  type ObjectiveRecord,
} from "./queries";

// ---------------------------------------------------------------------------
// Response serialization (pure)
// ---------------------------------------------------------------------------

function serializeObjective(record: ObjectiveRecord) {
  return {
    id: record.id.id as string,
    title: record.title,
    ...(record.description !== undefined ? { description: record.description } : {}),
    status: record.status,
    priority: record.priority,
    ...(record.target_date !== undefined ? { target_date: record.target_date } : {}),
    success_criteria: record.success_criteria,
    workspace_id: record.workspace.id as string,
    created_at: record.created_at,
    ...(record.updated_at !== undefined ? { updated_at: record.updated_at } : {}),
  };
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createObjectiveRouteHandlers(deps: ServerDependencies) {
  return {
    handleList: (workspaceId: string, request: Request) =>
      handleListObjectives(deps, workspaceId, request),
    handleCreate: (workspaceId: string, request: Request) =>
      handleCreateObjective(deps, workspaceId, request),
    handleGet: (workspaceId: string, objectiveId: string) =>
      handleGetObjective(deps, workspaceId, objectiveId),
    handleUpdate: (workspaceId: string, objectiveId: string, request: Request) =>
      handleUpdateObjective(deps, workspaceId, objectiveId, request),
    handleProgress: (workspaceId: string, objectiveId: string) =>
      handleGetObjectiveProgress(deps, workspaceId, objectiveId),
  };
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/objectives
// ---------------------------------------------------------------------------

async function handleListObjectives(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status") as ObjectiveStatus | undefined;

    const objectives = await listObjectives(deps.surreal, workspaceId, statusParam);

    return jsonResponse({
      objectives: objectives.map(serializeObjective),
    }, 200);
  } catch (error) {
    logError("objective.list.failed", "Failed to list objectives", error, { workspaceId });
    return jsonError("failed to list objectives", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/objectives
// ---------------------------------------------------------------------------

type CreateBody = {
  title?: string;
  description?: string;
  status?: ObjectiveStatus;
  priority?: "low" | "medium" | "high" | "critical";
  target_date?: string;
  success_criteria?: Array<{
    metric_name: string;
    target_value: number;
    current_value: number;
    unit: string;
  }>;
};

async function handleCreateObjective(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
    return jsonError("title is required", 400);
  }

  try {
    const result = await createObjective(deps.surreal, workspaceId, {
      title: body.title.trim(),
      description: body.description,
      status: body.status,
      priority: body.priority,
      target_date: body.target_date,
      success_criteria: body.success_criteria,
    });

    return jsonResponse({ objectiveId: result.objectiveId }, 201);
  } catch (error) {
    logError("objective.create.failed", "Failed to create objective", error, { workspaceId });
    return jsonError("failed to create objective", 500);
  }
}

// ---------------------------------------------------------------------------
// Workspace scope verification (pure)
// ---------------------------------------------------------------------------

function isWorkspaceScoped(record: ObjectiveRecord, workspaceId: string): boolean {
  return (record.workspace.id as string) === workspaceId;
}

async function fetchWorkspaceScopedObjective(
  deps: ServerDependencies,
  workspaceId: string,
  objectiveId: string,
): Promise<ObjectiveRecord | undefined> {
  const objective = await getObjective(deps.surreal, objectiveId);
  if (!objective || !isWorkspaceScoped(objective, workspaceId)) return undefined;
  return objective;
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/objectives/:objectiveId
// ---------------------------------------------------------------------------

async function handleGetObjective(
  deps: ServerDependencies,
  workspaceId: string,
  objectiveId: string,
): Promise<Response> {
  try {
    const objective = await fetchWorkspaceScopedObjective(deps, workspaceId, objectiveId);
    if (!objective) {
      return jsonError("objective not found", 404);
    }

    return jsonResponse({ objective: serializeObjective(objective) }, 200);
  } catch (error) {
    logError("objective.get.failed", "Failed to get objective", error, { workspaceId, objectiveId });
    return jsonError("failed to get objective", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/objectives/:objectiveId/progress
// ---------------------------------------------------------------------------

async function handleGetObjectiveProgress(
  deps: ServerDependencies,
  workspaceId: string,
  objectiveId: string,
): Promise<Response> {
  try {
    const existing = await fetchWorkspaceScopedObjective(deps, workspaceId, objectiveId);
    if (!existing) {
      return jsonError("objective not found", 404);
    }

    const progress = await getObjectiveProgress(deps.surreal, objectiveId);
    if (!progress) {
      return jsonError("objective not found", 404);
    }

    return jsonResponse({ progress }, 200);
  } catch (error) {
    logError("objective.progress.failed", "Failed to get objective progress", error, {
      workspaceId,
      objectiveId,
    });
    return jsonError("failed to get objective progress", 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/workspaces/:workspaceId/objectives/:objectiveId
// ---------------------------------------------------------------------------

type UpdateBody = {
  status?: ObjectiveStatus;
};

async function handleUpdateObjective(
  deps: ServerDependencies,
  workspaceId: string,
  objectiveId: string,
  request: Request,
): Promise<Response> {
  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  try {
    const existing = await fetchWorkspaceScopedObjective(deps, workspaceId, objectiveId);
    if (!existing) {
      return jsonError("objective not found", 404);
    }

    if (body.status) {
      await updateObjectiveStatus(deps.surreal, objectiveId, body.status);
    }

    // Re-fetch to return updated state
    const updated = await getObjective(deps.surreal, objectiveId);

    return jsonResponse({
      objective: updated ? serializeObjective(updated) : undefined,
      status: "updated",
    }, 200);
  } catch (error) {
    logError("objective.update.failed", "Failed to update objective", error, { workspaceId, objectiveId });
    return jsonError("failed to update objective", 500);
  }
}
