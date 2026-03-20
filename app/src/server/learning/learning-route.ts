import { RecordId } from "surrealdb";
import { LEARNING_TYPES, type LearningStatus, type LearningType } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  createLearning,
  listWorkspaceLearnings,
  updateLearningStatus,
  updateLearningText,
  updateLearningFields,
  LearningNotFoundError,
  LearningNotActiveError,
} from "./queries";
import { checkCollisions, type CollisionResult } from "./collision";
import type { LearningRecord } from "./types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, Record<string, LearningStatus>> = {
  pending_approval: {
    approve: "active",
    dismiss: "dismissed",
  },
  active: {
    deactivate: "deactivated",
  },
};

const VALID_ACTIONS = ["approve", "dismiss", "deactivate", "supersede"] as const;
type LearningAction = (typeof VALID_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function parseJsonBody<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return jsonError("invalid JSON body", 400);
  }
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

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createLearningRouteHandlers(deps: ServerDependencies) {
  return {
    handleCreate: (workspaceId: string, request: Request) =>
      handleCreateLearning(deps, workspaceId, request),
    handleList: (workspaceId: string, request: Request) =>
      handleListLearnings(deps, workspaceId, request),
    handleAction: (workspaceId: string, learningId: string, request: Request) =>
      handleLearningAction(deps, workspaceId, learningId, request),
    handleEdit: (workspaceId: string, learningId: string, request: Request) =>
      handleEditLearning(deps, workspaceId, learningId, request),
  };
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/learnings
// ---------------------------------------------------------------------------

type CreateBody = {
  text?: string;
  learning_type?: string;
  priority?: string;
  target_agents?: string[];
};

async function handleCreateLearning(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const bodyOrError = await parseJsonBody<CreateBody>(request);
  if (isResponse(bodyOrError)) return bodyOrError;
  const body = bodyOrError;

  // Validate required fields
  if (!body.text || typeof body.text !== "string" || body.text.trim().length === 0) {
    return jsonError("text is required", 400);
  }
  if (!body.learning_type || !LEARNING_TYPES.includes(body.learning_type as LearningType)) {
    return jsonError(
      `learning_type must be one of: ${LEARNING_TYPES.join(", ")}`,
      400,
    );
  }

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "learning.create.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const now = new Date();

    // Run collision detection using BM25 fulltext search (no embedding needed)
    const collisionResult = await checkCollisions({
      surreal: deps.surreal,
      model: deps.extractionModel,
      workspaceRecord,
      learningText: body.text.trim(),
      source: "human",
    });

    // Determine status: blocked learnings stay pending, otherwise human-created = active
    const shouldBlock = collisionResult.hasBlockingCollision;
    const learningRecord = await createLearning({
      surreal: deps.surreal,
      workspaceRecord,
      learning: {
        text: body.text.trim(),
        learningType: body.learning_type as LearningType,
        priority: (body.priority as "low" | "medium" | "high") ?? "medium",
        targetAgents: body.target_agents ?? [],
        source: "human",
        ...(shouldBlock ? { forceStatus: "pending_approval" as const } : {}),
      },
      now,
    });

    const learningId = learningRecord.id as string;

    log.info("learning.created", "Learning created via HTTP", {
      workspaceId,
      learningId,
      learningType: body.learning_type,
      collisions: collisionResult.collisions.length,
      blocked: shouldBlock,
    });

    const responseCollisions: CollisionResult[] = collisionResult.collisions;

    return jsonResponse({
      learningId,
      learning: { id: learningId },
      collisions: responseCollisions,
    }, 201);
  } catch (error) {
    log.error("learning.create.failed", "Failed to create learning", error, { workspaceId });
    return jsonError("failed to create learning", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/learnings
// ---------------------------------------------------------------------------

async function handleListLearnings(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "learning.list.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status") ?? undefined;
    const typeParam = url.searchParams.get("type") ?? undefined;
    const agentParam = url.searchParams.get("agent") ?? undefined;

    const learnings = await listWorkspaceLearnings({
      surreal: deps.surreal,
      workspaceRecord,
      status: statusParam as LearningStatus | undefined,
      learningType: typeParam as LearningType | undefined,
      agentType: agentParam,
    });

    // Return snake_case fields to match HTTP contract
    const items = learnings.map((l) => ({
      id: l.id,
      text: l.text,
      learning_type: l.learningType,
      status: l.status,
      source: l.source,
      priority: l.priority,
      target_agents: l.targetAgents,
      ...(l.suggestedBy ? { suggested_by: l.suggestedBy } : {}),
      ...(l.patternConfidence !== undefined ? { pattern_confidence: l.patternConfidence } : {}),
      created_at: l.createdAt,
      ...(l.approvedAt ? { approved_at: l.approvedAt } : {}),
      ...(l.dismissedAt ? { dismissed_at: l.dismissedAt } : {}),
      ...(l.dismissedReason ? { dismissed_reason: l.dismissedReason } : {}),
      ...(l.deactivatedAt ? { deactivated_at: l.deactivatedAt } : {}),
    }));

    return jsonResponse({ learnings: items }, 200);
  } catch (error) {
    log.error("learning.list.failed", "Failed to list learnings", error, { workspaceId });
    return jsonError("failed to list learnings", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/learnings/:learningId/actions
// ---------------------------------------------------------------------------

type ActionBody = {
  action?: string;
  reason?: string;
  new_text?: string;
};

async function handleLearningAction(
  deps: ServerDependencies,
  workspaceId: string,
  learningId: string,
  request: Request,
): Promise<Response> {
  const bodyOrError = await parseJsonBody<ActionBody>(request);
  if (isResponse(bodyOrError)) return bodyOrError;
  const body = bodyOrError;

  if (!body.action || !(VALID_ACTIONS as readonly string[]).includes(body.action)) {
    return jsonError(
      `action must be one of: ${VALID_ACTIONS.join(", ")}`,
      400,
    );
  }

  const action = body.action as LearningAction;

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "learning.action.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  // Look up the learning
  const learningRecord = new RecordId("learning", learningId) as LearningRecord;
  let existing: { status: LearningStatus; workspace: RecordId<"workspace", string> } | undefined;
  try {
    existing = await deps.surreal.select<{
      status: LearningStatus;
      workspace: RecordId<"workspace", string>;
    }>(learningRecord);
  } catch {
    // select returns undefined if not found
  }

  if (!existing) {
    return jsonError("learning not found", 404);
  }

  // Verify workspace scope
  if ((existing.workspace.id as string) !== (workspaceRecord.id as string)) {
    return jsonError("learning not found", 404);
  }

  // Validate state transition
  const transitions = VALID_TRANSITIONS[existing.status];
  if (!transitions || !(action in transitions)) {
    return jsonError(
      `cannot ${action} a learning in status '${existing.status}'`,
      409,
    );
  }

  const newStatus = transitions[action];
  const now = new Date();

  try {
    // If approving with new_text, update text first
    if (action === "approve" && body.new_text) {
      await updateLearningText({
        surreal: deps.surreal,
        learningRecord,
        newText: body.new_text,
        now,
      });
    }

    await updateLearningStatus({
      surreal: deps.surreal,
      workspaceRecord,
      learningRecord,
      newStatus,
      now,
      reason: body.reason,
    });

    log.info("learning.action.completed", "Learning action completed", {
      workspaceId,
      learningId,
      action,
      previousStatus: existing.status,
      newStatus,
    });

    return jsonResponse({ status: newStatus }, 200);
  } catch (error) {
    log.error("learning.action.failed", "Failed to perform learning action", error, {
      workspaceId,
      learningId,
      action,
    });
    return jsonError("failed to perform action", 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/workspaces/:workspaceId/learnings/:learningId
// ---------------------------------------------------------------------------

type EditBody = {
  text?: string;
  priority?: string;
  target_agents?: string[];
};

async function handleEditLearning(
  deps: ServerDependencies,
  workspaceId: string,
  learningId: string,
  request: Request,
): Promise<Response> {
  const bodyOrError = await parseJsonBody<EditBody>(request);
  if (isResponse(bodyOrError)) return bodyOrError;
  const body = bodyOrError;

  // Validate text if provided: must not be empty or whitespace-only
  if (body.text !== undefined) {
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return jsonError("text must not be empty", 400);
    }
  }

  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "learning.edit.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  const learningRecord = new RecordId("learning", learningId) as LearningRecord;
  const now = new Date();

  try {
    await updateLearningFields({
      surreal: deps.surreal,
      workspaceRecord,
      learningRecord,
      fields: {
        ...(body.text !== undefined ? { text: body.text.trim() } : {}),
        ...(body.priority !== undefined ? { priority: body.priority as "low" | "medium" | "high" } : {}),
        ...(body.target_agents !== undefined ? { targetAgents: body.target_agents } : {}),
      },
      now,
    });

    log.info("learning.edited", "Learning edited via HTTP", {
      workspaceId,
      learningId,
      fieldsChanged: Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined),
    });

    return jsonResponse({ status: "updated" }, 200);
  } catch (error) {
    if (error instanceof LearningNotFoundError) {
      return jsonError("learning not found", 404);
    }
    if (error instanceof LearningNotActiveError) {
      return jsonError(error.message, 409);
    }
    log.error("learning.edit.failed", "Failed to edit learning", error, {
      workspaceId,
      learningId,
    });
    return jsonError("failed to edit learning", 500);
  }
}
