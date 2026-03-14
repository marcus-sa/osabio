/**
 * Behavior HTTP Route Handlers
 *
 * Thin composition layer: parses HTTP requests, delegates to query functions,
 * returns JSON responses. No domain logic lives here.
 */
import { logError } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import {
  listWorkspaceBehaviors,
  listBehaviors,
  createBehaviorDefinition,
  getBehaviorDefinition,
  listBehaviorDefinitions,
  updateBehaviorDefinition,
  type BehaviorRow,
} from "./queries";
import type {
  BehaviorDefinitionRecord,
  CreateBehaviorDefinitionInput,
  UpdateBehaviorDefinitionInput,
} from "./definition-types";
import { matchDefinitions } from "./definition-matcher";
import { dispatchScoring, type ScoredResult } from "./scorer-dispatcher";

// ---------------------------------------------------------------------------
// Response serialization (pure)
// ---------------------------------------------------------------------------

function serializeBehavior(record: BehaviorRow) {
  return {
    id: record.id.id as string,
    metric_type: record.metric_type,
    score: record.score,
    source_telemetry: record.source_telemetry,
    definition_id: record.definition.id as string,
    definition_version: record.definition_version,
    workspace_id: record.workspace.id as string,
    ...(record.session ? { session_id: record.session.id as string } : {}),
    created_at: record.created_at,
  };
}

