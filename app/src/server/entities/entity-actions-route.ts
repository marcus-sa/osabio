import { RecordId } from "surrealdb";
import { ENTITY_PRIORITIES, type EntityActionRequest } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { logError, logInfo } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import { acknowledgeObservation, resolveObservation } from "../observation/queries";
import { acceptSuggestion, convertSuggestion, dismissSuggestion, deferSuggestion } from "../suggestion/queries";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  confirmDecisionRecord,
  isEntityInWorkspace,
  parseRecordIdString,
  type GraphEntityTable,
} from "../graph/queries";
import { fireDescriptionUpdates } from "../descriptions/triggers";

type EntityActionTable = GraphEntityTable | "observation";

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

  if (!body.action || !["confirm", "override", "complete", "set_priority", "acknowledge", "resolve", "dismiss", "accept", "defer", "convert"].includes(body.action)) {
    return jsonError("action must be one of: confirm, override, complete, set_priority, acknowledge, resolve, dismiss, accept, defer, convert", 400);
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
    const entityTables: EntityActionTable[] = ["workspace", "project", "person", "feature", "task", "decision", "question", "observation", "suggestion"];
    const entityRecord = parseRecordIdString(entityId, entityTables);

    const table = entityRecord.table.name;
    const now = new Date();

    // Observation actions have separate handlers from task/decision/question.
    if (table === "observation") {
      if (body.action === "acknowledge") {
        await acknowledgeObservation({
          surreal: deps.surreal,
          workspaceRecord,
          observationRecord: entityRecord as RecordId<"observation", string>,
          now,
        });
        logInfo("entity.action.acknowledge", "Observation acknowledged", { workspaceId, entityId });
        return jsonResponse({ status: "acknowledged" }, 200);
      }

      if (body.action === "resolve") {
        await resolveObservation({
          surreal: deps.surreal,
          workspaceRecord,
          observationRecord: entityRecord as RecordId<"observation", string>,
          now,
        });
        logInfo("entity.action.resolve", "Observation resolved", { workspaceId, entityId });
        return jsonResponse({ status: "resolved" }, 200);
      }

      return jsonError(`action '${body.action}' is not valid for entity type 'observation'`, 400);
    }

    // Suggestion actions handle their own workspace validation internally.
    if (table === "suggestion") {
      if (body.action === "accept") {
        await acceptSuggestion({
          surreal: deps.surreal,
          workspaceRecord,
          suggestionRecord: entityRecord as RecordId<"suggestion", string>,
          now,
        });
        logInfo("entity.action.accept", "Suggestion accepted", { workspaceId, entityId });
        return jsonResponse({ status: "accepted" }, 200);
      }

      if (body.action === "dismiss") {
        await dismissSuggestion({
          surreal: deps.surreal,
          workspaceRecord,
          suggestionRecord: entityRecord as RecordId<"suggestion", string>,
          now,
        });
        logInfo("entity.action.dismiss", "Suggestion dismissed", { workspaceId, entityId });
        return jsonResponse({ status: "dismissed" }, 200);
      }

      if (body.action === "defer") {
        await deferSuggestion({
          surreal: deps.surreal,
          workspaceRecord,
          suggestionRecord: entityRecord as RecordId<"suggestion", string>,
          now,
        });
        logInfo("entity.action.defer", "Suggestion deferred", { workspaceId, entityId });
        return jsonResponse({ status: "deferred" }, 200);
      }

      if (body.action === "convert") {
        if (!body.convertTo || !["task", "feature", "decision", "project"].includes(body.convertTo)) {
          return jsonError("convertTo must be one of: task, feature, decision, project", 400);
        }
        const result = await convertSuggestion({
          surreal: deps.surreal,
          workspaceRecord,
          suggestionRecord: entityRecord as RecordId<"suggestion", string>,
          targetKind: body.convertTo as "task" | "feature" | "decision" | "project",
          title: body.convertTitle,
          embeddingModel: deps.embeddingModel,
          embeddingDimension: deps.config.embeddingDimension,
          now,
        });
        logInfo("entity.action.convert", "Suggestion converted", { workspaceId, suggestionId: entityId, convertedEntityId: result.entityId, table: result.table });
        return jsonResponse({ status: "converted", entityId: result.entityId, table: result.table }, 201);
      }

      return jsonError(`action '${body.action}' is not valid for entity type 'suggestion'`, 400);
    }

    const scoped = await isEntityInWorkspace(deps.surreal, workspaceRecord, entityRecord as RecordId<GraphEntityTable, string>);
    if (!scoped) {
      return jsonError("entity is outside the current workspace scope", 403);
    }

    if (body.action === "confirm" && table === "decision") {
      const [decisionRows] = await deps.surreal
        .query<[Array<{ summary: string }>]>(
          "SELECT summary FROM $record LIMIT 1;",
          { record: entityRecord },
        )
        .collect<[Array<{ summary: string }>]>();
      const decisionSummary = decisionRows[0]?.summary ?? entityId;

      await confirmDecisionRecord({
        surreal: deps.surreal,
        decisionRecord: entityRecord as RecordId<"decision", string>,
        confirmedAt: now,
        notes: body.notes,
      });

      deps.inflight.track(fireDescriptionUpdates({
        surreal: deps.surreal,
        extractionModel: deps.extractionModel,
        trigger: {
          kind: "decision_confirmed",
          entity: entityRecord,
          summary: `Decision confirmed: ${decisionSummary}`,
        },
      }).catch(() => undefined));

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

    if (body.action === "complete" && table === "feature") {
      const [featureRows] = await deps.surreal
        .query<[Array<{ name: string }>]>(
          "SELECT name FROM $record LIMIT 1;",
          { record: entityRecord },
        )
        .collect<[Array<{ name: string }>]>();
      const featureName = featureRows[0]?.name ?? entityId;

      await deps.surreal.update(entityRecord as RecordId<"feature", string>).merge({
        status: "done",
        updated_at: now,
      });

      deps.inflight.track(fireDescriptionUpdates({
        surreal: deps.surreal,
        extractionModel: deps.extractionModel,
        trigger: {
          kind: "feature_completed",
          entity: entityRecord,
          summary: `Feature completed: ${featureName}`,
        },
      }).catch(() => undefined));

      logInfo("entity.action.complete", "Feature completed", { workspaceId, entityId });
      return jsonResponse({ status: "completed" }, 200);
    }

    if (body.action === "complete" && table === "task") {
      const [taskRows] = await deps.surreal
        .query<[Array<{ title: string }>]>(
          "SELECT title FROM $record LIMIT 1;",
          { record: entityRecord },
        )
        .collect<[Array<{ title: string }>]>();
      const taskTitle = taskRows[0]?.title ?? entityId;

      await deps.surreal.update(entityRecord as RecordId<"task", string>).merge({
        status: "done",
        completed_at: now,
        updated_at: now,
      });

      deps.inflight.track(fireDescriptionUpdates({
        surreal: deps.surreal,
        extractionModel: deps.extractionModel,
        trigger: {
          kind: "task_completed",
          entity: entityRecord,
          summary: `Task completed: ${taskTitle}`,
        },
      }).catch(() => undefined));

      logInfo("entity.action.complete", "Task completed", { workspaceId, entityId });
      return jsonResponse({ status: "completed" }, 200);
    }

    if (body.action === "dismiss" && table === "question") {
      await deps.surreal.update(entityRecord as RecordId<"question", string>).merge({
        status: "dismissed",
        updated_at: now,
      });
      logInfo("entity.action.dismiss", "Question dismissed", { workspaceId, entityId });
      return jsonResponse({ status: "dismissed" }, 200);
    }

    if (body.action === "set_priority" && (table === "task" || table === "decision" || table === "question")) {
      if (!body.priority || !(ENTITY_PRIORITIES as readonly string[]).includes(body.priority)) {
        return jsonError("priority must be one of: low, medium, high, critical", 400);
      }
      await deps.surreal.update(entityRecord).merge({
        priority: body.priority,
        updated_at: now,
      });
      logInfo("entity.action.set_priority", "Priority updated", { workspaceId, entityId, priority: body.priority });
      return jsonResponse({ status: "priority_updated", priority: body.priority }, 200);
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
