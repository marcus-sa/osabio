import { RecordId } from "surrealdb";
import type { EntityKind, SearchEntityResponse } from "../../shared/contracts";
import { createEmbeddingVector } from "../graph/embeddings";
import { HttpError } from "../http/errors";
import { elapsedMs, logDebug, logError, logInfo, logWarn } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceProjectRecord, resolveWorkspaceRecord } from "../workspace/workspace-scope";

type SearchEntityRow = {
  id: RecordId<string, string>;
  kind: EntityKind;
  text: string;
  similarity: number;
};

export function createEntitySearchHandler(deps: ServerDependencies): (url: URL) => Promise<Response> {
  return (url: URL) => handleEntitySearch(deps, url);
}

async function handleEntitySearch(deps: ServerDependencies, url: URL): Promise<Response> {
  const startedAt = performance.now();
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return jsonError("workspaceId is required", 400);
  }

  const projectId = url.searchParams.get("projectId")?.trim();

  const query = url.searchParams.get("q")?.trim();
  if (!query) {
    return jsonError("q is required", 400);
  }

  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = Number(rawLimit ?? "10");
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return jsonError("limit must be a positive number", 400);
  }

  const limit = Math.min(Math.floor(parsedLimit), 100);
  logDebug("http.request.validated", "Entity search request validated", {
    workspaceId,
    projectId,
    limit,
    queryLength: query.length,
  });
  logInfo("entity.search.started", "Entity search started", {
    workspaceId,
    projectId,
    limit,
  });

  let workspaceRecord: RecordId<"workspace", string>;
  let projectRecord: RecordId<"project", string> | undefined;

  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    if (projectId) {
      projectRecord = await resolveWorkspaceProjectRecord(deps.surreal, workspaceRecord, projectId);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("entity.search.http_error", "Entity search failed with client-facing error", {
        workspaceId,
        projectId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("entity.search.scope_validation.failed", "Entity search scope validation failed", error, {
      workspaceId,
      projectId,
    });
    const errorText = error instanceof Error ? error.message : "failed to validate scope";
    return jsonError(errorText, 500);
  }

  const vec = await createEmbeddingVector(deps.embeddingModel, query, deps.config.embeddingDimension);
  if (!vec) {
    return jsonError("failed to create query embedding", 500);
  }

  const [rows] = projectRecord
    ? await deps.surreal
        .query<[SearchEntityRow[]]>(
          "RETURN fn::entity_search_project($vec, $limit, $workspace, $project);",
          { vec, limit, workspace: workspaceRecord, project: projectRecord },
        )
        .collect<[SearchEntityRow[]]>()
    : await deps.surreal
        .query<[SearchEntityRow[]]>(
          "RETURN fn::entity_search_workspace($vec, $limit, $workspace);",
          { vec, limit, workspace: workspaceRecord },
        )
        .collect<[SearchEntityRow[]]>();

  const responseRows = rows.map((row) => ({
    id: row.id.id as string,
    kind: row.kind,
    text: row.text,
    confidence: row.similarity,
    sourceId: "",
    sourceKind: "message",
  } satisfies SearchEntityResponse));

  logInfo("entity.search.completed", "Entity search completed", {
    workspaceId,
    projectId,
    limit,
    resultCount: responseRows.length,
    durationMs: elapsedMs(startedAt),
  });

  return jsonResponse(responseRows, 200);
}