function serializeDefinition(record: BehaviorDefinitionRecord) {
  return {
    id: record.id.id as string,
    title: record.title,
    goal: record.goal,
    scoring_logic: record.scoring_logic,
    telemetry_types: record.telemetry_types,
    ...(record.category !== undefined ? { category: record.category } : {}),
    status: record.status,
    version: record.version,
    enforcement_mode: record.enforcement_mode,
    ...(record.enforcement_threshold !== undefined ? { enforcement_threshold: record.enforcement_threshold } : {}),
    workspace_id: record.workspace.id as string,
    ...(record.created_by ? { created_by_id: record.created_by.id as string } : {}),
    created_at: record.created_at,
    ...(record.updated_at ? { updated_at: record.updated_at } : {}),
  };
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createBehaviorRouteHandlers(deps: ServerDependencies) {
  return {
    handleList: (workspaceId: string, request: Request) =>
      handleListBehaviors(deps, workspaceId, request),
    handleScore: (workspaceId: string, request: Request) =>
      handleScoreTelemetry(deps, workspaceId, request),
    handleCreateDefinition: (workspaceId: string, request: Request) =>
      handleCreateDefinition(deps, workspaceId, request),
    handleListDefinitions: (workspaceId: string, request: Request) =>
      handleListDefinitions(deps, workspaceId, request),
    handleGetDefinition: (workspaceId: string, definitionId: string) =>
      handleGetDefinition(deps, workspaceId, definitionId),
    handleUpdateDefinition: (workspaceId: string, definitionId: string, request: Request) =>
      handleUpdateDefinition(deps, workspaceId, definitionId, request),
  };
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/behaviors
// ---------------------------------------------------------------------------

async function handleListBehaviors(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const metricType = url.searchParams.get("metric_type") ?? undefined;
    const identityId = url.searchParams.get("identity_id") ?? undefined;

    let records: BehaviorRow[];

    if (identityId) {
      // Query by identity traversing exhibits edges, scoped to workspace
      records = await listBehaviors(deps.surreal, identityId, metricType, workspaceId);
    } else {
      // Query by workspace directly
      records = await listWorkspaceBehaviors(deps.surreal, workspaceId, metricType);
    }

    return jsonResponse({
      behaviors: records.map(serializeBehavior),
    }, 200);
  } catch (error) {
    logError("behavior.list.failed", "Failed to list behaviors", error, { workspaceId });
    return jsonError("failed to list behaviors", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/behaviors/score
// ---------------------------------------------------------------------------

function serializeScoredResult(result: ScoredResult) {
  return {
    behaviorId: result.behaviorId,
    metricType: result.definitionTitle,
    score: result.score,
    definitionId: result.definitionId,
    definitionVersion: result.definitionVersion,
    ...(result.rationale ? { rationale: result.rationale } : {}),
    ...(result.evidenceChecked ? { evidenceChecked: result.evidenceChecked } : {}),
  };
}

async function handleScoreTelemetry(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Request body must be valid JSON", 400);
    }

    const telemetryType = body.telemetry_type as string | undefined;
    const identityId = body.identity_id as string | undefined;
    const payload = body.payload as Record<string, unknown> | undefined;

    if (!telemetryType || telemetryType.trim().length === 0) return jsonError("telemetry_type is required", 400);
    if (!identityId || identityId.trim().length === 0) return jsonError("identity_id is required", 400);
    if (!payload || typeof payload !== "object") return jsonError("payload must be an object", 400);

    // Query all definitions for this workspace, then filter by active + telemetry type
    const allDefinitions = await listBehaviorDefinitions(deps.surreal, workspaceId);
    const matched = matchDefinitions(allDefinitions, telemetryType);

    if (matched.length === 0) {
      return jsonResponse({ results: [], matched_definitions: 0 }, 200);
    }

    // Dispatch scoring for all matched definitions
    const scored = await dispatchScoring(
      matched,
      {
        telemetryType,
        telemetryPayload: payload,
        identityId,
        workspaceId,
      },
      {
        surreal: deps.surreal,
        scorerModel: deps.scorerModel,
      },
    );

    return jsonResponse({
      results: scored.map(serializeScoredResult),
      matched_definitions: matched.length,
    }, 200);
  } catch (error) {
    logError("behavior.score.failed", "Failed to score telemetry", error, { workspaceId });
    return jsonError("failed to score telemetry", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/behavior-definitions
// ---------------------------------------------------------------------------

async function handleCreateDefinition(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Request body must be valid JSON", 400);
    }

    const title = body.title as string | undefined;
    const goal = body.goal as string | undefined;
    const scoringLogic = body.scoring_logic as string | undefined;
    const telemetryTypes = body.telemetry_types as string[] | undefined;
    const category = body.category as string | undefined;
    const createdById = body.created_by_id as string | undefined;

    if (!title || title.trim().length === 0) return jsonError("title is required", 400);
    if (!goal || goal.trim().length === 0) return jsonError("goal is required", 400);
    if (!scoringLogic || scoringLogic.trim().length === 0) return jsonError("scoring_logic is required", 400);
    if (!telemetryTypes || !Array.isArray(telemetryTypes) || telemetryTypes.length === 0) return jsonError("telemetry_types must be a non-empty array", 400);
    if (!createdById || createdById.trim().length === 0) return jsonError("created_by_id is required", 400);

    const input: CreateBehaviorDefinitionInput = {
      title: title.trim(),
      goal: goal.trim(),
      scoring_logic: scoringLogic.trim(),
      telemetry_types: telemetryTypes,
      ...(category !== undefined ? { category } : {}),
    };

    const { definitionId } = await createBehaviorDefinition(
      deps.surreal,
      workspaceId,
      createdById,
      input,
    );

    const record = await getBehaviorDefinition(deps.surreal, definitionId);
    if (!record) return jsonError("failed to retrieve created definition", 500);

    return jsonResponse({ definition: serializeDefinition(record) }, 201);
  } catch (error) {
    logError("behavior.definition.create.failed", "Failed to create behavior definition", error, { workspaceId });
    return jsonError("failed to create behavior definition", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/behavior-definitions
// ---------------------------------------------------------------------------

async function handleListDefinitions(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as "draft" | "active" | "archived" | undefined;

    const records = await listBehaviorDefinitions(deps.surreal, workspaceId, status);

    return jsonResponse({
      definitions: records.map(serializeDefinition),
    }, 200);
  } catch (error) {
    logError("behavior.definition.list.failed", "Failed to list behavior definitions", error, { workspaceId });
    return jsonError("failed to list behavior definitions", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/behavior-definitions/:id
// ---------------------------------------------------------------------------

async function handleGetDefinition(
  deps: ServerDependencies,
  _workspaceId: string,
  definitionId: string,
): Promise<Response> {
  try {
    const record = await getBehaviorDefinition(deps.surreal, definitionId);
    if (!record) return jsonError("behavior definition not found", 404);

    return jsonResponse({ definition: serializeDefinition(record) }, 200);
  } catch (error) {
    logError("behavior.definition.get.failed", "Failed to get behavior definition", error, { definitionId });
    return jsonError("failed to get behavior definition", 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/workspaces/:workspaceId/behavior-definitions/:id
// ---------------------------------------------------------------------------

async function handleUpdateDefinition(
  deps: ServerDependencies,
  _workspaceId: string,
  definitionId: string,
  request: Request,
): Promise<Response> {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Request body must be valid JSON", 400);
    }

    const input: UpdateBehaviorDefinitionInput = {};
    if (body.goal !== undefined) input.goal = body.goal as string;
    if (body.scoring_logic !== undefined) input.scoring_logic = body.scoring_logic as string;
    if (body.telemetry_types !== undefined) input.telemetry_types = body.telemetry_types as string[];
    if (body.category !== undefined) input.category = body.category as string;
    if (body.status !== undefined) input.status = body.status as "draft" | "active" | "archived";
    if (body.enforcement_mode !== undefined) input.enforcement_mode = body.enforcement_mode as "warn_only" | "automatic";
    if (body.enforcement_threshold !== undefined) input.enforcement_threshold = body.enforcement_threshold as number;

    const updated = await updateBehaviorDefinition(deps.surreal, definitionId, input);
    return jsonResponse({ definition: serializeDefinition(updated) }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("not found")) return jsonError(message, 404);
    if (message.includes("Invalid status transition")) return jsonError(message, 422);
    logError("behavior.definition.update.failed", "Failed to update behavior definition", error, { definitionId });
    return jsonError("failed to update behavior definition", 500);
  }
}
