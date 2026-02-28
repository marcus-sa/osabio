import { RecordId } from "surrealdb";
import type { EntityActionRequest } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { logError, logInfo } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  confirmDecisionRecord,
  isEntityInWorkspace,
  parseRecordIdString,
  type GraphEntityTable,
} from "../graph/queries";

export function createEntityActionsHandler(
  deps: ServerDependencies,
): (entityId: string, request: Request) => Promise<Response> {
  return (entityId: string, request: Request) => handleEntityAction(deps, entityId, request);
}

async function handleEntityAction(
  deps: ServerDependencies,
  entityId: string,
  request: Request,
): Promise<Response> {
  let body: EntityActionRequest;
  try {
    body = await request.json() as EntityActionRequest;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  if (!body.action || !["confirm", "override", "complete"].includes(body.action)) {
    return jsonError("action must be one of: confirm, override, complete", 400);
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return jsonError("workspaceId is required", 400);
  }

  let workspaceRecord;
  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    logError("entity.action.workspace_resolve.failed", "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }

  try {
    const entityTables: GraphEntityTable[] = ["workspace", "project", "person", "feature", "task", "decision", "question"];
    const entityRecord = parseRecordIdString(entityId, entityTables);
    const scoped = await isEntityInWorkspace(deps.surreal, workspaceRecord, entityRecord);
    if (!scoped) {
      return jsonError("entity is outside the current workspace scope", 403);
    }

    const table = entityRecord.table.name;
    const now = new Date();

    if (body.action === "confirm" && table === "decision") {
      await confirmDecisionRecord({
        surreal: deps.surreal,
        decisionRecord: entityRecord as RecordId<"decision", string>,
        confirmedAt: now,
        notes: body.notes,
      });
      logInfo("entity.action.confirm", "Decision confirmed", { workspaceId, entityId });
      return jsonResponse({ status: "confirmed" }, 200);
    }

    if (body.action === "override" && table === "decision") {
      if (!body.newSummary) {
        return jsonError("newSummary is required for override action", 400);
      }
      await deps.surreal.update(entityRecord as RecordId<"decision", string>).merge({
        summary: body.newSummary,
        status: "overridden",
        updated_at: now,
        ...(body.notes ? { override_notes: body.notes } : {}),
      });
      logInfo("entity.action.override", "Decision overridden", { workspaceId, entityId });
      return jsonResponse({ status: "overridden" }, 200);
    }

    if (body.action === "complete" && table === "task") {
      await deps.surreal.update(entityRecord as RecordId<"task", string>).merge({
        status: "done",
        completed_at: now,
        updated_at: now,
      });
      logInfo("entity.action.complete", "Task completed", { workspaceId, entityId });
      return jsonResponse({ status: "completed" }, 200);
    }

    return jsonError(`action '${body.action}' is not valid for entity type '${table}'`, 400);
  } catch (error) {
    logError("entity.action.failed", "Entity action failed", error, {
      workspaceId,
      entityId,
      action: body.action,
    });
    const message = error instanceof Error ? error.message : "entity action failed";
    return jsonError(message, 500);
  }
}
