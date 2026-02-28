import { HttpError } from "../http/errors";
import { logError, logInfo } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  getEntityDetail,
  parseRecordIdString,
  type GraphEntityTable,
} from "../graph/queries";
import type { EntityDetailResponse } from "../../shared/contracts";

export function createEntityDetailHandler(
  deps: ServerDependencies,
): (entityId: string, url: URL) => Promise<Response> {
  return (entityId: string, url: URL) => handleEntityDetail(deps, entityId, url);
}

async function handleEntityDetail(
  deps: ServerDependencies,
  entityId: string,
  url: URL,
): Promise<Response> {
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
    logError("entity.detail.workspace_resolve.failed", "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }

  try {
    const entityTables: GraphEntityTable[] = ["workspace", "project", "person", "feature", "task", "decision", "question"];
    const entityRecord = parseRecordIdString(entityId, entityTables);
    const detail = await getEntityDetail({
      surreal: deps.surreal,
      workspaceRecord,
      entityRecord,
    });

    const response: EntityDetailResponse = {
      entity: detail.entity,
      relationships: detail.relationships,
      provenance: detail.provenance,
    };

    logInfo("entity.detail.served", "Entity detail served", {
      workspaceId,
      entityId,
      relationshipCount: detail.relationships.length,
      provenanceCount: detail.provenance.length,
    });

    return jsonResponse(response, 200);
  } catch (error) {
    logError("entity.detail.failed", "Entity detail failed", error, {
      workspaceId,
      entityId,
    });
    const message = error instanceof Error ? error.message : "entity detail failed";
    return jsonError(message, 500);
  }
}
